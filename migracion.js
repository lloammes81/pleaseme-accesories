// ══════════════════════════════════════════════════════════════
//  PLEASEME — Migración a la base de datos LOCAL (servidor/server.js)
//
//  • PM_DB_URL: dirección de la base local que usan todas las páginas.
//  • pmMigrarABaseLocal(): botón "Enviar datos a la BD local". Copia
//      1) todo lo que había en Supabase (facturas, clientes, productos,
//         pedidos, configuración, usuarios…), y
//      2) los registros guardados en ESTE navegador (IndexedDB y
//         localStorage), incluidos los que nunca llegaron a Supabase,
//    al archivo de base de datos del equipo. Nunca borra nada: los
//    registros nuevos se agregan y en los existentes solo se completan
//    campos vacíos, así que se puede ejecutar varias veces sin riesgo.
//  • Al abrir las páginas desde el servidor local por primera vez, se
//    recuperan automáticamente los ajustes del navegador que se migraron
//    (contraseña admin, compras, configuración de envíos, etc.).
// ══════════════════════════════════════════════════════════════
(function(){
  'use strict';

  const DEFAULT_LOCAL = 'http://localhost:3000';
  const LS_DB_URL     = 'pm_db_url';
  const LS_RESTORED   = 'pm_navegador_restaurado_v1';

  // Supabase anterior — solo se usa para LEER los datos durante la migración
  const LEGACY_SB_URL = 'https://sqcggascnbcnfkymqcql.supabase.co';
  const LEGACY_SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNxY2dnYXNjbmJjbmZreW1xY3FsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2ODQ2NzIsImV4cCI6MjA4NzI2MDY3Mn0.q0C_q3gOZZzcr6dWPrIhWS63gst5OBYIg9FDxThaKt4';
  const LEGACY_TABLES = ['facturas','clientes','productos','pedidos','config','company','admin_users','admin_auth','carriers'];

  // Claves del navegador que NO se copian (sesiones y carrito temporales)
  const SKIP_KEYS = /session|logged_in|pm_cart|pm_open_label|pm_db_url|pm_navegador_restaurado/i;
  // Cachés que ahora vienen de la base local (no hace falta restaurarlas en el navegador)
  const RESTORE_SKIP = /^pm_(orders|products_v1|clients_v1)/;

  function lsGet(k){ try{ return localStorage.getItem(k); }catch{ return null; } }
  function lsSet(k, v){ try{ localStorage.setItem(k, v); }catch{} }
  function trimUrl(u){ return String(u||'').trim().replace(/\/+$/, ''); }

  // ── Dirección de la base local ──
  // Si la página se abrió desde el servidor local (http://...:3000) se usa ese mismo origen.
  const isServedLocally = /^https?:$/.test(location.protocol) && (location.port === '3000' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname));
  const PM_DB_URL = trimUrl(lsGet(LS_DB_URL)) || (isServedLocally ? location.origin : DEFAULT_LOCAL);
  window.PM_DB_URL = PM_DB_URL;

  // ── Utilidades ──
  async function fetchJson(url, opts){
    const r = await fetch(url, opts);
    const text = await r.text();
    if(!r.ok) throw new Error('HTTP '+r.status+': '+text.slice(0,200));
    return text ? JSON.parse(text) : null;
  }

  async function serverStatus(base){
    try{ const s = await fetchJson(base+'/api/estado'); return s && s.servidor === 'pleaseme-local' ? s : null; }
    catch{ return null; }
  }

  // ── 1) Supabase ──
  async function readLegacyTable(table, log){
    const H = {apikey:LEGACY_SB_KEY, Authorization:'Bearer '+LEGACY_SB_KEY};
    const rows = [];
    const PAGE = 1000;
    for(let from = 0; ; from += PAGE){
      const r = await fetch(LEGACY_SB_URL+'/rest/v1/'+table+'?select=*', {headers:{...H, Range:from+'-'+(from+PAGE-1)}});
      if(r.status === 404 || r.status === 400){ return null; }            // la tabla no existe
      if(!r.ok && r.status !== 206) throw new Error('HTTP '+r.status);
      const page = await r.json();
      rows.push(...page);
      if(page.length < PAGE) break;
    }
    log('  · '+table+': '+rows.length);
    return rows;
  }

  async function legacyTableList(){
    const names = new Set(LEGACY_TABLES);
    try{
      const spec = await fetchJson(LEGACY_SB_URL+'/rest/v1/', {headers:{apikey:LEGACY_SB_KEY, Authorization:'Bearer '+LEGACY_SB_KEY}});
      Object.keys((spec && (spec.definitions || (spec.components && spec.components.schemas))) || {}).forEach(n => names.add(n));
    }catch{}
    return [...names].filter(n => /^[A-Za-z0-9_]+$/.test(n));
  }

  async function collectFromSupabase(log){
    const out = {};
    let tables;
    try{ tables = await legacyTableList(); }
    catch(e){ log('  ⚠ No se pudo consultar Supabase: '+e.message); return out; }
    for(const t of tables){
      try{ const rows = await readLegacyTable(t, log); if(rows) out[t] = rows; }
      catch(e){ log('  ⚠ '+t+': '+e.message); }
    }
    return out;
  }

  // ── 2) Datos guardados en este navegador ──
  function readIndexedDB(name, stores){
    return new Promise(resolve => {
      if(!('indexedDB' in window)) return resolve({});
      let req;
      try{ req = indexedDB.open(name); }catch{ return resolve({}); }
      req.onupgradeneeded = () => { try{ req.transaction.abort(); }catch{} };  // no crear la BD si no existe
      req.onerror = () => resolve({});
      req.onsuccess = () => {
        const idb = req.result;
        const present = stores.filter(s => idb.objectStoreNames.contains(s));
        if(!present.length){ idb.close(); return resolve({}); }
        const tx = idb.transaction(present, 'readonly');
        const out = {};
        present.forEach(s => { const g = tx.objectStore(s).getAll(); g.onsuccess = () => { out[s] = g.result || []; }; });
        tx.oncomplete = () => { idb.close(); resolve(out); };
        tx.onerror = () => { idb.close(); resolve(out); };
      };
    });
  }

  function lsJsonArray(key){
    try{ const v = JSON.parse(lsGet(key) || '[]'); return Array.isArray(v) ? v : []; }catch{ return []; }
  }

  function clean(o){
    const c = {...o};
    delete c.pending_sync;
    Object.keys(c).forEach(k => { if(c[k] === undefined) delete c[k]; });
    return c;
  }

  function pick(...vals){ for(const v of vals){ if(v !== undefined && v !== null && v !== '') return v; } return undefined; }

  // Factura (formato de index.html) → fila de la tabla "facturas"
  function toFacturaRow(o){
    return clean({
      ...o,
      invoice_num:          pick(o.invoice_num, o.invoiceNum),
      invoice_date:         pick(o.invoice_date, (o.created_at||'').slice(0,10)),
      client_name:          pick(o.client_name, o.clientName),
      client_email:         pick(o.client_email, o.clientEmail),
      client_phone:         pick(o.client_phone, o.clientPhone),
      client_address:       pick(o.client_address, o.address),
      shipping_address_usa: pick(o.shipping_address_usa, o.address_usa),
      casillero_number:     pick(o.casillero_number, o.casillero),
      discount_amount:      pick(o.discount_amount, o.discountAmount),
      shipping:             pick(o.shipping, o.shipping_cost),
    });
  }

  // Pedido (formato de admin.html) → fila de la tabla "pedidos"
  function toPedidoRow(o){
    if(o.record) return clean(o);
    const rec = clean(o);
    return clean({
      id: o.id, record: rec, created_at: o.created_at,
      status:           o.status,
      client_name:      pick(o.clientName, o.name),
      client_email:     pick(o.clientEmail, o.email),
      client_phone:     pick(o.clientPhone, o.phone),
      total:            o.total,
      shipping_address: pick(o.shippingAddress, o.address),
      payment_method:   o.method,
      tracking_num:     o.trackingNum,
    });
  }

  function toClienteRow(c){
    if(c.record) return clean(c);
    return clean({
      id: c.id, record: clean(c), created_at: c.created_at,
      name: c.name, email: c.email, phone: c.phone,
      shipping_address:  pick(c.shipping_address, c.address),
      billing_address:   c.billing_address,
      preferred_payment: c.preferred_payment,
      orders_count:      c.orders_count,
    });
  }

  function toProductoRow(p){
    if(p.record) return clean(p);
    return clean({
      id: p.id, record: clean(p), created_at: p.created_at, active: p.active !== false,
      name: p.name, price: p.price, stock: p.stock, sku: p.sku, category: p.category,
    });
  }

  function isFactura(o){
    return String(o.id||'').startsWith('fac-') || 'invoice_date' in o || 'client_address' in o;
  }

  async function collectFromBrowser(log){
    const idb = await readIndexedDB('pleaseme_facturacion', ['facturas','clientes','productos']);
    const lsOrders = [...lsJsonArray('pm_orders_v1'), ...lsJsonArray('pm_orders')];
    const facturas = [...(idb.facturas||[]), ...lsOrders.filter(isFactura)];
    const pedidos  = lsOrders.filter(o => !isFactura(o));
    const clientes = [...(idb.clientes||[]), ...lsJsonArray('pm_clients_v1')];
    const productos= [...(idb.productos||[]), ...lsJsonArray('pm_products_v1')];

    const byId = list => { const m = new Map(); list.filter(x => x && x.id).forEach(x => m.set(String(x.id), {...(m.get(String(x.id))||{}), ...x})); return [...m.values()]; };

    // Ajustes y datos que solo existían en el navegador (compras, configuración, contraseña…)
    const navegador = [];
    try{
      for(let i = 0; i < localStorage.length; i++){
        const k = localStorage.key(i);
        if(!k || SKIP_KEYS.test(k)) continue;
        if(!/^(pm_|pleaseme|courier)/i.test(k)) continue;
        navegador.push({id:k, value:localStorage.getItem(k)});
      }
    }catch{}

    const out = {
      facturas:  byId(facturas).map(toFacturaRow),
      pedidos:   byId(pedidos).map(toPedidoRow),
      clientes:  byId(clientes).map(toClienteRow),
      productos: byId(productos).map(toProductoRow),
      _navegador: navegador,
    };
    Object.entries(out).forEach(([t, rows]) => log('  · '+t+': '+rows.length));
    return out;
  }

  async function sendToServer(base, tablas, origen){
    return fetchJson(base+'/api/importar', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({origen, modo:'completar', tablas}),
    });
  }

  // ── Ventana de progreso ──
  function openPanel(){
    let ov = document.getElementById('pmMigrarOverlay');
    if(ov) ov.remove();
    ov = document.createElement('div');
    ov.id = 'pmMigrarOverlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;padding:16px;font-family:system-ui,-apple-system,Segoe UI,sans-serif';
    ov.innerHTML = `
      <div style="background:#15120a;border:1px solid rgba(212,175,55,.35);border-radius:14px;width:100%;max-width:560px;max-height:90vh;display:flex;flex-direction:column;color:#e8e0cc;box-shadow:0 20px 60px rgba(0,0,0,.6)">
        <div style="padding:16px 20px;border-bottom:1px solid rgba(212,175,55,.2);display:flex;justify-content:space-between;align-items:center;gap:10px">
          <div style="font-weight:700;color:#d4af37;font-size:15px">⇪ Enviar datos a la base de datos local</div>
          <button id="pmMigrarClose" style="background:none;border:none;color:#aaa;font-size:18px;cursor:pointer">✕</button>
        </div>
        <pre id="pmMigrarLog" style="margin:0;padding:14px 20px;overflow:auto;flex:1;font:12px/1.55 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;color:#cfc6b0"></pre>
        <div id="pmMigrarFoot" style="padding:12px 20px;border-top:1px solid rgba(212,175,55,.2);display:flex;justify-content:flex-end;gap:8px"></div>
      </div>`;
    document.body.appendChild(ov);
    const close = () => ov.remove();
    ov.querySelector('#pmMigrarClose').onclick = close;
    const logEl = ov.querySelector('#pmMigrarLog');
    return {
      log: msg => { logEl.textContent += msg + '\n'; logEl.scrollTop = logEl.scrollHeight; },
      foot: html => { ov.querySelector('#pmMigrarFoot').innerHTML = html; },
      close,
    };
  }

  let running = false;
  async function pmMigrarABaseLocal(){
    if(running) return;
    if(!confirm('Se copiarán TODAS las facturas, clientes, artículos, pedidos y ajustes (de Supabase y de este navegador) a la base de datos local del equipo.\n\nNo se borra nada. ¿Continuar?')) return;
    running = true;
    const ui = openPanel();
    try{
      ui.log('1. Buscando el servidor local…');
      let base = PM_DB_URL;
      let status = await serverStatus(base);
      if(!status && base !== DEFAULT_LOCAL){ base = DEFAULT_LOCAL; status = await serverStatus(base); }
      if(!status){
        const typed = prompt('No se encontró el servidor local en '+base+'.\n\nÁbrelo primero (doble clic en "iniciar-servidor") y escribe aquí su dirección:', base);
        if(typed){ base = trimUrl(typed); status = await serverStatus(base); }
      }
      if(!status){
        ui.log('\n✖ No hay conexión con el servidor local.');
        ui.log('  Ábrelo con el archivo "iniciar-servidor" (ver LEEME-BASE-LOCAL.md) y vuelve a intentarlo.');
        ui.foot('<button onclick="document.getElementById(\'pmMigrarOverlay\').remove()" style="padding:8px 16px;border-radius:8px;border:1px solid #555;background:#222;color:#eee;cursor:pointer">Cerrar</button>');
        return;
      }
      ui.log('  ✓ Conectado: '+base);
      ui.log('  Archivo: '+status.archivo);

      ui.log('\n2. Descargando los datos de Supabase…');
      const fromSb = await collectFromSupabase(ui.log);

      ui.log('\n3. Leyendo los registros guardados en este navegador…');
      const fromBrowser = await collectFromBrowser(ui.log);

      ui.log('\n4. Guardando en la base de datos local…');
      const total = {};
      const add = resumen => Object.entries(resumen||{}).forEach(([t, r]) => {
        total[t] = total[t] || {nuevos:0, actualizados:0};
        total[t].nuevos += r.nuevos; total[t].actualizados += r.actualizados;
      });
      // Primero Supabase (datos principales) y después el navegador, que completa lo que falte
      if(Object.keys(fromSb).length){ add((await sendToServer(base, fromSb, 'supabase')).resumen); }
      const res = await sendToServer(base, fromBrowser, 'navegador '+location.origin);
      add(res.resumen);

      ui.log('');
      Object.entries(total).forEach(([t, r]) => { if(t !== '_navegador') ui.log('  · '+t+': '+r.nuevos+' nuevos, '+r.actualizados+' completados'); });
      ui.log('\nTotal en la base local:');
      Object.entries(res.totales||{}).forEach(([t, n]) => { if(t !== '_navegador') ui.log('  · '+t+': '+n); });
      ui.log('\n✓ Migración terminada. Ya puedes usar el sistema desde '+base+'/admin.html');

      lsSet(LS_DB_URL, base);
      const isHere = trimUrl(location.origin) === base;
      ui.foot(isHere
        ? '<button onclick="location.reload()" style="padding:8px 16px;border-radius:8px;border:none;background:#d4af37;color:#000;font-weight:700;cursor:pointer">Recargar</button>'
        : '<a href="'+base+'/admin.html" style="padding:8px 16px;border-radius:8px;background:#d4af37;color:#000;font-weight:700;text-decoration:none">Abrir el sistema local →</a>');
    }catch(e){
      ui.log('\n✖ Error: '+e.message);
      ui.log('  No se borró nada. Puedes volver a intentarlo.');
    }finally{
      running = false;
    }
  }
  window.pmMigrarABaseLocal = pmMigrarABaseLocal;

  // ── Al abrir desde el servidor local: recuperar ajustes del navegador migrados ──
  async function restoreBrowserSettings(){
    if(!isServedLocally || lsGet(LS_RESTORED)) return;
    try{
      const rows = await fetchJson(PM_DB_URL+'/rest/v1/_navegador?select=*');
      if(!Array.isArray(rows) || !rows.length) return;   // aún no se ha migrado: volver a intentar la próxima vez
      let restored = 0;
      rows.forEach(r => { if(r && r.id && !RESTORE_SKIP.test(r.id) && lsGet(r.id) === null && typeof r.value === 'string'){ lsSet(r.id, r.value); restored++; } });
      lsSet(LS_RESTORED, new Date().toISOString());
      if(restored) location.reload();
    }catch{}
  }
  restoreBrowserSettings();
})();
