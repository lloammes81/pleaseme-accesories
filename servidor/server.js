#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════
//  PLEASEME — Servidor de base de datos LOCAL (reemplaza a Supabase)
//
//  • Guarda todo en un archivo SQLite en este equipo: datos/pleaseme.db
//  • Sirve las páginas (admin.html, index.html, tienda.html, account.html)
//  • Expone /rest/v1/<tabla> con el mismo formato que usaba Supabase
//    (PostgREST), así las páginas funcionan sin cambios en su lógica.
//  • /api/importar recibe los registros que se migran desde el navegador.
//
//  Requisitos: Node.js 22.13 o superior (sin paquetes npm).
//  Uso:        node servidor/server.js      → http://localhost:3000
//  Opcional:   PORT=3000  HOST=0.0.0.0 (para abrirlo desde otros equipos de la red)
// ══════════════════════════════════════════════════════════════
'use strict';

// Oculta el aviso "SQLite is an experimental feature" de Node
const _emitWarning = process.emitWarning;
process.emitWarning = function(warning, ...args){
  if(String(warning && warning.message || warning).includes('SQLite')) return;
  return _emitWarning.call(process, warning, ...args);
};

const http   = require('node:http');
const fs     = require('node:fs');
const path   = require('node:path');
const crypto = require('node:crypto');

let DatabaseSync;
try{ ({ DatabaseSync } = require('node:sqlite')); }
catch(e){
  console.error('\n✖ Esta versión de Node.js (' + process.version + ') no incluye SQLite.');
  console.error('  Instala Node.js 22.13 o superior (recomendado: la versión LTS de https://nodejs.org)\n');
  process.exit(1);
}

const ROOT      = path.resolve(__dirname, '..');
const DATA_DIR  = process.env.PM_DATA_DIR ? path.resolve(process.env.PM_DATA_DIR) : path.join(ROOT, 'datos');
const DB_FILE   = path.join(DATA_DIR, 'pleaseme.db');
const BACKUPS   = path.join(DATA_DIR, 'respaldos');
const PORT      = Number(process.env.PORT || 3000);
const HOST      = process.env.HOST || '127.0.0.1';
const MAX_BODY  = 50 * 1024 * 1024; // 50 MB (logos/imagenes en base64)

// Tablas cuya llave primaria no es "id"
const PRIMARY_KEYS = { config: 'key' };
const pkOf = table => PRIMARY_KEYS[table] || 'id';

// ── Base de datos ─────────────────────────────────────────────
fs.mkdirSync(BACKUPS, { recursive: true });

// Respaldo automático diario del archivo (se guardan los últimos 30)
function dailyBackup(){
  try{
    if(!fs.existsSync(DB_FILE)) return;
    const day  = new Date().toISOString().slice(0, 10);
    const dest = path.join(BACKUPS, 'pleaseme-' + day + '.db');
    if(!fs.existsSync(dest)) fs.copyFileSync(DB_FILE, dest);
    const old = fs.readdirSync(BACKUPS).filter(f => /^pleaseme-.*\.db$/.test(f)).sort();
    old.slice(0, Math.max(0, old.length - 30)).forEach(f => fs.unlinkSync(path.join(BACKUPS, f)));
  }catch(e){ console.warn('No se pudo crear el respaldo diario:', e.message); }
}
dailyBackup();

const db = new DatabaseSync(DB_FILE);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS registros (
    tabla       TEXT NOT NULL,
    id          TEXT NOT NULL,
    datos       TEXT NOT NULL,
    actualizado TEXT NOT NULL,
    PRIMARY KEY (tabla, id)
  );
`);

const stmtAll    = db.prepare('SELECT datos FROM registros WHERE tabla = ?');
const stmtGet    = db.prepare('SELECT datos FROM registros WHERE tabla = ? AND id = ?');
const stmtPut    = db.prepare('INSERT INTO registros (tabla, id, datos, actualizado) VALUES (?, ?, ?, ?) ON CONFLICT(tabla, id) DO UPDATE SET datos = excluded.datos, actualizado = excluded.actualizado');
const stmtDel    = db.prepare('DELETE FROM registros WHERE tabla = ? AND id = ?');
const stmtTables = db.prepare('SELECT tabla, COUNT(*) AS total FROM registros GROUP BY tabla ORDER BY tabla');

function allRows(table){ return stmtAll.all(table).map(r => JSON.parse(r.datos)); }
function getRow(table, id){ const r = stmtGet.get(table, String(id)); return r ? JSON.parse(r.datos) : null; }
function putRow(table, row){ stmtPut.run(table, String(row[pkOf(table)]), JSON.stringify(row), new Date().toISOString()); }
function delRow(table, id){ stmtDel.run(table, String(id)); }

function transaction(fn){
  db.exec('BEGIN');
  try{ const out = fn(); db.exec('COMMIT'); return out; }
  catch(e){ db.exec('ROLLBACK'); throw e; }
}

// Completa llave primaria y created_at como lo hacía Postgres por defecto
function withDefaults(table, row){
  const pk = pkOf(table);
  const out = { ...row };
  if(out[pk] === undefined || out[pk] === null || out[pk] === ''){
    const ids = allRows(table).map(r => r[pk]);
    const numeric = ids.length === 0 || ids.every(v => /^\d+$/.test(String(v)));
    out[pk] = numeric ? ids.reduce((m, v) => Math.max(m, Number(v)), 0) + 1 : crypto.randomUUID();
  }
  if(pk === 'id' && out.created_at === undefined) out.created_at = new Date().toISOString();
  return out;
}

// ── Filtros estilo PostgREST ──────────────────────────────────
// Soporta: col=eq.x, neq, gt, gte, lt, lte, like, ilike, is, in.(a,b)
// y columnas JSON: record->>username=eq.x
const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);

function readField(row, key){
  const m = key.split(/->>?/);
  let v = row[m[0]];
  for(let i = 1; i < m.length; i++){
    if(typeof v === 'string'){ try{ v = JSON.parse(v); }catch{ v = undefined; } }
    v = v == null ? undefined : v[m[i]];
  }
  return v;
}

function likeToRegex(pattern, flags){
  const esc = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/[*%]/g, '.*').replace(/_/g, '.');
  return new RegExp('^' + esc + '$', flags);
}

function matchOne(value, opExpr){
  let negate = false;
  if(opExpr.startsWith('not.')){ negate = true; opExpr = opExpr.slice(4); }
  const dot = opExpr.indexOf('.');
  const op  = dot >= 0 ? opExpr.slice(0, dot) : opExpr;
  const arg = dot >= 0 ? opExpr.slice(dot + 1) : '';
  const sv  = value === undefined || value === null ? null : (typeof value === 'object' ? JSON.stringify(value) : String(value));
  const num = (a, b) => (!isNaN(Number(a)) && !isNaN(Number(b))) ? [Number(a), Number(b)] : [a, b];
  let ok;
  switch(op){
    case 'eq':    ok = sv !== null && sv === arg; break;
    case 'neq':   ok = sv !== arg; break;
    case 'gt':    { if(sv === null){ ok = false; break; } const [a, b] = num(sv, arg); ok = a >  b; break; }
    case 'gte':   { if(sv === null){ ok = false; break; } const [a, b] = num(sv, arg); ok = a >= b; break; }
    case 'lt':    { if(sv === null){ ok = false; break; } const [a, b] = num(sv, arg); ok = a <  b; break; }
    case 'lte':   { if(sv === null){ ok = false; break; } const [a, b] = num(sv, arg); ok = a <= b; break; }
    case 'like':  ok = sv !== null && likeToRegex(arg, '').test(sv); break;
    case 'ilike': ok = sv !== null && likeToRegex(arg, 'i').test(sv); break;
    case 'is':
      if(arg === 'null')       ok = sv === null;
      else if(arg === 'true')  ok = value === true || sv === 'true';
      else if(arg === 'false') ok = value === false || sv === 'false';
      else ok = false;
      break;
    case 'in': {
      const list = arg.replace(/^\(|\)$/g, '').split(',').map(s => s.trim().replace(/^"|"$/g, ''));
      ok = sv !== null && list.includes(sv);
      break;
    }
    default: ok = sv !== null && sv === opExpr; // valor sin operador
  }
  return negate ? !ok : ok;
}

function filtersFrom(params){
  const out = [];
  for(const [k, v] of params){ if(!RESERVED.has(k)) out.push([k, v]); }
  return out;
}

function applyFilters(rows, filters){
  return rows.filter(r => filters.every(([k, v]) => matchOne(readField(r, k), v)));
}

function applyOrder(rows, order){
  if(!order) return rows;
  const keys = order.split(',').map(s => {
    const parts = s.trim().split('.');
    const desc  = parts.includes('desc');
    const col   = parts.filter(p => !['asc', 'desc', 'nullsfirst', 'nullslast'].includes(p)).join('.');
    return { col, desc };
  });
  return [...rows].sort((a, b) => {
    for(const { col, desc } of keys){
      const va = readField(a, col), vb = readField(b, col);
      if(va === vb) continue;
      if(va === undefined || va === null) return 1;   // nulos al final
      if(vb === undefined || vb === null) return -1;
      const cmp = (typeof va === 'number' && typeof vb === 'number') ? va - vb : String(va).localeCompare(String(vb), 'es', { numeric: true });
      if(cmp !== 0) return desc ? -cmp : cmp;
    }
    return 0;
  });
}

function applySelect(rows, select){
  if(!select || select.trim() === '*' ) return rows;
  const cols = select.split(',').map(s => s.trim()).filter(Boolean);
  if(cols.includes('*')) return rows;
  return rows.map(r => {
    const o = {};
    cols.forEach(c => {
      const [src, alias] = c.includes(':') ? c.split(':').reverse() : [c, null];
      const name = alias || src.split(/->>?/).pop();
      const v = readField(r, src);
      o[name] = v === undefined ? null : v;
    });
    return o;
  });
}

function rangeFrom(req, params){
  let offset = Number(params.get('offset') || 0);
  let limit  = params.has('limit') ? Number(params.get('limit')) : null;
  const range = req.headers['range'];
  if(range && /^\d+-\d*$/.test(range)){
    const [a, b] = range.split('-');
    offset = Number(a);
    if(b !== '') limit = Number(b) - Number(a) + 1;
  }
  return { offset, limit };
}

// ── HTTP helpers ──────────────────────────────────────────────
function cors(req, res){
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'apikey,authorization,content-type,prefer,range,x-client-info');
  res.setHeader('Access-Control-Expose-Headers', 'content-range');
  // Permite que una página abierta desde internet o file:// envíe datos a localhost (Chrome)
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
}

function send(res, status, body, headers = {}){
  const isJson = body !== undefined && body !== null && typeof body !== 'string';
  res.writeHead(status, { 'Content-Type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', ...headers });
  res.end(body === undefined || body === null ? '' : (isJson ? JSON.stringify(body) : body));
}

function readBody(req){
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if(size > MAX_BODY){ reject(new Error('Cuerpo demasiado grande')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if(!raw) return resolve(null);
      try{ resolve(JSON.parse(raw)); }catch(e){ reject(new Error('JSON inválido')); }
    });
    req.on('error', reject);
  });
}

function prefers(req){
  const p = String(req.headers['prefer'] || '');
  return {
    representation: p.includes('return=representation'),
    merge:          p.includes('resolution=merge-duplicates'),
    ignore:         p.includes('resolution=ignore-duplicates'),
  };
}

const TABLE_RE = /^[A-Za-z0-9_]+$/;

// ── /rest/v1/<tabla> — API compatible con Supabase ────────────
async function handleRest(req, res, table, params){
  if(!TABLE_RE.test(table)) return send(res, 400, { message: 'Tabla inválida' });
  const pk = pkOf(table);
  const pref = prefers(req);
  const filters = filtersFrom(params);

  if(req.method === 'GET' || req.method === 'HEAD'){
    let rows = applyFilters(allRows(table), filters);
    rows = applyOrder(rows, params.get('order'));
    const total = rows.length;
    const { offset, limit } = rangeFrom(req, params);
    rows = rows.slice(offset, limit === null ? undefined : offset + limit);
    const end = rows.length ? offset + rows.length - 1 : offset;
    return send(res, 200, applySelect(rows, params.get('select')), { 'Content-Range': (rows.length ? offset + '-' + end : '*') + '/' + total });
  }

  if(req.method === 'POST'){
    const body = await readBody(req);
    const list = Array.isArray(body) ? body : (body ? [body] : []);
    const conflictCol = params.get('on_conflict') || pk;
    try{
      const saved = transaction(() => list.map(input => {
        const row = withDefaults(table, input);
        let existing = conflictCol === pk ? getRow(table, row[pk]) : allRows(table).find(r => String(r[conflictCol]) === String(row[conflictCol]));
        if(existing){
          if(pref.ignore) return existing;
          if(!pref.merge){ const e = new Error('duplicate key value violates unique constraint (' + table + '.' + conflictCol + ')'); e.status = 409; throw e; }
          const merged = { ...existing, ...input, [pk]: existing[pk] };
          putRow(table, merged);
          return merged;
        }
        putRow(table, row);
        return row;
      }));
      return pref.representation ? send(res, 201, saved) : send(res, 201, null);
    }catch(e){ return send(res, e.status || 400, { message: e.message, code: e.status === 409 ? '23505' : 'PM400' }); }
  }

  if(req.method === 'PATCH'){
    const body = await readBody(req) || {};
    if(!filters.length) return send(res, 400, { message: 'PATCH requiere un filtro (ej. id=eq.123)' });
    const updated = transaction(() => applyFilters(allRows(table), filters).map(r => {
      const merged = { ...r, ...body, [pk]: r[pk] };
      putRow(table, merged);
      return merged;
    }));
    return pref.representation ? send(res, 200, updated) : send(res, 204, null);
  }

  if(req.method === 'PUT'){
    const body = await readBody(req) || {};
    const row = withDefaults(table, body);
    putRow(table, row);
    return pref.representation ? send(res, 200, [row]) : send(res, 204, null);
  }

  if(req.method === 'DELETE'){
    if(!filters.length) return send(res, 400, { message: 'DELETE requiere un filtro (ej. id=eq.123)' });
    const removed = transaction(() => applyFilters(allRows(table), filters).map(r => { delRow(table, r[pk]); return r; }));
    return pref.representation ? send(res, 200, removed) : send(res, 204, null);
  }

  return send(res, 405, { message: 'Método no permitido' });
}

// ── /api — estado y migración ─────────────────────────────────
function isEmpty(v){ return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0); }

// Modo "completar": agrega registros nuevos y en los existentes solo llena campos vacíos
// (así ejecutar la migración varias veces nunca pisa cambios hechos en la base local).
function importRows(table, rows, mode){
  const pk = pkOf(table);
  let nuevos = 0, actualizados = 0, sinCambios = 0;
  transaction(() => rows.forEach(input => {
    if(!input || typeof input !== 'object') return;
    if(isEmpty(input[pk])) return;
    const existing = getRow(table, input[pk]);
    if(!existing){ putRow(table, withDefaults(table, input)); nuevos++; return; }
    let changed = false;
    const merged = { ...existing };
    for(const [k, v] of Object.entries(input)){
      if(mode === 'reemplazar' ? JSON.stringify(existing[k]) !== JSON.stringify(v) : (isEmpty(existing[k]) && !isEmpty(v))){
        merged[k] = v; changed = true;
      }
    }
    if(changed){ putRow(table, merged); actualizados++; } else sinCambios++;
  }));
  return { nuevos, actualizados, sinCambios };
}

async function handleApi(req, res, route){
  if(route === 'estado' && req.method === 'GET'){
    return send(res, 200, {
      ok: true,
      servidor: 'pleaseme-local',
      archivo: DB_FILE,
      tablas: Object.fromEntries(stmtTables.all().map(r => [r.tabla, r.total])),
    });
  }
  if(route === 'importar' && req.method === 'POST'){
    try{
      const body = await readBody(req) || {};
      const mode = body.modo === 'reemplazar' ? 'reemplazar' : 'completar';
      const resumen = {};
      for(const [table, rows] of Object.entries(body.tablas || {})){
        if(!TABLE_RE.test(table) || !Array.isArray(rows)) continue;
        resumen[table] = importRows(table, rows, mode);
      }
      const totales = Object.fromEntries(stmtTables.all().map(r => [r.tabla, r.total]));
      console.log('[importar] origen:', body.origen || '—', JSON.stringify(resumen));
      return send(res, 200, { ok: true, resumen, totales });
    }catch(e){ return send(res, 400, { ok: false, message: e.message }); }
  }
  if(route === 'exportar' && req.method === 'GET'){
    const out = {};
    stmtTables.all().forEach(r => { out[r.tabla] = allRows(r.tabla); });
    const name = 'pleaseme-respaldo-' + new Date().toISOString().slice(0, 10) + '.json';
    return send(res, 200, { exportado: new Date().toISOString(), tablas: out }, { 'Content-Disposition': 'attachment; filename="' + name + '"' });
  }
  return send(res, 404, { message: 'Ruta no encontrada' });
}

// ── Archivos estáticos (las páginas) ──────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon', '.pdf': 'application/pdf',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};
const BLOCKED = /^(datos|servidor|\.git)(\/|$)|(^|\/)\.|\.(db|sql|md)$|^anonkey\.txt$/i;

function serveStatic(req, res, pathname){
  let rel = decodeURIComponent(pathname).replace(/^\/+/, '');
  if(rel === '') rel = 'admin.html';
  if(BLOCKED.test(rel)) return send(res, 404, 'No encontrado');
  const file = path.resolve(ROOT, rel);
  if(!file.startsWith(ROOT + path.sep)) return send(res, 404, 'No encontrado');
  fs.stat(file, (err, st) => {
    if(err || !st.isFile()) return send(res, 404, 'No encontrado');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
}

// ── Servidor ──────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  cors(req, res);
  if(req.method === 'OPTIONS'){ res.writeHead(204); return res.end(); }
  try{
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    if(p.startsWith('/rest/v1/')) return await handleRest(req, res, p.slice('/rest/v1/'.length).replace(/\/+$/, ''), url.searchParams);
    if(p.startsWith('/api/'))     return await handleApi(req, res, p.slice('/api/'.length).replace(/\/+$/, ''));
    if(req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Método no permitido');
    return serveStatic(req, res, p);
  }catch(e){
    console.error('[error]', req.method, req.url, e);
    if(!res.headersSent) send(res, 500, { message: e.message });
  }
});

server.listen(PORT, HOST, () => {
  const shown = (HOST === '0.0.0.0' || HOST === '127.0.0.1') ? 'localhost' : HOST;
  console.log('\n  ✦ Pleaseme — base de datos local en marcha');
  console.log('  Archivo de datos: ' + DB_FILE);
  console.log('  Admin:        http://' + shown + ':' + PORT + '/admin.html');
  console.log('  Facturación:  http://' + shown + ':' + PORT + '/index.html');
  console.log('  Tienda:       http://' + shown + ':' + PORT + '/tienda.html');
  console.log('\n  Deja esta ventana abierta mientras usas el sistema. Ctrl+C para detenerlo.\n');
});
server.on('error', e => {
  if(e.code === 'EADDRINUSE') console.error('\n✖ El puerto ' + PORT + ' ya está en uso. ¿El servidor ya está abierto en otra ventana?\n');
  else console.error(e);
  process.exit(1);
});

function shutdown(){ try{ db.close(); }catch{} process.exit(0); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
