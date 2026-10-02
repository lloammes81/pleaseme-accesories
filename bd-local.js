// ══════════════════════════════════════════════════════════════
//  PLEASEME — Base de datos LOCAL dentro del navegador (sin servidor)
//
//  Cada equipo/navegador tiene su propia base de datos (IndexedDB
//  "pleaseme_bd_local"). No hay que instalar nada.
//
//  • Las páginas siguen llamando a SB_URL + '/rest/v1/<tabla>' (el mismo
//    formato que usaba Supabase). Este archivo intercepta esas llamadas
//    y las resuelve con la base local, así la lógica de las páginas no
//    cambia.
//  • pmAbrirBDLocal(): ventana "🗄 BD local" con:
//      - Traer mis datos: copia todo lo de Supabase y lo guardado en este
//        navegador a la base local (no borra nada; se puede repetir).
//      - Descargar respaldo (.json) y Restaurar: respaldo .json o el
//        registro de facturas descargado en Excel (.xlsx/.xls) o CSV.
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
    return new Response(noBody ? null : JSON.stringify(body), {
      status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
    });
  }

  async function handleRest(table, params, method, headers, bodyText){
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

  // ── Interceptar fetch hacia la base local ───────────────────
  window.fetch = async function(input, init){
    const url = typeof input === 'string' ? input : (input && input.url) || String(input);
    if(!url.startsWith(PM_DB_URL)) return realFetch(input, init);
    try{
      const u = new URL(url);
      const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      const headers = new Headers((init && init.headers) || (input && input.headers) || {});
      const bodyText = init && typeof init.body === 'string' ? init.body : null;
      if(!u.pathname.startsWith('/rest/v1/')) return respond(404, { message: 'Ruta no encontrada' });
      return await handleRest(u.pathname.slice('/rest/v1/'.length).replace(/\/+$/, ''), u.searchParams, method, headers, bodyText);
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
        const take = mode === 'reemplazar' ? JSON.stringify(existing[k]) !== JSON.stringify(v) : (isEmpty(existing[k]) && !isEmpty(v));
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
      inp.type = 'file'; inp.accept = '.json,.csv,.xlsx,.xls,application/json,text/csv';
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
    if(/\.csv$/i.test(file.name)) return [{ nombre: file.name, filas: parseCSV(await file.text()) }];
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

  // Restaura un archivo: respaldo .json, o registro de facturas en Excel/CSV
  async function restoreFile(file, log){
    if(/\.json$/i.test(file.name)){
      const data = JSON.parse(await file.text());
      if(!data || typeof data.tablas !== 'object') throw new Error('El archivo no es un respaldo de Pleaseme');
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
    if(!/\.(csv|xlsx|xls)$/i.test(file.name)) throw new Error('Formato no soportado. Elige un respaldo .json o un registro de facturas .xlsx, .xls o .csv');
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
        <div style="padding:12px 20px;border-top:1px solid rgba(212,175,55,.2);display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap">
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

    await run(async () => {
      log('Los datos se guardan en este navegador, en este equipo. No necesita servidor ni internet.');
      const last = await getMeta('ultimo_respaldo');
      log('Último respaldo descargado: ' + (last ? new Date(last.value).toLocaleString('es') : 'nunca'));
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
      if(Object.keys(sb.tablas).length && sb.ok) await setMeta('migracion_supabase', new Date().toISOString());
      changed = true;
      await showTotals('\nTotal en la base local:');
      log(Object.keys(sb.tablas).length
        ? '\n✓ Listo. Te recomendamos descargar un respaldo ahora.'
        : '\n⚠ No se pudo leer Supabase (¿sin internet?). Se guardó lo que había en el navegador; vuelve a intentarlo con internet.');
    });

    ov.querySelector('[data-a="respaldo"]').onclick = () => run(async () => {
      await exportBackup();
      log('\n✓ Respaldo descargado. Guárdalo en un lugar seguro (USB, nube…).');
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
