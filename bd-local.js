// ══════════════════════════════════════════════════════════════
//  PLEASEME — Base de datos LOCAL dentro del navegador (sin servidor)
//
//  Cada equipo/navegador tiene su propia base de datos (IndexedDB
//  "pleaseme_bd_local"). No hay que instalar nada.
//
//  • Las páginas siguen llamando a SB_URL + '/rest/v1/<tabla>' (el mismo
//    formato que usaba Supabase). Este archivo intercepta esas llamadas:
//    con internet las sincroniza con Supabase (base principal) y siempre
//    las resuelve con la base local, así funciona también sin internet.
//  • pmAbrirBDLocal(): ventana "🗄 BD local" con:
//      - Traer mis datos: copia todo lo de Supabase y lo guardado en este
//        navegador a la base local (no borra nada; se puede repetir).
//      - Descargar respaldo (.json) y Restaurar: respaldo .json o el
//        registro de facturas descargado en Excel (.xlsx/.xls) o CSV.
//      - Respaldo diario automático a la hora de cierre, con notificación
//        y barra de progreso (copia en el equipo + archivo .json).
//
//  Debe cargarse ANTES que cualquier otro script de la página.
// ══════════════════════════════════════════════════════════════
(function(){
  'use strict';

  const PM_DB_URL = 'https://bd-local.pleaseme.invalid';   // dirección virtual: nunca sale a internet
  window.PM_DB_URL = PM_DB_URL;

  const IDB_NAME  = 'pleaseme_bd_local';
  const STORE     = 'registros';
  const META      = '_meta';          // tabla interna (estado de la migración)
  const PRIMARY_KEYS = { config: 'key' };
  const pkOf = t => PRIMARY_KEYS[t] || 'id';

  // Supabase anterior — solo se usa para LEER los datos durante la migración
  const LEGACY_SB_URL = 'https://sqcggascnbcnfkymqcql.supabase.co';
  const LEGACY_SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNxY2dnYXNjbmJjbmZreW1xY3FsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2ODQ2NzIsImV4cCI6MjA4NzI2MDY3Mn0.q0C_q3gOZZzcr6dWPrIhWS63gst5OBYIg9FDxThaKt4';
  const LEGACY_TABLES = ['facturas','clientes','productos','pedidos','config','company','admin_users','admin_auth','carriers'];

  const realFetch = window.fetch.bind(window);

  // Pide al navegador que no borre la base local cuando falte espacio
  try{ navigator.storage && navigator.storage.persist && navigator.storage.persist(); }catch{}

  // ── IndexedDB ───────────────────────────────────────────────
  let dbPromise = null;
  function openDB(){
    if(dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if(!db.objectStoreNames.contains(STORE)){
          const st = db.createObjectStore(STORE, { keyPath: ['tabla', 'id'] });
          st.createIndex('tabla', 'tabla');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { dbPromise = null; reject(req.error); };
    });
    return dbPromise;
  }

  const reqP = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

  async function allRows(table){
    const db = await openDB();
    const recs = await reqP(db.transaction(STORE, 'readonly').objectStore(STORE).index('tabla').getAll(table));
    return recs.map(r => r.datos);
  }

  async function allTables(){
    const db = await openDB();
    const keys = await reqP(db.transaction(STORE, 'readonly').objectStore(STORE).getAllKeys());
    const counts = {};
    keys.forEach(([t]) => { if(t !== META) counts[t] = (counts[t] || 0) + 1; });
    return counts;
  }

  // ops: [{put:[tabla,row]} | {del:[tabla,id]}] — todo en una sola transacción
  async function write(ops){
    if(!ops.length) return;
    const db = await openDB();
    const tx = db.transaction(STORE, 'readwrite');
    const st = tx.objectStore(STORE);
    const now = new Date().toISOString();
    ops.forEach(op => {
      if(op.put){ const [t, row] = op.put; st.put({ tabla: t, id: String(row[pkOf(t)]), datos: row, actualizado: now }); }
      if(op.del){ const [t, id] = op.del; st.delete([t, String(id)]); }
    });
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
  }

  async function getMeta(id){ return (await allRows(META)).find(r => r.id === id) || null; }
  async function setMeta(id, value){ await write([{ put: [META, { id, value }] }]); }

  // Completa llave primaria y created_at como lo hacía Postgres por defecto
  function withDefaults(table, row, existingRows){
    const pk = pkOf(table);
    const out = { ...row };
    if(out[pk] === undefined || out[pk] === null || out[pk] === ''){
      const ids = existingRows.map(r => r[pk]);
      const numeric = ids.length === 0 || ids.every(v => /^\d+$/.test(String(v)));
      out[pk] = numeric ? ids.reduce((m, v) => Math.max(m, Number(v)), 0) + 1
                        : (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2));
    }
    if(pk === 'id' && out.created_at === undefined) out.created_at = new Date().toISOString();
    return out;
  }

  // ── Consultas estilo PostgREST (igual que Supabase) ─────────
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

  function likeToRegex(p, flags){
    return new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/[*%]/g, '.*').replace(/_/g, '.') + '$', flags);
  }

  function matchOne(value, expr){
    let negate = false;
    if(expr.startsWith('not.')){ negate = true; expr = expr.slice(4); }
    const dot = expr.indexOf('.');
    const op  = dot >= 0 ? expr.slice(0, dot) : expr;
    const arg = dot >= 0 ? expr.slice(dot + 1) : '';
    const sv  = value === undefined || value === null ? null : (typeof value === 'object' ? JSON.stringify(value) : String(value));
    const cmp = (a, b) => (!isNaN(Number(a)) && !isNaN(Number(b))) ? Number(a) - Number(b) : String(a).localeCompare(String(b));
    let ok;
    switch(op){
      case 'eq':    ok = sv !== null && sv === arg; break;
      case 'neq':   ok = sv !== arg; break;
      case 'gt':    ok = sv !== null && cmp(sv, arg) >  0; break;
      case 'gte':   ok = sv !== null && cmp(sv, arg) >= 0; break;
      case 'lt':    ok = sv !== null && cmp(sv, arg) <  0; break;
      case 'lte':   ok = sv !== null && cmp(sv, arg) <= 0; break;
      case 'like':  ok = sv !== null && likeToRegex(arg, '').test(sv); break;
      case 'ilike': ok = sv !== null && likeToRegex(arg, 'i').test(sv); break;
      case 'is':    ok = arg === 'null' ? sv === null : (arg === 'true' ? (value === true || sv === 'true') : arg === 'false' ? (value === false || sv === 'false') : false); break;
      case 'in':    ok = sv !== null && arg.replace(/^\(|\)$/g, '').split(',').map(s => s.trim().replace(/^"|"$/g, '')).includes(sv); break;
      default:      ok = sv !== null && sv === expr;
    }
    return negate ? !ok : ok;
  }

  const filtersFrom = params => [...params].filter(([k]) => !RESERVED.has(k));
  const applyFilters = (rows, f) => rows.filter(r => f.every(([k, v]) => matchOne(readField(r, k), v)));

  function applyOrder(rows, order){
    if(!order) return rows;
    const keys = order.split(',').map(s => {
      const parts = s.trim().split('.');
      return { col: parts.filter(p => !['asc', 'desc', 'nullsfirst', 'nullslast'].includes(p)).join('.'), desc: parts.includes('desc') };
    });
    return [...rows].sort((a, b) => {
      for(const { col, desc } of keys){
        const va = readField(a, col), vb = readField(b, col);
        if(va === vb) continue;
        if(va == null) return 1;
        if(vb == null) return -1;
        const c = (typeof va === 'number' && typeof vb === 'number') ? va - vb : String(va).localeCompare(String(vb), 'es', { numeric: true });
        if(c !== 0) return desc ? -c : c;
      }
      return 0;
    });
  }

  function applySelect(rows, select){
    if(!select || select.split(',').map(s => s.trim()).includes('*')) return rows;
    const cols = select.split(',').map(s => s.trim()).filter(Boolean);
    return rows.map(r => {
      const o = {};
      cols.forEach(c => {
        const [src, alias] = c.includes(':') ? c.split(':').reverse() : [c, null];
        const v = readField(r, src);
        o[alias || src.split(/->>?/).pop()] = v === undefined ? null : v;
      });
      return o;
    });
  }

  function respond(status, body, headers = {}){
    const noBody = status === 204 || body === null || body === undefined;
    // Sin cuerpo no se declara JSON: así response.json() no falla con "Unexpected end of input"
    return new Response(noBody ? null : JSON.stringify(body), {
      status, headers: noBody ? { ...headers } : { 'Content-Type': 'application/json; charset=utf-8', ...headers },
    });
  }

  async function handleRest(table, params, method, headers, bodyText, info = {}){
    if(!/^[A-Za-z0-9_]+$/.test(table)) return respond(400, { message: 'Tabla inválida' });
    const pk = pkOf(table);
    const prefer = String(headers.get('prefer') || '');
    const pref = { repr: prefer.includes('return=representation'), merge: prefer.includes('resolution=merge-duplicates'), ignore: prefer.includes('resolution=ignore-duplicates') };
    const filters = filtersFrom(params);
    let body = null;
    if(bodyText){ try{ body = JSON.parse(bodyText); }catch{ return respond(400, { message: 'JSON inválido' }); } }
    const rows = await allRows(table);

    if(method === 'GET' || method === 'HEAD'){
      let out = applyOrder(applyFilters(rows, filters), params.get('order'));
      const total = out.length;
      let offset = Number(params.get('offset') || 0);
      let limit  = params.has('limit') ? Number(params.get('limit')) : null;
      const range = headers.get('range');
      if(range && /^\d+-\d*$/.test(range)){ const [a, b] = range.split('-'); offset = Number(a); if(b !== '') limit = Number(b) - Number(a) + 1; }
      out = out.slice(offset, limit === null ? undefined : offset + limit);
      return respond(200, applySelect(out, params.get('select')), { 'Content-Range': (out.length ? offset + '-' + (offset + out.length - 1) : '*') + '/' + total });
    }

    if(method === 'POST'){
      const list = Array.isArray(body) ? body : (body ? [body] : []);
      const conflictCol = params.get('on_conflict') || pk;
      const working = [...rows];
      const ops = [], saved = [];
      for(const input of list){
        const row = withDefaults(table, input, working);
        const idx = working.findIndex(r => String(r[conflictCol]) === String(row[conflictCol]));
        if(idx >= 0){
          if(pref.ignore){ saved.push(working[idx]); continue; }
          if(!pref.merge) return respond(409, { code: '23505', message: 'duplicate key value violates unique constraint (' + table + '.' + conflictCol + ')' });
          const merged = { ...working[idx], ...input, [pk]: working[idx][pk] };
          working[idx] = merged; ops.push({ put: [table, merged] }); saved.push(merged);
        } else {
          working.push(row); ops.push({ put: [table, row] }); saved.push(row);
        }
      }
      await write(ops);
      info.saved = saved;
      return respond(201, pref.repr ? saved : null);
    }

    if(method === 'PATCH'){
      if(!filters.length) return respond(400, { message: 'PATCH requiere un filtro (ej. id=eq.123)' });
      const updated = applyFilters(rows, filters).map(r => ({ ...r, ...(body || {}), [pk]: r[pk] }));
      await write(updated.map(r => ({ put: [table, r] })));
      return pref.repr ? respond(200, updated) : respond(204, null);
    }

    if(method === 'PUT'){
      const row = withDefaults(table, body || {}, rows);
      await write([{ put: [table, row] }]);
      info.saved = [row];
      return pref.repr ? respond(200, [row]) : respond(204, null);
    }

    if(method === 'DELETE'){
      if(!filters.length) return respond(400, { message: 'DELETE requiere un filtro (ej. id=eq.123)' });
      const removed = applyFilters(rows, filters);
      await write(removed.map(r => ({ del: [table, r[pk]] })));
      return pref.repr ? respond(200, removed) : respond(204, null);
    }
    return respond(405, { message: 'Método no permitido' });
  }

  // ══════════════════════════════════════════════════════════
  //  SUPABASE (nube) — conexión automática
  //
  //  Con internet, Supabase es la base principal: cada lectura se pide a
  //  Supabase y se copia a la base local; cada cambio se guarda primero en
  //  la base local y se sube a Supabase en orden (cola "pendientes").
  //  Sin internet se trabaja con la base local y la cola se sube sola al
  //  volver la conexión.
  // ══════════════════════════════════════════════════════════
  const NUBE_TIMEOUT = 10000, NUBE_REINTENTO = 30000;
  let nube = 'conectando';            // 'conectando' | 'conectada' | 'sin-conexion'
  let nubeError = '';
  let nubeHasta = 0;                  // tras un fallo no se reintenta hasta esta hora
  const soloLocal = new Set([META, 'impresiones']);  // tablas que no existen en Supabase (impresiones: historial de impresión de este equipo)

  function marcarNube(estado, error){
    nube = estado; nubeError = error || '';
    if(estado === 'sin-conexion') nubeHasta = Date.now() + NUBE_REINTENTO;
    pintarEstado();
  }

  async function nubeFetch(pathQuery, method, prefer, body, range){
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), NUBE_TIMEOUT);
    const h = { apikey: LEGACY_SB_KEY, Authorization: 'Bearer ' + LEGACY_SB_KEY, 'Content-Type': 'application/json' };
    if(prefer) h.Prefer = prefer;
    if(range) h.Range = range;
    try{ return await realFetch(LEGACY_SB_URL + pathQuery, { method, headers: h, body: body == null ? undefined : JSON.stringify(body), signal: ctl.signal }); }
    finally{ clearTimeout(t); }
  }
  const tablaNoExiste = (r, txt) => r.status === 404 || /PGRST205|42P01|does not exist|Could not find the table/.test(txt);

  // Envía un cambio a Supabase. Si Supabase no tiene alguna columna, la quita y reintenta
  // (esa columna queda guardada solo en la base local).
  async function nubeEscribir(op){
    let body = op.body;
    for(let i = 0; i < 20; i++){
      if(body && !Array.isArray(body) && !Object.keys(body).length) return { ok: true };
      const r = await nubeFetch(op.pq, op.method, op.prefer, body);
      if(r.ok) return { ok: true };
      const txt = await r.text().catch(() => '');
      if(r.status >= 500 || r.status === 0) throw new Error('Supabase HTTP ' + r.status);
      const m = txt.match(/Could not find the '([^']+)' column/);
      if(m && body){ const quitar = o => { const c = { ...o }; delete c[m[1]]; return c; }; body = Array.isArray(body) ? body.map(quitar) : quitar(body); continue; }
      if(tablaNoExiste(r, txt)) soloLocal.add(op.tabla);
      return { ok: false, error: 'HTTP ' + r.status + ' ' + txt };
    }
    return { ok: false, error: 'demasiadas columnas desconocidas' };
  }

  // Cola de cambios pendientes de subir (se guarda en la base local)
  let colaLock = Promise.resolve();
  const conCola = fn => (colaLock = colaLock.then(fn, fn));
  const leerCola = async () => ((await getMeta('pendientes_nube')) || {}).value || [];
  let pendientes = 0;
  function encolar(op){
    return conCola(async () => { const q = await leerCola(); q.push(op); await setMeta('pendientes_nube', q); pendientes = q.length; pintarEstado(); });
  }

  let enviando = null;
  // Devuelve true si la cola quedó vacía (todo está en Supabase)
  function enviarPendientes(){
    if(enviando) return enviando;
    enviando = (async () => {
      try{
        for(;;){
          const op = (await conCola(leerCola))[0];
          if(!op){ pendientes = 0; return true; }
          if(Date.now() < nubeHasta) return false;
          let r;
          try{ r = await nubeEscribir(op); }
          catch(e){ marcarNube('sin-conexion', e.message); return false; }
          if(!r.ok) console.warn('[Supabase] no se pudo subir un cambio de ' + op.tabla + ' (queda en la base local):', r.error);
          await conCola(async () => { const q = await leerCola(); q.shift(); await setMeta('pendientes_nube', q); pendientes = q.length; });
          if(nube !== 'conectada') marcarNube('conectada');
        }
      }finally{ enviando = null; pintarEstado(); }
    })();
    return enviando;
  }

  // Lee de Supabase y copia el resultado a la base local
  async function nubeLeer(table, u, headers){
    if(soloLocal.has(table) || Date.now() < nubeHasta) return;
    if(!(await enviarPendientes())) return;            // primero suben los cambios hechos aquí
    let r, txt;
    try{
      const q = new URLSearchParams(u.searchParams);
      q.set('select', '*');                              // fila completa para la copia local
      r = await nubeFetch(u.pathname + '?' + q.toString(), 'GET', null, null, headers.get('range'));
      txt = await r.text();
    }catch(e){ marcarNube('sin-conexion', e.name === 'AbortError' ? 'Supabase no responde' : e.message); return; }
    if(r.status >= 500){ marcarNube('sin-conexion', 'Supabase HTTP ' + r.status); return; }
    marcarNube('conectada');
    subirLocalesUnaVez();
    if(!r.ok){ if(tablaNoExiste(r, txt)) soloLocal.add(table); return; }
    let rows; try{ rows = JSON.parse(txt); }catch{ return; }
    const pk = pkOf(table);
    if(Array.isArray(rows) && rows.length && rows.every(x => x && x[pk] != null)) await importRows(table, rows, 'nube');
  }

  // Una sola vez por equipo: sube a Supabase lo que solo está en la base local
  // (facturas hechas sin conexión o mientras el sistema no usaba Supabase).
  // Solo agrega lo que falta: nunca cambia ni borra nada en Supabase.
  let subiendo = null;
  function subirLocalesUnaVez(){
    if(subiendo) return subiendo;
    subiendo = (async () => {
      if(await getMeta('subida_inicial')) return;
      const tablas = Object.keys(await allTables()).filter(t => !soloLocal.has(t));
      for(const t of tablas){
        const pk = pkOf(t);
        const cols = t === 'facturas' ? 'id,invoice_num,items' : pk;
        const enNube = [];
        for(let from = 0; ; from += 1000){
          const r = await nubeFetch('/rest/v1/' + t + '?select=' + cols, 'GET', null, null, from + '-' + (from + 999));
          if(!r.ok){ if(r.status >= 500) throw new Error('Supabase HTTP ' + r.status); soloLocal.add(t); break; }
          const page = await r.json();
          enNube.push(...page);
          if(page.length < 1000) break;
        }
        if(soloLocal.has(t)) continue;
        const ids = new Set(enNube.map(x => String(x[pk])));
        const nums = new Set(enNube.map(numOf).filter(Boolean));
        const sinArt = new Set(t === 'facturas' ? enNube.filter(x => !hasItems(x)).map(x => String(x.id)) : []);
        for(const row of await allRows(t)){
          const id = String(row[pk]);
          if(ids.has(id)){
            if(sinArt.has(id) && hasItems(row)) await encolar({ tabla: t, pq: '/rest/v1/facturas?id=eq.' + encodeURIComponent(id), method: 'PATCH', prefer: 'return=minimal', body: { items: itemsOf(row) } });
            continue;
          }
          if(isDemo(t, { ...(row.record || {}), ...row })) continue;
          if(t === 'facturas' && id.startsWith('fac-imp-') && nums.has(numOf(row))) continue;   // copia resumida de una factura que ya está
          await encolar({ tabla: t, pq: '/rest/v1/' + t, method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal', body: row });
        }
      }
      await setMeta('subida_inicial', new Date().toISOString());
      enviarPendientes();
    })().catch(e => { console.warn('[Supabase] subida inicial:', e.message); subiendo = null; });
    return subiendo;
  }

  // ── Indicador de conexión (Facturación y Admin) ─────────────
  const conIndicador = !/tienda|account/i.test(location.pathname);
  function pintarEstado(){
    if(!conIndicador || !document.body || document.readyState === 'loading') return;
    let el = document.getElementById('pmNubeEstado');
    if(!el){
      // Solo texto, sin tarjeta. Si la página tiene menú lateral va en su pie; si no, abajo a la izquierda
      el = document.createElement('div');
      el.id = 'pmNubeEstado';
      el.innerHTML = '<span class="ic"></span> <span class="tx"></span>';
      el.onclick = () => { nubeHasta = 0; enviarPendientes(); alert(pmEstadoNube().texto + (nubeError ? '\n\nDetalle: ' + nubeError : '')); };
      const slot = document.getElementById('pmNubeSlot');
      if(slot) slot.appendChild(el);
      else {
        el.style.cssText = 'position:fixed;left:12px;bottom:10px;z-index:99990;font:600 10px system-ui,-apple-system,Segoe UI,sans-serif;cursor:pointer;text-shadow:0 1px 2px rgba(0,0,0,.6)';
        document.body.appendChild(el);
      }
    }
    const e = pmEstadoNube();
    el.querySelector('.ic').textContent = e.icono;
    el.querySelector('.tx').textContent = e.corto;
    el.title = e.texto;
    el.style.color = e.estado === 'conectada' && !pendientes ? '#2fe3b5' : '#e8c56e';
  }
  function pmEstadoNube(){
    const p = pendientes ? ' · ' + pendientes + ' cambio' + (pendientes === 1 ? '' : 's') + ' por subir' : '';
    if(nube === 'conectada') return { estado: nube, icono: '☁', corto: 'Supabase conectado' + p, texto: 'Conectado a Supabase. Los datos se guardan en la nube y en este equipo.' + p };
    if(nube === 'sin-conexion') return { estado: nube, icono: '⚠', corto: 'Sin conexión a Supabase' + p, texto: 'No hay conexión con Supabase. Se guarda en este equipo y se sube solo cuando vuelva internet.' + p };
    return { estado: nube, icono: '…', corto: 'Conectando a Supabase' + p, texto: 'Conectando a Supabase…' };
  }
  window.pmEstadoNube = pmEstadoNube;
  document.addEventListener('DOMContentLoaded', pintarEstado);
  window.addEventListener('online', () => { nubeHasta = 0; enviarPendientes(); });
  setInterval(() => { if(pendientes || nube !== 'conectada'){ enviarPendientes().then(ok => { if(ok && nube !== 'conectada') nubeFetch('/rest/v1/config?select=key&limit=1', 'GET').then(r => r.status < 500 && marcarNube('conectada'), () => {}); }); } }, 60000);
  leerCola().then(q => { pendientes = q.length; pintarEstado(); }).catch(() => {});

  // ── Interceptar fetch hacia la base de datos ────────────────
  // Protección: guardar una factura con la lista de artículos vacía NO borra los artículos que
  // ya tenga (aquí ni en Supabase). Se quita "items" del cambio cuando viene vacío; así abrir,
  // imprimir o guardar una factura incompleta no pisa la copia buena.
  function sinItemsVacios(bodyText){
    let body;
    try{ body = JSON.parse(bodyText); }catch{ return bodyText; }
    const vacio = v => v === null || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'string' && /^\s*(\[\s*\]|null)\s*$/.test(v));
    let cambio = false;
    (Array.isArray(body) ? body : [body]).forEach(r => { if(r && typeof r === 'object' && 'items' in r && vacio(r.items)){ delete r.items; cambio = true; } });
    return cambio ? JSON.stringify(body) : bodyText;
  }

  window.fetch = async function(input, init){
    const url = typeof input === 'string' ? input : (input && input.url) || String(input);
    if(!url.startsWith(PM_DB_URL)) return realFetch(input, init);
    try{
      const u = new URL(url);
      const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      const headers = new Headers((init && init.headers) || (input && input.headers) || {});
      let bodyText = init && typeof init.body === 'string' ? init.body : null;
      if(!u.pathname.startsWith('/rest/v1/')) return respond(404, { message: 'Ruta no encontrada' });
      const table = u.pathname.slice('/rest/v1/'.length).replace(/\/+$/, '');
      if(table === 'facturas' && bodyText && method !== 'GET' && method !== 'HEAD') bodyText = sinItemsVacios(bodyText);
      if(table === 'facturas') await autoItems;   // primero se recuperan los artículos del navegador
      if(method === 'GET' || method === 'HEAD') await nubeLeer(table, u, headers);
      const info = {};
      const res = await handleRest(table, u.searchParams, method, headers, bodyText, info);
      if(method !== 'GET' && method !== 'HEAD' && res.ok && !soloLocal.has(table) && /^[A-Za-z0-9_]+$/.test(table)){
        const prefer = String(headers.get('prefer') || '').split(',').map(x => x.trim()).filter(x => x && !x.startsWith('return=')).concat('return=minimal').join(',');
        let body = null;
        if(info.saved) body = method === 'PUT' ? info.saved[0] : info.saved;          // con el ID que se le dio aquí
        else if(bodyText){ try{ body = JSON.parse(bodyText); }catch{} }
        const q = new URLSearchParams(u.searchParams);
        if(method === 'PUT'){ q.set(pkOf(table), 'eq.' + body[pkOf(table)]); }
        const pq = u.pathname + (method === 'POST' ? (q.has('on_conflict') ? '?on_conflict=' + encodeURIComponent(q.get('on_conflict')) : '') : '?' + q.toString());
        await encolar({ tabla: table, pq, method: method === 'PUT' ? 'POST' : method, prefer: method === 'PUT' ? 'resolution=merge-duplicates,return=minimal' : prefer, body });
        enviarPendientes();
      }
      return res;
    }catch(e){
      console.error('[BD local]', e);
      return respond(500, { message: 'Base de datos local: ' + (e && e.message || e) });
    }
  };

  // ══════════════════════════════════════════════════════════
  //  MIGRACIÓN — traer datos de Supabase y de este navegador
  // ══════════════════════════════════════════════════════════
  function isEmpty(v){ return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0); }

  // modo "reemplazar": los datos que llegan mandan (se usa con Supabase la primera vez)
  // modo "completar":  agrega lo que falta y solo llena campos vacíos (nunca pisa cambios locales)
  async function importRows(table, list, mode){
    const pk = pkOf(table);
    const rows = await allRows(table);
    const byId = new Map(rows.map(r => [String(r[pk]), r]));
    const ops = [];
    let nuevos = 0, actualizados = 0;
    // Facturas restauradas antes desde un Excel resumido (id "fac-imp-…"): la factura
    // completa con el mismo número las reemplaza en vez de quedar duplicada.
    const impByNum = new Map();
    if(table === 'facturas') rows.forEach(r => { if(String(r.id).startsWith('fac-imp-') && r.invoice_num) impByNum.set(String(r.invoice_num).trim(), r); });
    list.forEach(input => {
      if(!input || typeof input !== 'object' || isEmpty(input[pk])) return;
      const key = String(input[pk]);
      const existing = byId.get(key);
      const imp = !existing && !key.startsWith('fac-imp-') && input.invoice_num ? impByNum.get(String(input.invoice_num).trim()) : null;
      if(imp && byId.get(String(imp.id)) === imp){
        const row = { ...imp, ...Object.fromEntries(Object.entries(input).filter(([, v]) => !isEmpty(v))) };
        byId.delete(String(imp.id)); byId.set(key, row);
        ops.push({ del: [table, imp.id] }, { put: [table, row] }); actualizados++; return;
      }
      if(!existing){
        const row = withDefaults(table, input, rows);
        byId.set(key, row); ops.push({ put: [table, row] }); nuevos++; return;
      }
      let changed = false;
      const merged = { ...existing };
      for(const [k, v] of Object.entries(input)){
        const distinto = JSON.stringify(existing[k]) !== JSON.stringify(v);
        // 'nube': manda Supabase, pero una factura sin artículos en la nube no borra los de aquí
        const take = mode === 'nube' ? distinto && !(k === 'items' && isEmpty(v) && !isEmpty(existing[k]))
          : mode === 'reemplazar' ? distinto : (isEmpty(existing[k]) && !isEmpty(v));
        if(take){ merged[k] = v; changed = true; }
      }
      if(changed){ byId.set(key, merged); ops.push({ put: [table, merged] }); actualizados++; }
    });
    await write(ops);
    return { nuevos, actualizados };
  }

  // Supabase
  async function readLegacyTable(table){
    const H = { apikey: LEGACY_SB_KEY, Authorization: 'Bearer ' + LEGACY_SB_KEY };
    const rows = [], PAGE = 1000;
    for(let from = 0; ; from += PAGE){
      const r = await realFetch(LEGACY_SB_URL + '/rest/v1/' + table + '?select=*', { headers: { ...H, Range: from + '-' + (from + PAGE - 1) } });
      if(r.status === 404 || r.status === 400) return null;     // la tabla no existe
      if(!r.ok) throw new Error('HTTP ' + r.status);
      const page = await r.json();
      rows.push(...page);
      if(page.length < PAGE) break;
    }
    return rows;
  }

  async function collectFromSupabase(log){
    const names = new Set(LEGACY_TABLES);
    try{
      const r = await realFetch(LEGACY_SB_URL + '/rest/v1/', { headers: { apikey: LEGACY_SB_KEY, Authorization: 'Bearer ' + LEGACY_SB_KEY } });
      if(r.ok){ const spec = await r.json(); Object.keys(spec.definitions || (spec.components && spec.components.schemas) || {}).forEach(n => names.add(n)); }
    }catch{}
    const out = {};
    let fails = 0;
    for(const t of [...names].filter(n => /^[A-Za-z0-9_]+$/.test(n))){
      try{ const rows = await readLegacyTable(t); if(rows){ out[t] = rows; log('  · ' + t + ': ' + rows.length); } }
      catch(e){ fails++; log('  ⚠ ' + t + ': ' + e.message); }
    }
    return { tablas: out, ok: fails === 0 };
  }

  // Este navegador (IndexedDB de Facturación y localStorage)
  function readOldIndexedDB(){
    return new Promise(resolve => {
      let req;
      try{ req = indexedDB.open('pleaseme_facturacion'); }catch{ return resolve({}); }
      req.onupgradeneeded = () => { try{ req.transaction.abort(); }catch{} };   // no crearla si no existe
      req.onerror = () => resolve({});
      req.onsuccess = () => {
        const idb = req.result;
        const stores = ['facturas', 'clientes', 'productos'].filter(s => idb.objectStoreNames.contains(s));
        if(!stores.length){ idb.close(); return resolve({}); }
        const tx = idb.transaction(stores, 'readonly'), out = {};
        stores.forEach(s => { const g = tx.objectStore(s).getAll(); g.onsuccess = () => { out[s] = g.result || []; }; });
        tx.oncomplete = () => { idb.close(); resolve(out); };
        tx.onerror = () => { idb.close(); resolve(out); };
      };
    });
  }

  function lsArray(k){ try{ const v = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(v) ? v : []; }catch{ return []; } }
  function clean(o){ const c = { ...o }; delete c.pending_sync; Object.keys(c).forEach(k => c[k] === undefined && delete c[k]); return c; }
  function pick(...v){ return v.find(x => x !== undefined && x !== null && x !== ''); }

  // Datos de demostración que crea admin.html cuando la base está vacía — no se migran
  const DEMO = { productos: /^p[1-5]$/, pedidos: /^ORD-000[1-5]$/, clientes: /^c[1-4]$/ };
  const DEMO_NAMES = /Cadena Gold Luxe|Set Night Gold|Anillo Golden Minimal|Pulsera Black Premium|Tobillera Dorada Midi|María García|Sofía Méndez|Valentina Cruz|Isabella Reyes/;
  const isDemo = (t, o) => DEMO[t] && DEMO[t].test(String(o.id)) && DEMO_NAMES.test(JSON.stringify(o));

  const toFactura = o => clean({ ...o,
    invoice_num: pick(o.invoice_num, o.invoiceNum), invoice_date: pick(o.invoice_date, (o.created_at || '').slice(0, 10)),
    client_name: pick(o.client_name, o.clientName), client_email: pick(o.client_email, o.clientEmail),
    client_phone: pick(o.client_phone, o.clientPhone), client_address: pick(o.client_address, o.address),
    shipping_address_usa: pick(o.shipping_address_usa, o.address_usa), casillero_number: pick(o.casillero_number, o.casillero),
    discount_amount: pick(o.discount_amount, o.discountAmount), shipping: pick(o.shipping, o.shipping_cost) });
  const toPedido = o => o.record ? clean(o) : clean({ id: o.id, record: clean(o), created_at: o.created_at, status: o.status,
    client_name: pick(o.clientName, o.name), client_email: pick(o.clientEmail, o.email), client_phone: pick(o.clientPhone, o.phone),
    total: o.total, shipping_address: pick(o.shippingAddress, o.address), payment_method: o.method, tracking_num: o.trackingNum });
  const toCliente = c => c.record ? clean(c) : clean({ id: c.id, record: clean(c), created_at: c.created_at, name: c.name, email: c.email,
    phone: c.phone, shipping_address: pick(c.shipping_address, c.address), billing_address: c.billing_address,
    preferred_payment: c.preferred_payment, orders_count: c.orders_count });
  const toProducto = p => p.record ? clean(p) : clean({ id: p.id, record: clean(p), created_at: p.created_at, active: p.active !== false,
    name: p.name, price: p.price, stock: p.stock, sku: p.sku, category: p.category });
  const isFactura = o => String(o.id || '').startsWith('fac-') || 'invoice_date' in o || 'client_address' in o;

  async function collectFromBrowser(log){
    const idb = await readOldIndexedDB();
    const orders = [...lsArray('pm_orders_v1'), ...lsArray('pm_orders')];
    const byId = list => { const m = new Map(); list.filter(x => x && x.id).forEach(x => m.set(String(x.id), { ...(m.get(String(x.id)) || {}), ...x })); return [...m.values()]; };
    const out = {
      facturas:  byId([...(idb.facturas || []), ...orders.filter(isFactura)]).map(toFactura),
      pedidos:   byId(orders.filter(o => !isFactura(o))).filter(o => !isDemo('pedidos', o)).map(toPedido),
      clientes:  byId([...(idb.clientes || []), ...lsArray('pm_clients_v1')]).filter(o => !isDemo('clientes', o)).map(toCliente),
      productos: byId([...(idb.productos || []), ...lsArray('pm_products_v1')]).filter(o => !isDemo('productos', o)).map(toProducto),
    };
    Object.entries(out).forEach(([t, r]) => log('  · ' + t + ': ' + r.length));
    return out;
  }

  // Borra los datos de demostración que admin.html pudo haber creado en la base local vacía
  async function removeDemo(){
    const ops = [];
    for(const t of Object.keys(DEMO)){
      (await allRows(t)).forEach(r => { if(isDemo(t, { ...(r.record || {}), ...r })) ops.push({ del: [t, r[pkOf(t)]] }); });
    }
    await write(ops);
    return ops.length;
  }

  // ── Respaldo ────────────────────────────────────────────────
  async function exportBackup(){
    const db = await openDB();
    const recs = await reqP(db.transaction(STORE, 'readonly').objectStore(STORE).getAll());
    const tablas = {};
    recs.forEach(r => { if(r.tabla !== META) (tablas[r.tabla] = tablas[r.tabla] || []).push(r.datos); });
    const blob = new Blob([JSON.stringify({ app: 'pleaseme', exportado: new Date().toISOString(), tablas }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'pleaseme-respaldo-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    await setMeta('ultimo_respaldo', new Date().toISOString());
  }

  function pickFile(){
    return new Promise(resolve => {
      const inp = document.createElement('input');
      inp.type = 'file';   // sin filtro: se reconoce por el contenido
      inp.onchange = () => resolve(inp.files && inp.files[0] || null);
      inp.click();
    });
  }

  // ── Restaurar facturas desde Excel (.xlsx/.xls) o CSV ───────
  //  Acepta el registro descargado con "⬇ CSV" (Facturación o Admin),
  //  aunque se haya abierto y guardado en Excel.
  const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const COLS = {
    id:              ['id'],
    invoice_num:     ['nofactura', 'nfactura', 'numfactura', 'numerofactura', 'factura', 'nodefactura', 'invoicenum', 'invoice', 'numero', 'no'],
    client_name:     ['cliente', 'nombre', 'nombrecliente', 'clientname', 'client'],
    client_email:    ['email', 'correo', 'correoelectronico', 'clientemail'],
    client_phone:    ['telefono', 'tel', 'celular', 'whatsapp', 'phone', 'clientphone'],
    client_address:  ['direccion', 'address', 'clientaddress'],
    subtotal:        ['subtotal'],
    shipping:        ['envio', 'shipping'],
    discount_amount: ['descuento', 'discount', 'discountamount'],
    total:           ['total', 'monto', 'importe'],
    status:          ['estado', 'status'],
    payment_method:  ['metodopago', 'metododepago', 'formadepago', 'pago', 'paymentmethod'],
    fecha:           ['fecha', 'fechafactura', 'date', 'invoicedate', 'createdat'],
    notes:           ['notas', 'nota', 'notes', 'observaciones'],
    shipping_address_usa: ['direccionusa', 'direccionenusa', 'shippingaddressusa', 'addressusa'],
    casillero_number: ['casillero', 'nocasillero', 'casilleronumber'],
    currency:        ['moneda', 'currency'],
    tracking_number: ['tracking', 'notracking', 'numerotracking', 'trackingnumber', 'guia'],
    tracking_status: ['estadotracking', 'estadoenvio', 'trackingstatus'],
    void_reason:     ['motivoanulacion', 'motivocancelacion', 'voidreason'],
    items_text:      ['articulos', 'productos', 'items'],
    datos:           ['datoscompletosnoeditar', 'datoscompletos', 'datosnoeditar', 'datos'],
  };
  const NUMERIC = ['subtotal', 'shipping', 'discount_amount', 'total'];

  function parseCSV(text){
    text = text.replace(/^﻿/, '');
    const first = text.split(/\r?\n/, 1)[0];
    const count = c => first.split(c).length - 1;
    const sep = [';', '\t', ','].reduce((a, b) => count(b) > count(a) ? b : a, ',');
    const rows = []; let row = [], cell = '', q = false;
    for(let i = 0; i < text.length; i++){
      const ch = text[i];
      if(q){
        if(ch === '"'){ if(text[i + 1] === '"'){ cell += '"'; i++; } else q = false; }
        else cell += ch;
      }
      else if(ch === '"' && cell === '') q = true;
      else if(ch === sep){ row.push(cell); cell = ''; }
      else if(ch === '\n' || ch === '\r'){
        if(ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      }
      else cell += ch;
    }
    if(cell !== '' || row.length){ row.push(cell); rows.push(row); }
    return rows;
  }

  function loadScript(src){
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res;
      s.onerror = () => rej(new Error('No se pudo cargar el lector de Excel (necesita internet). Guarda el archivo como CSV en Excel y vuelve a intentarlo.'));
      document.head.appendChild(s);
    });
  }

  const XLSX_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';

  // Devuelve [{ nombre, filas }] — un CSV es una sola hoja
  async function readSheets(file){
    const h = new Uint8Array(await file.slice(0, 2).arrayBuffer());
    const excel = /\.(xlsx|xls)$/i.test(file.name) || (h[0] === 0x50 && h[1] === 0x4b) || (h[0] === 0xd0 && h[1] === 0xcf);
    if(!excel) return [{ nombre: file.name, filas: parseCSV(await file.text()) }];
    if(!window.XLSX) await loadScript(XLSX_SRC);
    const wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array' });
    return wb.SheetNames.map(n => ({ nombre: n, filas: window.XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' }) }));
  }

  // Hoja "Artículos": una fila por artículo → { 'No. factura': [items] }
  function itemsFromSheet(table){
    const hIdx = table.slice(0, 10).findIndex(r => r.some(c => ['nofactura', 'factura'].includes(norm(c))) && r.some(c => ['articulo', 'producto', 'nombre'].includes(norm(c))));
    if(hIdx < 0) return null;
    const h = table[hIdx].map(norm);
    const at = names => h.findIndex(c => names.includes(c));
    const c = { num: at(['nofactura', 'factura']), name: at(['articulo', 'producto', 'nombre']), qty: at(['cantidad', 'qty']),
      price: at(['precio', 'preciounitario', 'price']), size: at(['talla', 'tamano', 'size']), color: at(['color']) };
    const out = {};
    table.slice(hIdx + 1).forEach(r => {
      const num = String(r[c.num] ?? '').trim(), name = String(r[c.name] ?? '').trim();
      if(!num || !name) return;
      (out[num] = out[num] || []).push({ name, qty: c.qty >= 0 ? toNumber(r[c.qty]) || 1 : 1, price: c.price >= 0 ? toNumber(r[c.price]) : 0,
        size: c.size >= 0 ? String(r[c.size] ?? '').trim() : '', color: c.color >= 0 ? String(r[c.color] ?? '').trim() || '—' : '—' });
    });
    return out;
  }

  function toNumber(v){
    if(typeof v === 'number') return v;
    let s = String(v || '').replace(/[^\d,.\-]/g, '');
    if(!s) return 0;
    const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
    if(lc > ld) s = /,\d{1,2}$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    else s = s.replace(/,/g, '');
    const n = Number(s);
    return isNaN(n) ? 0 : n;
  }

  // Devuelve AAAA-MM-DD o '' (acepta fecha ISO, dd/mm/aaaa y el número de fecha de Excel)
  function toDate(v){
    const pad = n => String(n).padStart(2, '0');
    if(typeof v === 'number' && v > 20000 && v < 80000){
      const d = new Date(Math.round((v - 25569) * 86400000));
      return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
    }
    const s = String(v || '').trim();
    let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if(m) return m[1] + '-' + pad(m[2]) + '-' + pad(m[3]);
    m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
    if(m){
      let [, a, b, y] = m;
      if(y.length === 2) y = '20' + y;
      const [d, mo] = Number(b) > 12 ? [b, a] : [a, b];       // dd/mm salvo que no pueda ser
      return y + '-' + pad(mo) + '-' + pad(d);
    }
    return '';
  }

  function sheetToFacturas(table, existing, itemsByNum){
    const hIdx = table.slice(0, 10).findIndex(r => r.filter(c => Object.values(COLS).some(a => a.includes(norm(c)))).length >= 2);
    if(hIdx < 0) throw new Error('No encontré los encabezados (No. Factura, Cliente, Total, Fecha…) en el archivo.');
    const col = {};
    table[hIdx].forEach((h, i) => {
      const n = norm(h);
      for(const [field, alias] of Object.entries(COLS)) if(col[field] === undefined && alias.includes(n)){ col[field] = i; break; }
    });
    const byNum = new Map(existing.filter(f => f.invoice_num).map(f => [String(f.invoice_num).trim(), f.id]));
    const ids = new Set(existing.map(f => String(f.id)));
    const out = [];
    table.slice(hIdx + 1).forEach((r, i) => {
      const get = f => col[f] === undefined ? '' : r[col[f]];
      const txt = f => String(get(f) == null ? '' : get(f)).trim();
      if(!r.some(c => String(c).trim() !== '')) return;
      let id = txt('id'), num = txt('invoice_num');
      if(id && !id.startsWith('fac-') && !ids.has(id)){ if(!num) num = id; id = ''; }
      if(!id && num) id = byNum.get(num) || '';
      if(!id) id = 'fac-imp-' + (num ? num.replace(/[^A-Za-z0-9_-]/g, '') : '') + '-' + (i + 1);
      let full = null;
      if(txt('datos').startsWith('{')){ try{ full = JSON.parse(txt('datos')); }catch{} }
      if(full && typeof full === 'object' && !Array.isArray(full)){
        // Copia exacta de la factura (columna "Datos completos" de la exportación)
        if(!full.id) full.id = id;
        const same = full.invoice_num ? byNum.get(String(full.invoice_num).trim()) : null;
        if(!ids.has(String(full.id)) && same && !String(same).startsWith('fac-imp-')) full.id = same;
        ids.add(String(full.id));
        if(full.invoice_num) byNum.set(String(full.invoice_num).trim(), full.id);
        out.push(full);
        return;
      }
      const fecha = toDate(get('fecha'));
      const f = { id, invoice_num: num, client_name: txt('client_name'), client_email: txt('client_email'),
        client_phone: txt('client_phone'), client_address: txt('client_address'), status: txt('status').toLowerCase(),
        payment_method: txt('payment_method'), notes: txt('notes'), invoice_date: fecha,
        shipping_address_usa: txt('shipping_address_usa'), casillero_number: txt('casillero_number'), currency: txt('currency'),
        tracking_number: txt('tracking_number'), tracking_status: txt('tracking_status'), void_reason: txt('void_reason'),
        created_at: fecha ? fecha + 'T12:00:00.000Z' : '' };
      if(itemsByNum && num && itemsByNum[num]) f.items = itemsByNum[num];
      NUMERIC.forEach(k => { if(col[k] !== undefined && txt(k) !== '') f[k] = toNumber(get(k)); });
      if(!f.client_name && !f.invoice_num && f.total === undefined) return;
      Object.keys(f).forEach(k => { if(f[k] === '') delete f[k]; });
      if(!ids.has(id)){
        Object.assign(f, { status: f.status || 'pendiente', items: f.items || [], currency: f.currency || 'USD',
          subtotal: f.subtotal ?? f.total ?? 0, total: f.total ?? 0, shipping: f.shipping ?? 0, discount_amount: f.discount_amount ?? 0,
          created_at: f.created_at || new Date().toISOString() });
        f.invoice_date = f.invoice_date || f.created_at.slice(0, 10);
      }
      ids.add(id);
      if(num) byNum.set(num, id);
      out.push(f);
    });
    return out;
  }

  // ── Exportar el registro de facturas COMPLETO a Excel ───────
  //  Hoja "Facturas": una fila por factura con todos sus datos, más la columna
  //  "Datos completos" (copia exacta) para poder restaurarla sin perder nada.
  //  Hoja "Artículos": una fila por artículo de cada factura.
  //  Sin internet (no carga el lector de Excel) se descarga un CSV con la hoja Facturas.
  const fmtItems = items => (Array.isArray(items) ? items : []).map(i => (i.qty || 1) + ' x ' + (i.name || '') +
    (i.size && i.size !== '—' ? ' (' + i.size + ')' : '') + ' @ ' + Number(i.price || 0).toFixed(2)).join(' | ');
  const itemsOf = f => { if(Array.isArray(f.items)) return f.items; try{ const v = JSON.parse(f.items || '[]'); return Array.isArray(v) ? v : []; }catch{ return []; } };

  async function exportFacturas(){
    const facturas = applyOrder(await allRows('facturas'), 'created_at.desc');
    if(!facturas.length) throw new Error('No hay facturas en la base local.');
    const head = ['No. Factura', 'Fecha', 'Estado', 'Cliente', 'Email', 'Teléfono', 'Dirección', 'Dirección USA', 'Casillero',
      'Artículos', 'Subtotal', 'Envío', 'Descuento', 'Total', 'Método de pago', 'Moneda', 'Tracking', 'Estado tracking',
      'Notas', 'Motivo anulación', 'ID', 'Datos completos (no editar)'];
    const n = v => Number(v || 0);
    const rows = facturas.map(f => [f.invoice_num || '', f.invoice_date || String(f.created_at || '').slice(0, 10), f.status || '',
      f.client_name || '', f.client_email || '', f.client_phone || '', f.client_address || '', f.shipping_address_usa || '', f.casillero_number || '',
      fmtItems(itemsOf(f)), n(f.subtotal), n(f.shipping), n(f.discount_amount), n(f.total), f.payment_method || '', f.currency || '',
      f.tracking_number || '', f.tracking_status || '', f.notes || '', f.void_reason || '', f.id, JSON.stringify({ ...f, items: itemsOf(f) })]);
    const fecha = new Date().toISOString().slice(0, 10);
    const download = (blob, name) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    };
    try{
      if(!window.XLSX) await loadScript(XLSX_SRC);
      const X = window.XLSX, wb = X.utils.book_new();
      const ws = X.utils.aoa_to_sheet([head, ...rows]);
      ws['!cols'] = head.map((h, i) => ({ wch: i === 9 ? 60 : i === head.length - 1 ? 20 : 16 }));
      X.utils.book_append_sheet(wb, ws, 'Facturas');
      const art = [['No. Factura', 'Fecha', 'Cliente', 'Artículo', 'Talla', 'Color', 'Cantidad', 'Precio', 'Importe']];
      facturas.forEach(f => itemsOf(f).forEach(i => art.push([f.invoice_num || '', f.invoice_date || String(f.created_at || '').slice(0, 10),
        f.client_name || '', i.name || '', i.size || '', i.color || '', n(i.qty) || 1, n(i.price), (n(i.qty) || 1) * n(i.price)])));
      X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(art), 'Artículos');
      download(new Blob([X.write(wb, { type: 'array', bookType: 'xlsx' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'facturas-' + fecha + '.xlsx');
      return { archivo: 'xlsx', total: facturas.length };
    }catch(e){
      console.warn('[BD local] Excel no disponible, se exporta CSV:', e && e.message);
      const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
      const csv = [head, ...rows].map(r => r.map(q).join(',')).join('\r\n');
      download(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }), 'facturas-' + fecha + '.csv');
      return { archivo: 'csv', total: facturas.length };
    }
  }
  window.pmExportarFacturas = exportFacturas;

  // ── Recuperar los artículos de las facturas ─────────────────
  //  Busca los artículos en todas las bases donde se guardaron en este equipo
  //  y completa SOLO las facturas que no tienen (por ID o por No. factura).
  //  Nunca cambia una factura que ya tiene artículos.
  const hasItems = o => itemsOf(o).length > 0;
  const numOf = o => String(pick(o.invoice_num, o.invoiceNum) ?? '').trim();
  const flat = o => (o && o.record && typeof o.record === 'object') ? { ...o.record, ...o, items: hasItems(o) ? o.items : o.record.items } : o;

  // localStorage se copia al cargar el archivo, antes de que la página lo sobrescriba
  const LS_ORDER_KEYS = ['pm_orders_v1', 'pm_orders', 'pm_orders_v2'];
  const lsSnapshot = LS_ORDER_KEYS.map(k => ({ nombre: 'Navegador → localStorage "' + k + '"', filas: lsArray(k) }));

  async function browserSources(){
    const idb = await readOldIndexedDB();
    const now = LS_ORDER_KEYS.map(k => ({ nombre: 'Navegador → localStorage "' + k + '"', filas: lsArray(k) }));
    return [{ nombre: 'Navegador → IndexedDB "pleaseme_facturacion"', filas: idb.facturas || [] },
      ...lsSnapshot.map((s, i) => ({ nombre: s.nombre, filas: [...s.filas, ...now[i].filas] }))];
  }

  async function fillItems(sources, log){
    const sin = (await allRows('facturas')).filter(f => !hasItems(f));
    const byId = new Map(sin.map(f => [String(f.id), f]));
    const byNum = new Map(sin.filter(f => numOf(f)).map(f => [numOf(f), f]));
    const found = new Map();
    for(const s of sources){
      const con = s.filas.map(flat).filter(o => o && typeof o === 'object' && hasItems(o));
      let sirven = 0;
      con.forEach(o => {
        const f = byId.get(String(o.id)) || (numOf(o) && byNum.get(numOf(o)));
        if(f && !found.has(String(f.id))){ found.set(String(f.id), { ...f, items: itemsOf(o) }); sirven++; }
      });
      if(log) log('  · ' + s.nombre + ': ' + s.filas.length + ' registros, ' + con.length + ' con artículos' + (sirven ? ' → ' + sirven + ' sirven para completar' : ''));
    }
    await write([...found.values()].map(f => ({ put: ['facturas', f] })));
    return { sin: sin.length, completadas: found.size, filas: [...found.values()] };
  }

  // Al abrir la página se completan solas con lo que haya en este navegador
  const autoItems = browserSources().then(s => fillItems(s))
    .then(r => { if(r.completadas) console.log('[BD local] artículos recuperados del navegador en ' + r.completadas + ' facturas'); })
    .catch(e => console.warn('[BD local] recuperar artículos:', e && e.message));

  async function recoverItems(log){
    const facturas = await allRows('facturas');
    const sinAntes = facturas.filter(f => !hasItems(f)).length;
    log('\nFacturas en la base local: ' + facturas.length + ' · sin artículos: ' + sinAntes);
    if(!sinAntes){ log('✓ Todas las facturas tienen sus artículos.'); return false; }
    log('\nBuscando los artículos en este equipo y en Supabase…');
    const sources = [];
    for(const t of ['facturas', 'pedidos']){
      try{ const rows = await readLegacyTable(t); if(rows) sources.push({ nombre: 'Supabase (nube) → tabla "' + t + '"', filas: rows }); }
      catch(e){ log('  ⚠ Supabase "' + t + '": ' + e.message + ' (¿sin internet?)'); }
    }
    sources.push(...await browserSources());
    const r = await fillItems(sources, log);
    log(r.completadas ? '\n✓ ' + r.completadas + ' facturas completadas con sus artículos.' : '\n(no se encontraron artículos para esas facturas)');
    if(r.sin > r.completadas) log('⚠ ' + (r.sin - r.completadas) + ' facturas siguen sin artículos: no están en ninguna de las bases de este equipo.\n  Si tienes un respaldo .json o un Excel nuevo (con la hoja "Artículos"), restáuralo con 📂 Restaurar.');
    return r.completadas > 0;
  }

  // Restaura un archivo: respaldo .json, o registro de facturas en Excel/CSV
  // Facturas de un respaldo de Supabase (pg_dump, "db_cluster-….backup.gz"): bloque COPY public.facturas
  function facturasDeRespaldoSupabase(sql){
    const lines = sql.split('\n');
    const i = lines.findIndex(l => l.startsWith('COPY public.facturas ('));
    if(i < 0) return null;
    const cols = lines[i].slice(lines[i].indexOf('(') + 1, lines[i].indexOf(')')).split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    const ESC = { t: '\t', n: '\n', r: '\r', b: '\b', f: '\f', v: '\v', '\\': '\\' };
    const val = v => v === '\\N' ? null : v.replace(/\\(.)/g, (_, c) => ESC[c] ?? c);
    const json = v => { let x = v; for(let k = 0; k < 2 && typeof x === 'string'; k++){ try{ x = JSON.parse(x); }catch{ return []; } } return Array.isArray(x) ? x : []; };
    const out = [];
    for(const l of lines.slice(i + 1)){
      if(l === '\\.') break;
      const f = {};
      l.split('\t').forEach((v, j) => { const x = val(v); if(x !== null && cols[j]) f[cols[j]] = x; });
      f.items = json(f.items);
      ['subtotal', 'shipping', 'discount_amount', 'total'].forEach(k => { if(f[k] !== undefined) f[k] = Number(f[k]); });
      ['created_at', 'updated_at', 'void_at'].forEach(k => { if(f[k]) f[k] = f[k].replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00'); });
      if(f.id) out.push(f);
    }
    return out;
  }

  // Completa los artículos que faltan y agrega solo las facturas que no están
  async function restaurarRescate(lista, nombre, log){
    lista = lista.filter(f => f && f.id != null);
    log('\nRestaurando ' + nombre + ' (' + lista.length + ' facturas, ' + lista.filter(hasItems).length + ' con artículos)…');
    const r = await fillItems([{ nombre, filas: lista }], log);
    const actuales = await allRows('facturas');
    const ids = new Set(actuales.map(f => String(f.id))), nums = new Set(actuales.map(numOf).filter(Boolean));
    const nuevas = lista.filter(f => !ids.has(String(f.id)) && !(numOf(f) && nums.has(numOf(f))));
    await write(nuevas.map(f => ({ put: ['facturas', f] })));
    for(const f of r.filas) await encolar({ tabla: 'facturas', pq: '/rest/v1/facturas?id=eq.' + encodeURIComponent(f.id), method: 'PATCH', prefer: 'return=minimal', body: { items: itemsOf(f) } });
    for(const f of nuevas) await encolar({ tabla: 'facturas', pq: '/rest/v1/facturas', method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal', body: f });
    enviarPendientes();
    log('  · ' + r.completadas + ' facturas completadas con sus artículos, ' + nuevas.length + ' facturas agregadas');
    if(r.sin > r.completadas) log('⚠ ' + (r.sin - r.completadas) + ' facturas siguen sin artículos (no estaban en ese archivo).');
    log('\n✓ Facturas restauradas.');
    return true;
  }

  // Restaura un archivo según su contenido (no según su nombre):
  // respaldo .json, archivo de rescate, respaldo de Supabase (.backup.gz) o registro en Excel/CSV
  async function restoreFile(file, log){
    const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    const gz = head[0] === 0x1f && head[1] === 0x8b, zip = head[0] === 0x50 && head[1] === 0x4b;
    let text = null;
    if(gz){
      if(typeof DecompressionStream === 'undefined') throw new Error('Este navegador no puede abrir archivos .gz. Usa Chrome o Edge actualizados.');
      log('\nDescomprimiendo ' + file.name + '…');
      text = await new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text();
    } else if(!zip && !/\.(xlsx|xls)$/i.test(file.name)) text = await file.text();
    if(text !== null && /COPY public\.facturas \(/.test(text)){
      const lista = facturasDeRespaldoSupabase(text);
      if(!lista || !lista.length) throw new Error('El respaldo de Supabase no tiene facturas.');
      log('  · respaldo de Supabase: ' + lista.length + ' facturas');
      return restaurarRescate(lista, file.name, log);
    }
    if(gz) throw new Error('Ese archivo comprimido no es un respaldo de Supabase con facturas.');
    if(text !== null && /^\s*[{[]/.test(text.replace(/^﻿/, ''))){
      let data;
      try{ data = JSON.parse(text.replace(/^﻿/, '')); }catch{ throw new Error('El archivo .json está dañado o incompleto. Vuelve a descargarlo.'); }
      if(!data || typeof data.tablas !== 'object') throw new Error('El archivo no es un respaldo de Pleaseme');
      if(data.tipo === 'rescate') return restaurarRescate(Array.isArray(data.tablas.facturas) ? data.tablas.facturas : [], file.name, log);
      const reemplazar = confirm('¿Reemplazar los registros existentes con los del respaldo?\n\nAceptar = el respaldo manda\nCancelar = solo agregar lo que falte');
      log('\nRestaurando ' + file.name + '…');
      for(const [t, rows] of Object.entries(data.tablas)){
        if(!/^[A-Za-z0-9_]+$/.test(t) || !Array.isArray(rows) || t === META) continue;
        const r = await importRows(t, rows, reemplazar ? 'reemplazar' : 'completar');
        log('  · ' + t + ': ' + r.nuevos + ' nuevos, ' + r.actualizados + ' actualizados');
      }
      log('\n✓ Respaldo restaurado.');
      return true;
    }
    if(!zip && !/\.(csv|xlsx|xls|txt)$/i.test(file.name) && !(text && /[,;\t]/.test(text.split('\n', 1)[0])))
      throw new Error('Formato no soportado. Elige un respaldo .json, un respaldo de Supabase (.backup.gz) o un registro de facturas .xlsx, .xls o .csv');
    log('\nLeyendo ' + file.name + '…');
    const sheets = await readSheets(file);
    let itemsByNum = null;
    for(const sh of sheets){ const m = itemsFromSheet(sh.filas); if(m && Object.keys(m).length){ itemsByNum = m; break; } }
    const main = sheets.find(sh => !/art[ií]culos/i.test(sh.nombre)) || sheets[0];
    const facturas = sheetToFacturas(main.filas, await allRows('facturas'), itemsByNum);
    if(!facturas.length){ log('  (no se encontraron facturas en el archivo)'); return false; }
    const conArticulos = facturas.filter(f => Array.isArray(f.items) && f.items.length).length;
    log('  · ' + facturas.length + ' facturas encontradas (' + conArticulos + ' con artículos)');
    if(!confirm('Se van a restaurar ' + facturas.length + ' facturas desde ' + file.name + '.\n\nLas facturas que ya existen no se cambian: solo se completan los datos que les falten. ¿Continuar?')) return false;
    const r = await importRows('facturas', facturas, 'completar');
    log('  · facturas: ' + r.nuevos + ' nuevas, ' + r.actualizados + ' completadas');
    log('\n✓ Facturas restauradas.');
    if(conArticulos < facturas.length) log('⚠ ' + (facturas.length - conArticulos) + ' facturas vienen sin artículos: ese archivo solo traía el resumen.\n  Para recuperarlas completas usa "⇪ Traer mis datos" (con internet) o un respaldo .json.');
    return true;
  }

  // ══════════════════════════════════════════════════════════
  //  RESPALDO DIARIO AUTOMÁTICO (Facturación y Admin)
  //
  //  Al llegar la hora de cierre (18:00 por defecto) la app hace un
  //  respaldo completo de la base local y muestra una notificación con
  //  barra de progreso:
  //    1. guarda una copia en este equipo (IndexedDB "pleaseme_respaldos",
  //       se conservan las últimas 7), y
  //    2. descarga el archivo .json (carpeta Descargas).
  //  Si la app estaba cerrada a esa hora, el respaldo se hace en cuanto se
  //  abre. Solo se hace uno por día aunque haya varias pestañas abiertas.
  // ══════════════════════════════════════════════════════════
  const RESP_DB = 'pleaseme_respaldos', RESP_STORE = 'copias', RESP_MAX = 7;
  const RESP_DEF = { activo: true, hora: '18:00', descargar: true, avisoDias: 2 };   // avisoDias: 0 = no avisar
  const autoRespaldo = !/tienda|account/i.test(location.pathname);

  let respDbP = null;
  function openRespDB(){
    if(respDbP) return respDbP;
    respDbP = new Promise((resolve, reject) => {
      const req = indexedDB.open(RESP_DB, 2);
      req.onupgradeneeded = () => {
        ['copias', 'ajustes'].forEach(n => { if(!req.result.objectStoreNames.contains(n)) req.result.createObjectStore(n, { keyPath: 'id' }); });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { respDbP = null; reject(req.error); };
    });
    return respDbP;
  }
  async function listarCopias(){
    const db = await openRespDB();
    const all = await reqP(db.transaction(RESP_STORE, 'readonly').objectStore(RESP_STORE).getAll());
    return all.sort((a, b) => String(b.id).localeCompare(String(a.id)));
  }

  // ── Carpeta de respaldos (p. ej. Documentos\Pleaseme Respaldos) ──
  //  El navegador solo deja escribir en una carpeta que el usuario eligió:
  //  se elige una vez y se recuerda. Cada respaldo va en una subcarpeta con
  //  la fecha:  <carpeta>\AAAA-MM-DD\pleaseme-respaldo-AAAA-MM-DD.json
  async function leerCarpeta(){
    try{
      const db = await openRespDB();
      const r = await reqP(db.transaction('ajustes', 'readonly').objectStore('ajustes').get('carpeta'));
      return r && r.handle || null;
    }catch{ return null; }
  }
  async function guardarCarpeta(handle){
    const db = await openRespDB();
    await new Promise((res, rej) => {
      const tx = db.transaction('ajustes', 'readwrite');
      tx.objectStore('ajustes').put({ id: 'carpeta', handle });
      tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error);
    });
  }
  async function elegirCarpeta(){
    if(!window.showDirectoryPicker) throw new Error('Este navegador no permite elegir una carpeta. Usa Google Chrome o Microsoft Edge.');
    let h;
    try{
      h = await window.showDirectoryPicker({ id: 'pleaseme-respaldos', mode: 'readwrite', startIn: 'documents' });
    }catch(e){
      if(e && e.name === 'AbortError') return null;
      throw new Error('El navegador no permite usar esa carpeta (no deja elegir "Documentos" directamente). Dentro de Documentos crea una carpeta llamada "Pleaseme Respaldos" y elígela.');
    }
    await guardarCarpeta(h);
    return h;
  }
  // pedir=true solo funciona dentro de un clic del usuario
  async function permisoCarpeta(h, pedir){
    try{
      const o = { mode: 'readwrite' };
      if((await h.queryPermission(o)) === 'granted') return true;
      return !!pedir && (await h.requestPermission(o)) === 'granted';
    }catch{ return false; }
  }
  async function escribirEnCarpeta(h, dia, datos){
    const archivo = 'pleaseme-respaldo-' + dia + '.json';
    const sub = await h.getDirectoryHandle(dia, { create: true });
    const f = await sub.getFileHandle(archivo, { create: true });
    const w = await f.createWritable();
    await w.write(JSON.stringify(datos));
    await w.close();
    return h.name + '\\' + dia + '\\' + archivo;
  }

  async function respConfig(){ return { ...RESP_DEF, ...((await getMeta('respaldo_auto')) || {}).value }; }
  const diaLocal = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // Momento programado más reciente que ya pasó (hoy a la hora de cierre, o ayer)
  function ultimoCierre(hora){
    const [h, m] = String(hora || RESP_DEF.hora).split(':').map(Number);
    const c = new Date(); c.setHours(h || 0, m || 0, 0, 0);
    if(c > new Date()) c.setDate(c.getDate() - 1);
    return c;
  }

  // ── Notificación con barra de progreso ──────────────────────
  function notificacion(){
    document.getElementById('pmRespNotif')?.remove();
    const el = document.createElement('div');
    el.id = 'pmRespNotif';
    el.setAttribute('role', 'status');
    el.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:100001;width:min(340px,calc(100vw - 32px));background:#15120a;border:1px solid rgba(212,175,55,.45);border-radius:12px;padding:14px 16px;color:#e8e0cc;font:13px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.6);transition:opacity .4s';
    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px">
        <b data-r="titulo" style="color:#d4af37">💾 Respaldo diario</b>
        <button data-r="x" title="Cerrar" style="background:none;border:none;color:#aaa;font-size:15px;cursor:pointer;line-height:1">✕</button>
      </div>
      <div data-r="texto" style="font-size:12px;color:#cfc6b0;margin-bottom:8px">Preparando…</div>
      <div style="height:8px;background:rgba(255,255,255,.08);border-radius:6px;overflow:hidden">
        <div data-r="barra" style="height:100%;width:0;background:linear-gradient(90deg,#c9963a,#e8c56e);border-radius:6px;transition:width .25s"></div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;font-size:11px;color:#9c9380">
        <span data-r="paso"></span><span data-r="pct">0%</span>
      </div>`;
    document.body.appendChild(el);
    const q = k => el.querySelector('[data-r="' + k + '"]');
    let timer = null;
    const cerrar = () => { el.style.opacity = '0'; setTimeout(() => el.remove(), 400); };
    q('x').onclick = cerrar;
    return {
      progreso(pct, texto, paso){
        pct = Math.max(0, Math.min(100, Math.round(pct)));
        q('barra').style.width = pct + '%'; q('pct').textContent = pct + '%';
        if(texto) q('texto').textContent = texto;
        if(paso !== undefined) q('paso').textContent = paso;
      },
      // botones: [{ texto, titulo, accion }] — accion() devuelve el texto nuevo (o null); lanza Error si falla
      listo(texto, botones){
        this.progreso(100, texto, '✓ Completado');
        q('barra').style.background = '#2fe3b5';
        const fila = document.createElement('div');
        fila.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap';
        (botones || []).forEach(bt => {
          const b = document.createElement('button');
          b.textContent = bt.texto; b.title = bt.titulo || '';
          b.style.cssText = 'margin-top:10px;padding:6px 12px;border-radius:8px;border:1px solid rgba(212,175,55,.4);background:rgba(212,175,55,.1);color:#e8c56e;font-weight:600;cursor:pointer;font-size:12px';
          b.onclick = async () => {
            clearTimeout(timer); b.disabled = true;
            try{ const r = await bt.accion(); if(r){ q('texto').textContent = r; if(bt.unaVez) b.remove(); } }
            catch(e){ q('texto').textContent = '⚠ ' + (e && e.message || e); }
            b.disabled = false;
          };
          fila.appendChild(b);
        });
        if(fila.children.length) el.appendChild(fila);
        timer = setTimeout(cerrar, 20000);
        el.onmouseenter = () => clearTimeout(timer);
      },
      error(texto, reintentar){
        clearTimeout(timer);
        q('titulo').textContent = '⚠ Respaldo diario'; q('titulo').style.color = '#ff6b6b';
        q('barra').style.background = '#ff6b6b';
        q('texto').textContent = texto; q('paso').textContent = '';
        if(reintentar){
          const b = document.createElement('button');
          b.textContent = 'Reintentar';
          b.style.cssText = 'margin-top:10px;padding:6px 12px;border-radius:8px;border:1px solid rgba(212,175,55,.4);background:rgba(212,175,55,.1);color:#e8c56e;font-weight:600;cursor:pointer;font-size:12px';
          b.onclick = reintentar;
          el.appendChild(b);
        }
      },
    };
  }

  // Hace el respaldo mostrando el progreso. motivo: 'auto' | 'manual'
  async function respaldoDiario(motivo){
    const cfg = await respConfig();
    const n = notificacion();
    try{
      n.progreso(3, 'Leyendo la base de datos…', 'Paso 1 de 3');
      const db = await openDB();
      const recs = await reqP(db.transaction(STORE, 'readonly').objectStore(STORE).getAll());
      const tablas = {};
      const total = recs.length || 1;
      for(let i = 0; i < recs.length; i++){
        const r = recs[i];
        if(r.tabla !== META) (tablas[r.tabla] = tablas[r.tabla] || []).push(r.datos);
        if(i % 200 === 0){ n.progreso(3 + 47 * i / total, 'Leyendo registros… ' + i.toLocaleString('es') + ' de ' + recs.length.toLocaleString('es')); await sleep(0); }
      }
      const registros = Object.values(tablas).reduce((a, t) => a + t.length, 0);
      n.progreso(50, registros.toLocaleString('es') + ' registros en ' + Object.keys(tablas).length + ' tablas', 'Paso 1 de 3');
      await sleep(250);

      n.progreso(55, 'Guardando la copia en este equipo…', 'Paso 2 de 3');
      const ahora = new Date(), dia = diaLocal(ahora);
      const datos = { app: 'pleaseme', exportado: ahora.toISOString(), tablas };
      const rdb = await openRespDB();
      await new Promise((res, rej) => {
        const tx = rdb.transaction(RESP_STORE, 'readwrite');
        tx.objectStore(RESP_STORE).put({ id: dia, fecha: ahora.toISOString(), registros, motivo, datos });
        tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error);
      });
      const viejas = (await listarCopias()).slice(RESP_MAX);
      if(viejas.length){
        const tx = rdb.transaction(RESP_STORE, 'readwrite');
        viejas.forEach(c => tx.objectStore(RESP_STORE).delete(c.id));
      }
      n.progreso(75, 'Copia guardada en este equipo (se conservan las últimas ' + RESP_MAX + ')', 'Paso 2 de 3');
      await sleep(250);

      const archivo = 'pleaseme-respaldo-' + dia + '.json';
      const descargar = () => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([JSON.stringify(datos)], { type: 'application/json' }));
        a.download = archivo;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        setMeta('ultimo_respaldo', new Date().toISOString()).catch(() => {});
      };
      // Paso 3: carpeta elegida (Documentos\Pleaseme Respaldos\AAAA-MM-DD); si no se puede, Descargas
      const carpeta = await leerCarpeta();
      let ruta = '', avisoCarpeta = '';
      if(carpeta){
        n.progreso(80, 'Guardando en la carpeta "' + carpeta.name + '"…', 'Paso 3 de 3');
        try{ if(await permisoCarpeta(carpeta, false)) ruta = await escribirEnCarpeta(carpeta, dia, datos); else avisoCarpeta = 'El navegador pide permiso para escribir en la carpeta "' + carpeta.name + '".'; }
        catch(e){ console.warn('[Respaldo diario] carpeta:', e); avisoCarpeta = 'No se pudo escribir en la carpeta "' + carpeta.name + '" (' + (e && e.message || e) + ').'; }
      }
      if(ruta) setMeta('ultimo_respaldo', new Date().toISOString()).catch(() => {});
      const bajar = !ruta && (cfg.descargar || carpeta);
      if(bajar){
        n.progreso(85, 'Descargando el archivo de respaldo…', 'Paso 3 de 3');
        descargar();
      }
      await sleep(300);
      await setMeta('respaldo_auto_ultimo', ahora.toISOString());
      setTimeout(() => window.pmAvisoRespaldo && window.pmAvisoRespaldo(), 1200);   // si se guardó un archivo, el aviso desaparece

      // Botones de la notificación (un clic del usuario permite pedir permiso / elegir carpeta)
      const guardarEnCarpeta = async () => {
        let h = await leerCarpeta();
        if(!h) h = await elegirCarpeta();
        if(!h) return null;
        if(!(await permisoCarpeta(h, true))) throw new Error('Sin permiso para escribir en la carpeta "' + h.name + '".');
        const r = await escribirEnCarpeta(h, dia, datos);
        setMeta('ultimo_respaldo', new Date().toISOString()).catch(() => {});
        return '✓ Guardado en: ' + r;
      };
      const botones = [];
      if(!ruta) botones.push({ unaVez: true, texto: carpeta ? '📁 Guardar en la carpeta' : '📁 Elegir carpeta en Documentos',
        titulo: carpeta ? 'Permitir que el navegador escriba en la carpeta de respaldos' : 'Elige (o crea) una carpeta dentro de Documentos para guardar los respaldos por fecha', accion: guardarEnCarpeta });
      if(bajar || cfg.descargar) botones.push({ texto: '⬇ Descargar de nuevo', titulo: 'Por si el navegador no lo descargó', accion: () => { descargar(); return null; } });
      n.listo('Respaldo del ' + ahora.toLocaleDateString('es') + ' listo: ' + registros.toLocaleString('es') + ' registros. ' +
        (ruta ? 'Guardado en: ' + ruta
          : (avisoCarpeta ? avisoCarpeta + ' ' : '') + (bajar ? 'Archivo "' + archivo + '" en Descargas.' : 'Copia guardada en este equipo.')), botones);
      return true;
    }catch(e){
      console.error('[Respaldo diario]', e);
      n.error('No se pudo hacer el respaldo: ' + (e && e.message || e), () => respaldoDiario(motivo));
      return false;
    }
  }
  window.pmRespaldoDiario = () => respaldoDiario('manual');

  let revisando = false;
  async function revisarRespaldo(){
    if(revisando) return;
    revisando = true;
    try{
      const cfg = await respConfig();
      if(!cfg.activo) return;
      const cierre = ultimoCierre(cfg.hora);
      const tocaRespaldo = async () => { const u = await getMeta('respaldo_auto_ultimo'); return !u || new Date(u.value) < cierre; };
      if(!(await tocaRespaldo())) return;
      // Una sola pestaña hace el respaldo
      const hacer = async () => { if(await tocaRespaldo()) await respaldoDiario('auto'); };
      if(navigator.locks && navigator.locks.request) await navigator.locks.request('pm-respaldo-diario', { ifAvailable: true }, lock => lock && hacer());
      else await hacer();
    }catch(e){ console.warn('[Respaldo diario]', e && e.message); }
    finally{ revisando = false; }
  }
  // ── Aviso si pasan días sin respaldo ─────────────────────────
  //  "Respaldo" = un archivo guardado FUERA del navegador (carpeta de respaldos,
  //  Descargas o "Descargar respaldo"): la copia que queda dentro del navegador se
  //  pierde si se borran sus datos. Si pasan N días (2 por defecto) aparece un
  //  aviso arriba con el botón "Respaldar ahora".
  const AVISO_ID = 'pmAvisoRespaldo', AVISO_LS = 'pm_aviso_resp_hasta';
  async function revisarAvisoRespaldo(){
    try{
      const cfg = await respConfig();
      const quitar = () => document.getElementById(AVISO_ID)?.remove();
      const dias = Number(cfg.avisoDias);
      if(!(dias > 0)){ quitar(); return; }
      const u = await getMeta('ultimo_respaldo');
      const transcurridos = u ? (Date.now() - new Date(u.value).getTime()) / 86400000 : Infinity;
      if(transcurridos < dias){ quitar(); return; }
      let hasta = 0; try{ hasta = Number(localStorage.getItem(AVISO_LS)) || 0; }catch(e){}
      if(Date.now() < hasta || document.getElementById(AVISO_ID) || !document.body) return;
      const n = Math.floor(transcurridos);
      const el = document.createElement('div');
      el.id = AVISO_ID;
      el.setAttribute('role', 'alert');
      el.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:9000;width:min(680px,calc(100vw - 24px));display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:11px 14px;border-radius:12px;background:#2a1c08;border:1px solid rgba(255,170,60,.65);box-shadow:0 10px 36px rgba(0,0,0,.65),0 0 24px rgba(255,170,60,.18);color:#ffe3b8;font:13px/1.45 system-ui,-apple-system,Segoe UI,sans-serif';
      el.innerHTML = '<span style="font-size:20px">⚠️</span><div style="flex:1;min-width:210px"><b style="color:#ffb347">' +
        (u ? 'Hace ' + n + ' día' + (n !== 1 ? 's' : '') + ' que no guardas un respaldo' : 'Todavía no has guardado ningún respaldo') + '</b><div style="font-size:11.5px;color:#d9c29b">' +
        (u ? 'Último: ' + new Date(u.value).toLocaleDateString('es') + '. ' : '') + 'Si se borran los datos del navegador, se pierden las facturas.</div></div>' +
        '<button data-a="ya" style="padding:8px 14px;border-radius:8px;border:none;background:#ffb347;color:#1b1204;font-weight:700;cursor:pointer;font-size:12px">💾 Respaldar ahora</button>' +
        '<button data-a="luego" style="padding:8px 12px;border-radius:8px;border:1px solid rgba(255,179,71,.5);background:transparent;color:#ffcf8f;cursor:pointer;font-size:12px">Más tarde</button>';
      document.body.appendChild(el);
      el.querySelector('[data-a="luego"]').onclick = () => { try{ localStorage.setItem(AVISO_LS, String(Date.now() + 6 * 3600000)); }catch(e){} el.remove(); };
      el.querySelector('[data-a="ya"]').onclick = async () => { el.remove(); await respaldoDiario('manual'); setTimeout(revisarAvisoRespaldo, 1200); };
    }catch(e){ console.warn('[Aviso de respaldo]', e && e.message); }
  }
  window.pmAvisoRespaldo = revisarAvisoRespaldo;

  if(autoRespaldo){
    const iniciar = () => {
      setTimeout(revisarRespaldo, 5000); setInterval(revisarRespaldo, 60000);
      setTimeout(revisarAvisoRespaldo, 7000); setInterval(revisarAvisoRespaldo, 5 * 60000);
    };
    if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
  }

  // ── Ventana "BD local" ──────────────────────────────────────
  const BTN = 'padding:8px 14px;border-radius:8px;border:1px solid rgba(212,175,55,.35);background:rgba(212,175,55,.08);color:#e8c56e;font-weight:600;cursor:pointer;font-size:12px';
  const BTN_MAIN = 'padding:8px 14px;border-radius:8px;border:none;background:#d4af37;color:#000;font-weight:700;cursor:pointer;font-size:12px';

  async function pmAbrirBDLocal(){
    document.getElementById('pmBDOverlay')?.remove();
    const ov = document.createElement('div');
    ov.id = 'pmBDOverlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;padding:16px;font-family:system-ui,-apple-system,Segoe UI,sans-serif';
    ov.innerHTML = `
      <div style="background:#15120a;border:1px solid rgba(212,175,55,.35);border-radius:14px;width:100%;max-width:580px;max-height:90vh;display:flex;flex-direction:column;color:#e8e0cc;box-shadow:0 20px 60px rgba(0,0,0,.6)">
        <div style="padding:16px 20px;border-bottom:1px solid rgba(212,175,55,.2);display:flex;justify-content:space-between;align-items:center;gap:10px">
          <div style="font-weight:700;color:#d4af37;font-size:15px">🗄 Base de datos local de este equipo</div>
          <button data-a="cerrar" style="background:none;border:none;color:#aaa;font-size:18px;cursor:pointer">✕</button>
        </div>
        <pre id="pmBDLog" style="margin:0;padding:14px 20px;overflow:auto;flex:1;min-height:120px;font:12px/1.55 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;color:#cfc6b0"></pre>
        <div style="padding:10px 20px;border-top:1px solid rgba(212,175,55,.2);display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:12px">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" data-c="activo" style="accent-color:#d4af37"> Respaldo diario a las</label>
          <input type="time" data-c="hora" style="background:rgba(0,0,0,.35);border:1px solid rgba(212,175,55,.35);border-radius:6px;color:#e8e0cc;padding:3px 6px;font-size:12px">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" data-c="descargar" style="accent-color:#d4af37"> descargar a Descargas si no hay carpeta</label>
          <label style="display:flex;align-items:center;gap:6px" title="Aparece un aviso si pasan estos días sin guardar un respaldo en un archivo. 0 = no avisar">Avisar tras <input type="number" data-c="avisoDias" min="0" max="30" style="width:52px;background:rgba(0,0,0,.35);border:1px solid rgba(212,175,55,.35);border-radius:6px;color:#e8e0cc;padding:3px 6px;font-size:12px"> días sin respaldo</label>
          <button data-a="carpeta" style="${BTN}" title="Elige la carpeta (dentro de Documentos) donde se guardan los respaldos, una subcarpeta por fecha">📁 Carpeta de respaldos</button>
          <span style="flex:1"></span>
          <button data-a="copias" style="${BTN}" title="Ver y restaurar las copias diarias guardadas en este equipo">🕘 Copias diarias</button>
          <button data-a="ahora" style="${BTN}" title="Hacer el respaldo diario ahora">💾 Respaldar ahora</button>
        </div>
        <div style="padding:12px 20px;border-top:1px solid rgba(212,175,55,.2);display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap">
          <button data-a="articulos" style="${BTN}" title="Busca los artículos de las facturas que no los tienen (Supabase y este navegador)">🔎 Recuperar artículos</button>
          <button data-a="restaurar" style="${BTN}" title="Respaldo .json o registro de facturas en Excel (.xlsx/.xls) o CSV">📂 Restaurar (respaldo o Excel)</button>
          <button data-a="respaldo" style="${BTN}">💾 Descargar respaldo</button>
          <button data-a="migrar" style="${BTN_MAIN}">⇪ Traer mis datos (Supabase + navegador)</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const logEl = ov.querySelector('#pmBDLog');
    const log = m => { logEl.textContent += m + '\n'; logEl.scrollTop = logEl.scrollHeight; };
    const buttons = [...ov.querySelectorAll('button[data-a]')].filter(b => b.dataset.a !== 'cerrar');
    let busy = false, changed = false;
    const run = async fn => {
      if(busy) return; busy = true; buttons.forEach(b => b.disabled = true);
      try{ await fn(); }catch(e){ log('\n✖ Error: ' + (e && e.message || e) + '\n  No se borró nada. Puedes volver a intentarlo.'); }
      finally{ busy = false; buttons.forEach(b => b.disabled = false); }
    };
    const showTotals = async title => {
      const t = await allTables();
      log(title);
      const names = Object.keys(t).sort();
      if(!names.length) log('  (vacía)');
      names.forEach(n => log('  · ' + n + ': ' + t[n]));
    };
    const close = () => { ov.remove(); if(changed) location.reload(); };
    ov.querySelector('[data-a="cerrar"]').onclick = () => { if(!busy) close(); };

    // Ajustes del respaldo diario
    const cfg = await respConfig();
    const ci = k => ov.querySelector('[data-c="' + k + '"]');
    ci('activo').checked = cfg.activo; ci('hora').value = cfg.hora; ci('descargar').checked = cfg.descargar; ci('avisoDias').value = cfg.avisoDias;
    const guardarCfg = async () => {
      const ad = Math.max(0, Math.min(30, Math.floor(Number(ci('avisoDias').value)) || 0));
      await setMeta('respaldo_auto', { activo: ci('activo').checked, hora: ci('hora').value || RESP_DEF.hora, descargar: ci('descargar').checked, avisoDias: ad });
      try{ localStorage.removeItem(AVISO_LS); }catch(e){}
      revisarAvisoRespaldo();
      log('\n✓ Respaldo diario ' + (ci('activo').checked ? 'activo a las ' + (ci('hora').value || RESP_DEF.hora) + (ci('descargar').checked ? ', con descarga del archivo' : ', solo copia en este equipo') : 'desactivado'));
    };
    ['activo', 'hora', 'descargar', 'avisoDias'].forEach(k => ci(k).onchange = guardarCfg);

    await run(async () => {
      log('Los datos se guardan en este navegador, en este equipo. No necesita servidor ni internet.');
      const last = await getMeta('ultimo_respaldo');
      log('Último respaldo descargado: ' + (last ? new Date(last.value).toLocaleString('es') : 'nunca'));
      const carp = await leerCarpeta();
      log('Carpeta de respaldos: ' + (carp ? carp.name + '  (se crea una subcarpeta por fecha)' : 'no elegida — se descarga a la carpeta Descargas'));
      const auto = await getMeta('respaldo_auto_ultimo');
      log('Respaldo diario: ' + (cfg.activo ? 'activo a las ' + cfg.hora : 'desactivado') + ' · último: ' + (auto ? new Date(auto.value).toLocaleString('es') : 'nunca'));
      await showTotals('\nContenido actual:');
    });

    ov.querySelector('[data-a="migrar"]').onclick = () => run(async () => {
      if(!confirm('Se copiarán todas las facturas, clientes, artículos, pedidos y ajustes de Supabase y de este navegador a la base de datos local.\n\nNo se borra nada. ¿Continuar?')) return;
      const first = !(await getMeta('migracion_supabase'));
      log('\n1. Descargando los datos de Supabase…');
      const sb = await collectFromSupabase(log);
      log('\n2. Leyendo los registros guardados en este navegador…');
      const br = await collectFromBrowser(log);
      log('\n3. Guardando en la base local…');
      const demo = await removeDemo();
      if(demo) log('  · se quitaron ' + demo + ' registros de demostración');
      const total = {};
      const add = (t, r) => { total[t] = total[t] || { nuevos: 0, actualizados: 0 }; total[t].nuevos += r.nuevos; total[t].actualizados += r.actualizados; };
      // La primera vez Supabase manda (datos principales); después solo completa
      for(const [t, rows] of Object.entries(sb.tablas)) add(t, await importRows(t, rows, first ? 'reemplazar' : 'completar'));
      for(const [t, rows] of Object.entries(br)) add(t, await importRows(t, rows, 'completar'));
      Object.entries(total).forEach(([t, r]) => log('  · ' + t + ': ' + r.nuevos + ' nuevos, ' + r.actualizados + ' actualizados'));
      const fuentes = ['facturas', 'pedidos'].filter(t => sb.tablas[t]).map(t => ({ nombre: 'Supabase "' + t + '"', filas: sb.tablas[t] }));
      const art = await fillItems([...fuentes, ...await browserSources()]);
      if(art.completadas) log('  · artículos recuperados en ' + art.completadas + ' facturas');
      if(art.sin > art.completadas) log('  ⚠ ' + (art.sin - art.completadas) + ' facturas siguen sin artículos (usa 🔎 Recuperar artículos para ver dónde se buscó)');
      if(Object.keys(sb.tablas).length && sb.ok) await setMeta('migracion_supabase', new Date().toISOString());
      changed = true;
      await showTotals('\nTotal en la base local:');
      log(Object.keys(sb.tablas).length
        ? '\n✓ Listo. Te recomendamos descargar un respaldo ahora.'
        : '\n⚠ No se pudo leer Supabase (¿sin internet?). Se guardó lo que había en el navegador; vuelve a intentarlo con internet.');
    });

    ov.querySelector('[data-a="articulos"]').onclick = () => run(async () => {
      if(await recoverItems(log)){ changed = true; await showTotals('\nTotal en la base local:'); }
    });

    ov.querySelector('[data-a="respaldo"]').onclick = () => run(async () => {
      await exportBackup();
      log('\n✓ Respaldo descargado. Guárdalo en un lugar seguro (USB, nube…).');
    });

    ov.querySelector('[data-a="carpeta"]').onclick = () => run(async () => {
      const h = await elegirCarpeta();
      if(!h) return;
      log('\n✓ Carpeta de respaldos: "' + h.name + '". Cada día se guarda en una subcarpeta con la fecha.');
      log('  Pulsa 💾 Respaldar ahora para probarla.');
    });

    ov.querySelector('[data-a="ahora"]').onclick = () => run(async () => {
      log('\nHaciendo el respaldo diario…');
      log(await respaldoDiario('manual') ? '✓ Respaldo hecho.' : '✖ No se pudo hacer el respaldo.');
    });

    ov.querySelector('[data-a="copias"]').onclick = () => run(async () => {
      const copias = await listarCopias();
      log('\nCopias diarias guardadas en este equipo (' + copias.length + ' de ' + RESP_MAX + ' máximo):');
      if(!copias.length){ log('  (ninguna todavía)'); return; }
      copias.forEach((c, i) => log('  ' + (i + 1) + '. ' + new Date(c.fecha).toLocaleString('es') + ' — ' + Number(c.registros || 0).toLocaleString('es') + ' registros'));
      const elegida = prompt('Escribe el número de la copia que quieres restaurar (o cancela):\n\n' +
        copias.map((c, i) => (i + 1) + '. ' + new Date(c.fecha).toLocaleString('es') + ' — ' + c.registros + ' registros').join('\n'));
      const c = copias[Number(elegida) - 1];
      if(!c) return;
      const reemplazar = confirm('¿Reemplazar los registros existentes con los de la copia del ' + new Date(c.fecha).toLocaleString('es') + '?\n\nAceptar = la copia manda\nCancelar = solo agregar lo que falte');
      log('\nRestaurando la copia del ' + new Date(c.fecha).toLocaleString('es') + '…');
      for(const [t, rows] of Object.entries(c.datos.tablas || {})){
        if(!/^[A-Za-z0-9_]+$/.test(t) || !Array.isArray(rows) || t === META) continue;
        const r = await importRows(t, rows, reemplazar ? 'reemplazar' : 'completar');
        log('  · ' + t + ': ' + r.nuevos + ' nuevos, ' + r.actualizados + ' actualizados');
      }
      changed = true;
      log('\n✓ Copia restaurada.');
    });

    ov.querySelector('[data-a="restaurar"]').onclick = () => run(async () => {
      const file = await pickFile();
      if(!file) return;
      if(await restoreFile(file, log)){ changed = true; await showTotals('\nTotal en la base local:'); }
    });
  }
  window.pmAbrirBDLocal = pmAbrirBDLocal;
  window.pmMigrarABaseLocal = pmAbrirBDLocal;   // compatibilidad con botones anteriores

  // Botón "📂 Restaurar": abre la ventana BD local y pide el archivo de una vez
  window.pmRestaurarArchivo = async function(){
    await pmAbrirBDLocal();
    document.querySelector('#pmBDOverlay [data-a="restaurar"]')?.click();
  };
})();
