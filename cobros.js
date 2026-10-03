// ══════════════════════════════════════════════════════════════
//  PLEASEME — Cobros: abonos y saldo pendiente · tasa de cambio USD/DOP ·
//  ficha de cliente y lista de clientes.
//
//  Se carga al final de index.html (Facturación) y usa sus funciones globales
//  (DB, g, esc, toast, sbGET/sbPOST/sbPATCH, fmtM, loadForEdit, quickPDF…).
//
//  • Abonos: tabla "pagos" (una fila por abono). Una factura entra en
//    "seguimiento de cobro" cuando tiene al menos un registro (abono, o la
//    marca "a crédito"). Saldo = total − abonos. Las facturas sin registros
//    siguen funcionando como siempre (al contado).
//  • Tasa: clave "tasas_usd_dop" de la tabla config (historial por fecha).
//    Solo informa equivalencias; no cambia los montos guardados.
// ══════════════════════════════════════════════════════════════
(function(){
  'use strict';

  const $ = id => document.getElementById(id);
  const num = v => Number(v) || 0;
  const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
  const EPS = 0.005;
  const pad = n => String(n).padStart(2, '0');
  const isoLocal = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const hoyISO = () => isoLocal(new Date());
  const mon = o => (o && o.currency === 'DOP') ? 'DOP' : 'USD';
  const fm = (n, c) => fmtM(n, c);
  const fechaFactura = o => String(o.invoice_date || (o.created_at ? isoLocal(new Date(o.created_at)) : hoyISO())).slice(0, 10);
  const fechaCorta = iso => { const d = new Date(String(iso).length === 10 ? iso + 'T12:00:00' : iso); return isNaN(d) ? '—' : d.toLocaleDateString('es'); };
  const nombreLimpio = s => String(s || '').trim().replace(/\s+/g, ' ');
  const cancelada = o => ['cancelado', 'anulado'].includes(o.status || o.invoice_status);
  const sumaMapa = t => {
    const p = ['USD', 'DOP'].filter(c => t[c] > EPS).map(c => fm(t[c], c));
    return p.length ? p.join(' + ') : fm(0, 'USD');
  };

  // ── Estilos propios ─────────────────────────────────────────
  const st = document.createElement('style');
  st.textContent = `
    .saldo-chip{font-size:10px;padding:1px 7px;border-radius:20px;background:rgba(255,154,77,.14);color:#ff9a4d;border:1px solid rgba(255,154,77,.4);font-weight:700;white-space:nowrap}
    .saldo-chip.ok{background:rgba(47,227,181,.12);color:#2fe3b5;border-color:rgba(47,227,181,.35)}
    .kpi-cobrar{border-left-color:#ff9a4d;--glow:rgba(255,154,77,.30)}.kpi-cobrar .kpi-val{color:#ff9a4d}
    .cb-t1{border-color:rgba(255,200,60,.85)!important;background:linear-gradient(100deg,rgba(255,196,48,.22),rgba(255,196,48,.04))!important;box-shadow:0 0 14px rgba(255,196,48,.18)}
    .cb-t2{border-color:rgba(176,124,255,.75)!important;background:linear-gradient(100deg,rgba(150,95,255,.20),rgba(150,95,255,.04))!important}
    .cb-t3{border-color:rgba(47,200,227,.6)!important;background:linear-gradient(100deg,rgba(47,200,227,.15),rgba(47,200,227,.03))!important}
    .cb-nivel{display:inline-block;font-size:10px;font-weight:700;letter-spacing:.4px;padding:1px 7px;border-radius:99px;margin-left:6px;vertical-align:middle}
    .cb-nivel.t1{background:#ffc430;color:#2a1c00}.cb-nivel.t2{background:#b07cff;color:#1d0b3a}.cb-nivel.t3{background:#2fc8e3;color:#00262d}
    .cb-tabs{display:flex;gap:8px;margin-bottom:10px}
    .cb-tab{flex:1;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 14px;border-radius:10px;border:1px solid var(--border);background:rgba(212,175,55,.05);color:#d8c690;font-size:13px;font-weight:700;cursor:pointer;transition:.15s}
    .cb-tab:hover{background:rgba(212,175,55,.12)}
    .cb-tab.on{background:linear-gradient(135deg,#b48226,#d9b445);color:#171106;border-color:transparent;box-shadow:0 4px 14px rgba(212,175,55,.25)}
    .cb-tab small{font-size:11px;padding:1px 8px;border-radius:99px;background:rgba(0,0,0,.28);color:inherit}
    .cb-tab.on small{background:rgba(0,0,0,.2)}
    .cb-opt{display:flex;justify-content:space-between;align-items:center;gap:8px;width:100%;padding:9px 12px;border-radius:8px;border:1px solid var(--border);background:rgba(212,175,55,.04);color:var(--text);font-size:13px;cursor:pointer;text-align:left}
    .cb-opt:hover,.cb-opt:focus-visible{background:rgba(212,175,55,.14);outline:none;border-color:var(--border2)}
    .cb-opt small{color:var(--muted)}
    .cb-chips{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
    .cb-chip{flex:1;min-width:110px;background:rgba(212,175,55,.06);border:1px solid var(--border);border-radius:10px;padding:8px 12px}
    .cb-chip small{display:block;font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.8px}
    .cb-chip b{font-family:Georgia,serif;font-size:17px;color:var(--gold)}
    .cb-chip.warn b{color:#ff9a4d}.cb-chip.ok b{color:#2fe3b5}
    .cb-box{border:1px solid var(--border);border-radius:10px;padding:12px;margin-top:12px;background:rgba(0,0,0,.18)}
    .cb-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:8px 0}
    @media(max-width:520px){.cb-grid{grid-template-columns:1fr}}
    .cb-row{display:flex;align-items:center;gap:10px;justify-content:space-between;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.06);font-size:12px}
    .cb-avatar{width:54px;height:54px;border-radius:50%;background:linear-gradient(135deg,#b48226,#e8c56e);color:#13100a;display:grid;place-items:center;font-weight:800;font-size:20px;flex-shrink:0}
    .cb-muted{color:var(--muted);font-size:11px}
  `;
  document.head.appendChild(st);

  // ── Ventanas emergentes (con pila: Esc cierra solo la de arriba) ──
  const pila = [];
  const refrescadores = new Set();
  document.addEventListener('keydown', e => {
    if(e.key !== 'Escape' || !pila.length) return;
    e.preventDefault(); e.stopPropagation();       // que Esc no limpie el formulario de la factura
    pila[pila.length - 1].cerrar();
  }, true);

  function modal(id, titulo, ancho){
    document.getElementById(id)?.remove();
    const ov = document.createElement('div');
    ov.id = id;
    ov.style.cssText = 'position:fixed;inset:0;z-index:530;background:rgba(0,0,0,.8);display:flex;align-items:center;justify-content:center;padding:14px';
    ov.innerHTML = `<div style="background:var(--surface);border:1px solid var(--border);border-radius:16px;width:min(${ancho || 720}px,96vw);max-height:90vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.8)">
      <div style="padding:14px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:10px;flex-shrink:0">
        <span data-t style="font-family:Georgia,serif;font-size:17px;color:var(--gold);font-weight:700">${titulo}</span>
        <button data-x style="background:none;border:none;color:var(--muted);font-size:22px;cursor:pointer;line-height:1">✕</button>
      </div>
      <div data-b style="overflow-y:auto;padding:14px 20px;flex:1"></div></div>`;
    document.body.appendChild(ov);
    const M = { ov, cuerpo: ov.querySelector('[data-b]'), titulo: ov.querySelector('[data-t]'), refrescar: null };
    M.cerrar = () => {
      ov.remove();
      const i = pila.indexOf(M); if(i >= 0) pila.splice(i, 1);
      if(M.refrescar) refrescadores.delete(M.refrescar);
    };
    pila.push(M);
    ov.addEventListener('mousedown', e => { if(e.target === ov) M.cerrar(); });
    ov.querySelector('[data-x]').onclick = M.cerrar;
    M.alRefrescar = fn => { M.refrescar = fn; refrescadores.add(fn); };
    return M;
  }
  const cerrarTodas = () => [...pila].forEach(M => M.cerrar());

  // ══════════════════════════════════════════════════════════
  //  TASA DE CAMBIO USD / DOP
  // ══════════════════════════════════════════════════════════
  let TASAS = [];     // [{f:'AAAA-MM-DD', t:59.5}] ordenado por fecha
  const LS_TASAS = 'pm_tasas_usd_dop';
  const ordenarTasas = a => a.filter(x => x && /^\d{4}-\d{2}-\d{2}$/.test(x.f) && num(x.t) > 0).map(x => ({ f: x.f, t: num(x.t), ...(x.a ? { a: 1 } : {}) })).sort((a, b) => a.f.localeCompare(b.f));

  async function cargarTasas(){
    let arr = null;
    try{
      const r = await sbGET('config?select=value&key=eq.tasas_usd_dop&limit=1');
      if(r && r.length){
        let v = r[0].value;
        if(typeof v === 'string'){ try{ v = JSON.parse(v); }catch(e){} }
        if(Array.isArray(v)) arr = v;
      }
    }catch(e){}
    if(!arr){ try{ arr = JSON.parse(localStorage.getItem(LS_TASAS) || '[]'); }catch(e){ arr = []; } }
    TASAS = ordenarTasas(arr);
    pintarTasaBtn();
  }
  async function guardarTasas(){
    try{ localStorage.setItem(LS_TASAS, JSON.stringify(TASAS)); }catch(e){}
    try{ await sbPOST('config', { key: 'tasas_usd_dop', value: JSON.stringify(TASAS) }, 'resolution=merge-duplicates,return=minimal'); }
    catch(e){ console.error('[Tasa]', e.message); }
    pintarTasaBtn();
  }
  // Tasa en vigor en una fecha: la última registrada hasta ese día (o la primera, si es anterior)
  function tasaVigente(fecha){
    if(!TASAS.length) return 0;
    const f = String(fecha || hoyISO()).slice(0, 10);
    let t = TASAS[0].t;
    for(const x of TASAS){ if(x.f <= f) t = x.t; else break; }
    return t;
  }
  function convertir(monto, de, a, fecha){
    if(de === a) return monto;
    const t = tasaVigente(fecha); if(!t) return monto;
    return de === 'USD' ? monto * t : monto / t;
  }
  function pintarTasaBtn(){
    const b = $('btnTasa'); if(!b) return;
    const t = tasaVigente(hoyISO());
    const bd = b.querySelector('.sb-badge'); if(bd) bd.textContent = t ? 'RD$' + t.toFixed(2) : ''; else b.textContent = t ? '💱 RD$' + t.toFixed(2) : '💱 Tasa';
    b.title = t ? '1 USD = RD$ ' + t.toFixed(2) + ' (clic para cambiarla)' : 'Configurar la tasa de cambio USD/DOP';
  }
  // Texto "Equivale a …" para la factura impresa / PDF
  function equivalenteTexto(o){
    const t = o._tasa || tasaVigente(fechaFactura(o)); if(!t) return '';
    const c = mon(o), total = num(o.total);
    const otra = c === 'USD' ? 'DOP' : 'USD';
    const v = c === 'USD' ? total * t : total / t;
    return 'Equivale a ' + fm(v, otra) + ' (tasa: 1 USD = RD$ ' + t.toFixed(2) + ')';
  }
  // Línea "≈ …" bajo el total del formulario
  function pintarEquivForm(total, cur){
    const el = $('tEquiv'); if(!el) return;
    const t = tasaVigente(($('f_date') && $('f_date').value) || hoyISO());
    if(!t || !total){ el.style.display = 'none'; return; }
    const otra = cur === 'USD' ? 'DOP' : 'USD';
    el.textContent = '≈ ' + fm(cur === 'USD' ? total * t : total / t, otra) + '  (1 USD = RD$ ' + t.toFixed(2) + ')';
    el.style.display = 'block';
  }
  // Al cambiar USA ↔ RD: ofrece convertir los precios con la tasa
  function cambiarPais(){
    const nueva = (typeof monedaActual === 'function') ? monedaActual() : 'USD';
    const vieja = window.__monPrev || 'USD';
    const fecha = ($('f_date') && $('f_date').value) || hoyISO();
    const t = tasaVigente(fecha);
    if(vieja !== nueva && t && (items.length || num(parseMoney($('f_shipping').value)) > 0)){
      if(confirm('¿Convertir los precios de ' + vieja + ' a ' + nueva + ' con la tasa 1 USD = RD$ ' + t.toFixed(2) + '?\n\nAceptar = convertir los precios, envío y descuento fijo\nCancelar = dejar los números tal cual (solo cambia el símbolo)')){
        items.forEach(i => { i.price = r2(convertir(num(i.price), vieja, nueva, fecha)); });
        $('f_shipping').value = r2(convertir(num(parseMoney($('f_shipping').value)), vieja, nueva, fecha)).toFixed(2);
        if($('f_discType').value === 'fixed') $('f_discVal').value = r2(convertir(num(parseMoney($('f_discVal').value)), vieja, nueva, fecha));
      }
    }
    aplicarMonedaForm();
  }

  // Tasa en línea (se actualiza sola; una tasa escrita a mano para hoy no se pisa)
  const LS_TASA_TS = 'pm_tasa_auto_ts';
  const FUENTES_TASA = [
    ['https://open.er-api.com/v6/latest/USD', j => j && j.rates && j.rates.DOP],
    ['https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json', j => j && j.usd && j.usd.dop],
    ['https://latest.currency-api.pages.dev/v1/currencies/usd.json', j => j && j.usd && j.usd.dop],
  ];
  async function tasaOnline(forzar){
    const hoy = hoyISO();
    const ya = TASAS.find(x => x.f === hoy);
    if(!forzar){
      if(ya && !ya.a) return false;                                  // hoy la escribió el usuario
      let ts = 0; try{ ts = Number(localStorage.getItem(LS_TASA_TS)) || 0; }catch(e){}
      if(ya && ya.a && Date.now() - ts < 3 * 3600000) return false;  // ya se actualizó hace poco
    }
    for(const [url, leer] of FUENTES_TASA){
      try{
        const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 8000);
        const r = await fetch(url, { signal: ctl.signal }); clearTimeout(to);
        const v = num(leer(await r.json()));
        if(!(v > 20 && v < 500)) continue;                           // descarta datos absurdos
        TASAS = ordenarTasas([...TASAS.filter(x => x.f !== hoy), { f: hoy, t: r2(v), a: 1 }]);
        try{ localStorage.setItem(LS_TASA_TS, String(Date.now())); }catch(e){}
        await guardarTasas(); refrescarTodo();
        return true;
      }catch(e){ /* sin internet o fuente caída: se prueba la siguiente */ }
    }
    return false;
  }

  function abrirTasa(){
    const M = modal('tasaModal', '💱 Tasa de cambio USD / DOP', 460);
    const pintar = () => {
      const t = tasaVigente(hoyISO());
      M.cuerpo.innerHTML = `
        <div style="font-size:13px;margin-bottom:10px">${t ? 'Hoy: <b style="color:var(--gold)">1 USD = RD$ ' + t.toFixed(2) + '</b>' : '<span class="cb-muted">Todavía no hay una tasa registrada.</span>'}</div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px">
          <button class="btn btn-outline btn-sm" id="tsOnline">🌐 Actualizar desde internet</button>
          <span class="cb-muted" id="tsOnlineEstado">${(TASAS.find(x => x.f === hoyISO()) || {}).a ? 'La tasa de hoy se cargó sola desde internet.' : 'Se actualiza sola al abrir la app.'}</span>
        </div>
        <div class="cb-box" style="margin-top:0">
          <b style="font-size:12px">Registrar la tasa</b>
          <div class="cb-grid">
            <div><label class="lbl">1 USD = RD$</label><input id="tsValor" inputmode="decimal" placeholder="Ej: 59.50" value="${t ? t.toFixed(2) : ''}" autocomplete="off"/></div>
            <div><label class="lbl">Desde la fecha</label><input id="tsFecha" type="date" value="${hoyISO()}"/></div>
          </div>
          <button class="btn btn-gold btn-sm" id="tsGuardar">Guardar tasa</button>
          <div class="cb-muted" style="margin-top:6px">Cada factura usa la tasa vigente en su fecha. Solo sirve para ver equivalencias y convertir precios; no cambia los montos ya guardados.</div>
        </div>
        <div class="cb-box">
          <b style="font-size:12px">Calculadora</b>
          <div class="cb-grid">
            <div><label class="lbl">Dólares (USD)</label><input id="tsUSD" inputmode="decimal" placeholder="0.00" autocomplete="off"/></div>
            <div><label class="lbl">Pesos (RD$)</label><input id="tsDOP" inputmode="decimal" placeholder="0.00" autocomplete="off"/></div>
          </div>
        </div>
        ${TASAS.length ? `<div style="margin-top:12px"><b style="font-size:12px">Historial</b>${[...TASAS].reverse().slice(0, 12).map(x => `
          <div class="cb-row"><span>${fechaCorta(x.f)}</span><b style="color:var(--gold)">RD$ ${x.t.toFixed(2)}</b>
          <button class="btn btn-sm btn-red" data-del="${x.f}" title="Quitar esta tasa">🗑</button></div>`).join('')}</div>` : ''}`;
      $('tsOnline').onclick = async () => {
        $('tsOnline').disabled = true; $('tsOnlineEstado').textContent = 'Consultando…';
        const ok = await tasaOnline(true);
        if(ok){ toast('🌐 Tasa actualizada: 1 USD = RD$ ' + tasaVigente(hoyISO()).toFixed(2), 'ok'); pintar(); }
        else { $('tsOnline').disabled = false; $('tsOnlineEstado').textContent = 'No se pudo consultar (¿sin internet?). Puedes escribirla a mano.'; }
      };
      $('tsGuardar').onclick = async () => {
        const v = num(parseMoney($('tsValor').value)), f = $('tsFecha').value;
        if(!(v > 0) || !f){ toast('Escribe la tasa y la fecha', 'warn'); return; }
        TASAS = ordenarTasas([...TASAS.filter(x => x.f !== f), { f, t: r2(v) }]);
        await guardarTasas(); toast('💱 Tasa guardada: 1 USD = RD$ ' + r2(v).toFixed(2), 'ok');
        refrescarTodo(); pintar();
      };
      M.cuerpo.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
        TASAS = TASAS.filter(x => x.f !== b.dataset.del); await guardarTasas(); refrescarTodo(); pintar();
      });
      const tc = tasaVigente(hoyISO());
      $('tsUSD').oninput = () => { if(tc) $('tsDOP').value = $('tsUSD').value ? r2(num(parseMoney($('tsUSD').value)) * tc).toFixed(2) : ''; };
      $('tsDOP').oninput = () => { if(tc) $('tsUSD').value = $('tsDOP').value ? r2(num(parseMoney($('tsDOP').value)) / tc).toFixed(2) : ''; };
    };
    pintar();
  }

  // ══════════════════════════════════════════════════════════
  //  ABONOS Y SALDO
  // ══════════════════════════════════════════════════════════
  let PAGOS = [];
  const normalizarPago = p => ({ ...p, monto: num(p.monto) });
  async function cargarPagos(){
    try{ const d = await sbGET('pagos?select=*&order=created_at.asc'); PAGOS = Array.isArray(d) ? d.map(normalizarPago) : []; }
    catch(e){ PAGOS = []; }
  }
  const pagosDe = id => PAGOS.filter(p => String(p.factura_id) === String(id));

  // totalForm: total del formulario sin guardar (si se está editando esa misma factura)
  function infoCobro(o, totalForm){
    const ps = pagosDe(o.id);
    if(!ps.length || cancelada(o)) return { credito: false, abonado: 0, saldo: 0, pagos: ps, estado: 'contado' };
    const total = totalForm !== undefined ? totalForm : num(o.total);
    const abonado = r2(ps.filter(p => p.tipo !== 'credito').reduce((a, p) => a + num(p.monto), 0));
    const saldo = Math.max(0, r2(total - abonado));
    return { credito: true, abonado, saldo, total, pagos: ps, estado: saldo <= EPS ? 'saldada' : (abonado > 0 ? 'abonada' : 'credito') };
  }
  const saldoDe = o => infoCobro(o).saldo;

  // Datos de cobro para la factura impresa/PDF (usa la copia guardada si existe)
  function cobroImpresion(o){
    if(o._cobro) return o._cobro;
    const c = infoCobro(o);
    return c.credito ? { abonado: c.abonado, saldo: c.saldo } : null;
  }

  function cambiarEstado(o, nuevo){
    o.status = nuevo; o.invoice_status = nuevo;
    if(editingId === o.id && $('f_status')) $('f_status').value = nuevo;
    const fin = () => { persist(); refrescarTodo(); };
    sbPATCH('facturas', 'id=eq.' + encodeURIComponent(o.id), { status: nuevo, updated_at: new Date().toISOString() }).then(fin, fin);
  }
  // En una factura con seguimiento de cobro, "pagado" ⇔ saldo en cero
  function sincronizarEstadoCobro(o){
    const c = infoCobro(o); if(!c.credito) return;
    const est = o.status || o.invoice_status || 'pendiente';
    if(c.saldo <= EPS && ['pendiente', 'procesando'].includes(est)) cambiarEstado(o, 'pagado');
    else if(c.saldo > EPS && est === 'pagado') cambiarEstado(o, 'procesando');
  }

  async function guardarPago(o, { tipo, monto, fecha, metodo, nota }){
    const rec = { id: 'pg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6), factura_id: o.id, invoice_num: o.invoice_num || '',
      tipo, monto: r2(monto), moneda: mon(o), fecha: fecha || hoyISO(), metodo: metodo || '', nota: nota || '', created_at: new Date().toISOString() };
    await sbPOST('pagos', rec, 'return=minimal');
    PAGOS.push(normalizarPago(rec));
    sincronizarEstadoCobro(o);
    refrescarTodo();
    return rec;
  }
  async function eliminarPago(o, id){
    try{ await fetch(SB_URL + '/rest/v1/pagos?id=eq.' + encodeURIComponent(id), { method: 'DELETE', headers: SB_H }); }
    catch(e){ console.error('[Pagos]', e.message); }
    PAGOS = PAGOS.filter(p => p.id !== id);
    sincronizarEstadoCobro(o);
    refrescarTodo();
  }

  const METODOS = [['efectivo', 'Efectivo'], ['transferencia', 'Transferencia'], ['tarjeta', 'Tarjeta'], ['paypal', 'PayPal'], ['otro', 'Otro']];
  const metodoTxt = m => (METODOS.find(x => x[0] === m) || [0, m || '—'])[1];

  function abrirAbonos(facId){
    const o0 = DB.orders.find(x => x.id === facId);
    if(!o0){ toast('Factura no encontrada', 'err'); return; }
    const M = modal('abonosModal', '💳 Abonos — ' + esc(o0.invoice_num || ''), 580);
    const pintar = () => {
      const o = DB.orders.find(x => x.id === facId) || o0;
      const c = infoCobro(o), cur = mon(o), canc = cancelada(o);
      const saldo = c.credito ? c.saldo : num(o.total);
      M.cuerpo.innerHTML = `
        <div style="font-size:13px;margin-bottom:10px"><b>${esc(nombreLimpio(o.clientName) || 'Sin nombre')}</b> <span class="cb-muted">· ${fechaCorta(fechaFactura(o))}</span></div>
        <div class="cb-chips">
          <div class="cb-chip"><small>Total</small><b>${fm(o.total, cur)}</b></div>
          <div class="cb-chip ok"><small>Abonado</small><b>${fm(c.abonado, cur)}</b></div>
          <div class="cb-chip ${saldo > EPS ? 'warn' : 'ok'}"><small>Saldo</small><b>${fm(saldo, cur)}</b></div>
        </div>
        ${c.pagos.length ? c.pagos.map(p => `<div class="cb-row">
            <span>${fechaCorta(p.fecha || p.created_at)}</span>
            <span style="flex:1">${p.tipo === 'credito' ? '<i>Marcada a crédito</i>' : esc(metodoTxt(p.metodo)) + (p.nota ? ' · <span class="cb-muted">' + esc(p.nota) + '</span>' : '')}</span>
            <b style="color:#2fe3b5">${p.tipo === 'credito' ? '' : fm(p.monto, cur)}</b>
            <button class="btn btn-sm btn-red" data-del="${esc(p.id)}" title="Quitar este registro">🗑</button></div>`).join('')
          : '<div class="cb-muted" style="padding:8px 0">Todavía no hay abonos. Al registrar el primero, esta factura queda con seguimiento de saldo.</div>'}
        ${canc ? '<div class="cb-box" style="color:#ff6b6b">Esta factura está anulada: no se pueden registrar abonos.</div>' : `
        <div class="cb-box">
          <b style="font-size:12px">Registrar abono</b>
          <div class="cb-grid">
            <div><label class="lbl">Monto (${cur === 'DOP' ? 'RD$' : '$'})</label><input id="abMonto" inputmode="decimal" autocomplete="off" value="${saldo > EPS ? saldo.toFixed(2) : ''}"/></div>
            <div><label class="lbl">Fecha</label><input id="abFecha" type="date" value="${hoyISO()}"/></div>
            <div><label class="lbl">Método</label><select id="abMetodo">${METODOS.map(m => `<option value="${m[0]}">${m[1]}</option>`).join('')}</select></div>
            <div><label class="lbl">Nota (opcional)</label><input id="abNota" placeholder="Ej: primer abono" autocomplete="off"/></div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-gold btn-sm" id="abRegistrar">＋ Registrar abono</button>
            ${saldo > EPS ? '<button class="btn btn-green btn-sm" id="abTodo">✔ Cobrar el saldo completo</button>' : ''}
            ${!c.credito ? '<button class="btn btn-outline btn-sm" id="abCredito" title="La factura queda con saldo pendiente aunque todavía no haya abonos">Marcar a crédito (sin abono)</button>' : ''}
          </div>
        </div>`}`;
      M.cuerpo.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
        if(confirm('¿Quitar este registro?')) await eliminarPago(o, b.dataset.del);
      });
      const registrar = async monto => {
        if(!(monto > 0)){ toast('Escribe un monto mayor que cero', 'warn'); return; }
        if(monto > saldo + EPS){ toast('El abono (' + fm(monto, cur) + ') supera el saldo (' + fm(saldo, cur) + ')', 'warn'); return; }
        await guardarPago(o, { tipo: 'abono', monto, fecha: $('abFecha').value, metodo: $('abMetodo').value, nota: $('abNota').value.trim() });
        toast('💳 Abono registrado: ' + fm(monto, cur), 'ok');
      };
      if($('abRegistrar')) $('abRegistrar').onclick = () => registrar(r2(num(parseMoney($('abMonto').value))));
      if($('abTodo')) $('abTodo').onclick = () => registrar(saldo);
      if($('abCredito')) $('abCredito').onclick = async () => {
        await guardarPago(o, { tipo: 'credito', monto: 0, fecha: $('abFecha').value, metodo: '', nota: 'Venta a crédito' });
        toast('💳 Factura marcada a crédito', 'ok');
      };
    };
    M.alRefrescar(pintar);
    pintar();
  }

  // Botón "💳 Abonos…" del formulario: guarda la factura y abre la ventana
  async function abrirAbonosForm(){
    if(!formReadOnly) await saveOnly({ noPrompt: true });
    if(!editingId){ toast('Guarda la factura primero', 'warn'); return; }
    pintarCobroForm();
    abrirAbonos(editingId);
  }

  // Filas de cobro del formulario (abonado / saldo) y texto del botón
  function pintarCobroForm(totalForm){
    const txt = $('cobroTxt'); if(!txt) return;
    const o = editingId ? DB.orders.find(x => x.id === editingId) : null;
    const c = o ? infoCobro(o, totalForm) : null;
    const rA = $('tAbonadoRow'), rS = $('tSaldoRow');
    if(c && c.credito){
      const cur = mon(o);
      rA.style.display = rS.style.display = 'flex';
      $('tAbonado').textContent = fm(c.abonado, cur);
      $('tSaldo').textContent = fm(c.saldo, cur);
      $('tSaldo').style.color = c.saldo > EPS ? '#ff9a4d' : '#2fe3b5';
      txt.innerHTML = c.estado === 'saldada' ? '✅ <b style="color:#2fe3b5">Saldada con abonos</b>' : '💳 <b style="color:#ff9a4d">Saldo pendiente ' + fm(c.saldo, cur) + '</b>';
    } else {
      rA.style.display = rS.style.display = 'none';
      txt.textContent = o ? '💳 Cobro al contado — sin abonos registrados' : '💳 Guarda la factura para poder registrar abonos';
    }
  }

  function cobroBadge(o){
    const c = infoCobro(o);
    if(!c.credito) return '';
    return c.saldo > EPS ? '<span class="saldo-chip" title="Abonado ' + fm(c.abonado, mon(o)) + '">💳 Saldo ' + fm(c.saldo, mon(o)) + '</span>'
                         : '<span class="saldo-chip ok">✅ Saldada</span>';
  }
  const sumaSaldos = lista => { const t = { USD: 0, DOP: 0 }; lista.forEach(o => { t[mon(o)] += saldoDe(o); }); return sumaMapa(t); };

  function pintarKpiCobros(){
    const el = $('kpiCobrar'); if(!el) return;
    const lista = DB.orders.filter(o => saldoDe(o) > EPS);
    el.textContent = sumaSaldos(lista);
    const kpi = el.closest('.kpi'); if(kpi) kpi.title = lista.length + ' factura' + (lista.length !== 1 ? 's' : '') + ' con saldo pendiente — clic para ver quién debe';
  }

  // ══════════════════════════════════════════════════════════
  //  CLIENTES Y FICHA
  // ══════════════════════════════════════════════════════════
  function clientes(){
    const mapa = new Map();
    (DB.clients || []).forEach(c => {
      const k = normNombre(c.name); if(!k) return;
      mapa.set(k, { clave: k, reg: c, nombre: nombreLimpio(c.name), email: c.email || '', phone: c.phone || '', address: c.address || c.shipping_address || '', facturas: [] });
    });
    DB.orders.forEach(o => {
      const nm = o.clientName || o.client_name || ''; const k = normNombre(nm); if(!k) return;
      let c = mapa.get(k);
      if(!c){ c = { clave: k, nombre: nombreLimpio(nm), email: '', phone: '', address: '', facturas: [] }; mapa.set(k, c); }
      if(!c.phone && (o.clientPhone || o.client_phone)) c.phone = o.clientPhone || o.client_phone;
      if(!c.email && (o.clientEmail || o.client_email)) c.email = o.clientEmail || o.client_email;
      if(!c.address && o.address) c.address = o.address;
      c.facturas.push(o);
    });
    const lista = [...mapa.values()];
    lista.forEach(c => {
      const reg = c.reg || {};
      const vivas = c.facturas.filter(o => !cancelada(o)).sort((a, b) => fechaFactura(b).localeCompare(fechaFactura(a)));
      c.pais = reg.country || (vivas[0] && vivas[0].currency === 'DOP' ? 'RD' : (telRD(c.phone) ? 'RD' : 'USA'));
      c.ciudad = reg.city || (vivas.find(o => o.city) || {}).city || '';
      c.courier = { nombre: reg.courier_name || '', direccion: reg.courier_address || '', casillero: reg.courier_casillero || '', telefono: reg.courier_phone || '', notas: reg.courier_notes || '' };
    });
    return lista;
  }
  const telRD = t => { let d = String(t || '').replace(/\D/g, ''); if(d.length === 11 && d[0] === '1') d = d.slice(1); return d.length === 10 && ['809', '829', '849'].includes(d.slice(0, 3)); };
  const tieneCourier = cu => !!(cu && (cu.nombre || cu.direccion || cu.casillero || cu.telefono || cu.notas));
  function estadisticas(c){
    const vivas = c.facturas.filter(o => !cancelada(o));
    const total = { USD: 0, DOP: 0 }, saldo = { USD: 0, DOP: 0 };
    vivas.forEach(o => { total[mon(o)] += num(o.total); saldo[mon(o)] += saldoDe(o); });
    const fechas = vivas.map(fechaFactura).sort();
    const prod = new Map();
    vivas.forEach(o => (o.items || []).forEach(i => {
      const k = normNombre(i.name); if(!k) return;
      const p = prod.get(k) || { nombre: i.name, qty: 0 }; p.qty += num(i.qty) || 1; prod.set(k, p);
    }));
    return { n: vivas.length, anuladas: c.facturas.length - vivas.length, total, saldo, primera: fechas[0] || '', ultima: fechas[fechas.length - 1] || '',
      top: [...prod.values()].sort((a, b) => b.qty - a.qty).slice(0, 5), ordenadas: [...c.facturas].sort((a, b) => fechaFactura(b).localeCompare(fechaFactura(a))) };
  }
  // Nivel del cliente según lo comprado (posición entre todos): 1 = top 10 %, 2 = siguiente 15 %, 3 = hasta la mitad
  const NIVELES = { 1: ['💎 VIP', 'Mejores clientes (top 10 %)'], 2: ['⭐ Frecuente', 'Siguiente 15 %'], 3: ['🙂 Habitual', 'Hasta la mitad'] };
  function nivelesClientes(){
    const t = tasaVigente(hoyISO()) || 1;
    const lista = clientes().map(c => { const s = estadisticas(c); return { k: c.clave, v: s.total.USD + s.total.DOP / t }; }).filter(x => x.v > 0).sort((a, b) => b.v - a.v);
    const m = new Map(), n = lista.length;
    lista.forEach((x, i) => { const p = (i + 1) / n; m.set(x.k, p <= 0.10 || i === 0 ? 1 : p <= 0.25 ? 2 : p <= 0.5 ? 3 : 0); });
    return m;
  }
  const insignia = nv => nv ? `<span class="cb-nivel t${nv}" title="${NIVELES[nv][1]}">${NIVELES[nv][0]}</span>` : '';
  const iniciales = n => nombreLimpio(n).split(' ').slice(0, 2).map(p => p[0]).join('').toUpperCase() || '?';
  const abrirChat = (phone, texto) => {
    const n = whatsappNumber(phone);
    if(!n){ toast('Este cliente no tiene un teléfono válido', 'warn'); return; }
    window.open('https://wa.me/' + n + (texto ? '?text=' + encodeURIComponent(texto) : ''), '_blank');
  };

  function textoRecordatorio(c){
    const deb = c.facturas.filter(o => saldoDe(o) > EPS);
    const lineas = deb.map(o => '• ' + (o.invoice_num || '') + ' (' + fechaCorta(fechaFactura(o)) + '): ' + fm(saldoDe(o), mon(o)));
    const t = { USD: 0, DOP: 0 }; deb.forEach(o => { t[mon(o)] += saldoDe(o); });
    return ['Hola ' + c.nombre + ' ✨', '', 'Te escribimos de Pleaseme para recordarte que tienes un saldo pendiente de *' + sumaMapa(t) + '*:', ...lineas, '', '¡Gracias por tu compra! 💛'].join('\n');
  }

  function abrirFicha(clave){
    const base = clientes().find(x => x.clave === clave);
    if(!base){ toast('Cliente no encontrado', 'warn'); return; }
    const M = modal('fichaModal', '📇 Ficha de cliente', 780);
    const pintar = () => {
      const c = clientes().find(x => x.clave === clave) || base, s = estadisticas(c);
      const deuda = s.saldo.USD > EPS || s.saldo.DOP > EPS;
      M.cuerpo.innerHTML = `
        <div style="display:flex;gap:14px;align-items:center;margin-bottom:12px">
          <div class="cb-avatar">${esc(iniciales(c.nombre))}</div>
          <div style="min-width:0">
            <div style="font-size:17px;font-weight:700">${esc(c.nombre)}${insignia(nivelesClientes().get(c.clave) || 0)}</div>
            <div class="cb-muted">${[c.phone && '📞 ' + esc(c.phone), c.email && '✉ ' + esc(c.email)].filter(Boolean).join(' · ') || 'Sin datos de contacto'}</div>
            ${c.address ? '<div class="cb-muted">📍 ' + esc(c.address) + '</div>' : ''}
            <div class="cb-muted">${c.pais === 'RD' ? 'Cliente en RD' : 'Cliente en USA'}${c.ciudad ? ' · ' + esc(c.ciudad) : ''}</div>
          </div>
        </div>
        <div class="cb-box" style="margin-top:0;margin-bottom:12px;padding:10px 12px">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><b style="font-size:12px">📦 Courier</b>
            <button class="btn btn-outline btn-sm" id="fcCourier">${tieneCourier(c.courier) ? '✏ Editar' : '＋ Agregar'}</button></div>
          ${tieneCourier(c.courier) ? `<div style="font-size:13px;margin-top:6px;line-height:1.55">${[c.courier.nombre && '<b>' + esc(c.courier.nombre) + '</b>', c.courier.casillero && 'Casillero: ' + esc(c.courier.casillero), c.courier.telefono && '📞 ' + esc(c.courier.telefono)].filter(Boolean).join(' · ')}
            ${c.courier.direccion ? '<div class="cb-muted">📍 ' + esc(c.courier.direccion) + '</div>' : ''}${c.courier.notas ? '<div class="cb-muted">' + esc(c.courier.notas) + '</div>' : ''}</div>` : '<div class="cb-muted" style="margin-top:4px">Todavía no tiene información del courier.</div>'}
        </div>
        <div class="cb-chips">
          <div class="cb-chip"><small>Facturas</small><b>${s.n}</b></div>
          <div class="cb-chip"><small>Total comprado</small><b>${sumaMapa(s.total)}</b></div>
          <div class="cb-chip ${deuda ? 'warn' : 'ok'}"><small>Saldo pendiente</small><b>${sumaMapa(s.saldo)}</b></div>
          <div class="cb-chip"><small>Última compra</small><b style="font-size:14px">${s.ultima ? fechaCorta(s.ultima) : '—'}</b></div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
          <button class="btn btn-gold btn-sm" id="fcNueva">＋ Nueva factura</button>
          <button class="btn btn-outline btn-sm" id="fcChat" style="border-color:rgba(47,227,181,.45);color:#2fe3b5">💬 WhatsApp</button>
          ${deuda ? '<button class="btn btn-outline btn-sm" id="fcRecordar" style="border-color:rgba(255,154,77,.5);color:#ff9a4d">💬 Recordar el saldo</button>' : ''}
        </div>
        ${s.top.length ? `<div style="margin-bottom:12px"><b style="font-size:12px">Lo que más compra</b><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">${s.top.map(p => `<span class="cb-chip" style="flex:none;min-width:0;padding:4px 10px;font-size:12px">${esc(p.nombre)} <b style="font-size:12px">×${p.qty}</b></span>`).join('')}</div></div>` : ''}
        <b style="font-size:12px">Facturas (${c.facturas.length}${s.anuladas ? ', ' + s.anuladas + ' anulada' + (s.anuladas !== 1 ? 's' : '') : ''})</b>
        <div style="display:flex;flex-direction:column;gap:6px;margin-top:6px">
        ${s.ordenadas.map(o => `<div class="invoice-card" data-fid="${esc(o.id)}" style="cursor:pointer;padding:8px 12px;${cancelada(o) ? 'opacity:.55' : ''}">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
            <div style="min-width:0"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="inv-num">${esc(o.invoice_num || '—')}</span><span class="status-badge s-${esc(o.status || o.invoice_status || 'pendiente')}">${esc(o.status || o.invoice_status || 'pendiente')}</span>${cobroBadge(o)}</div>
              <div class="inv-meta"><span>📅 ${fechaCorta(fechaFactura(o))}</span><span>🛍 ${(o.items || []).reduce((a, i) => a + (num(i.qty) || 1), 0)}</span></div></div>
            <div style="display:flex;align-items:center;gap:6px;flex-shrink:0"><div class="inv-total">${fm(o.total, mon(o))}</div>
              <button class="btn btn-sm btn-green" data-pdf="${esc(o.id)}" title="Ver PDF">🧾 PDF</button>
              ${cancelada(o) ? '' : `<button class="btn btn-sm btn-outline" data-ab="${esc(o.id)}" title="Abonos">💳</button>`}</div>
          </div></div>`).join('') || '<div class="cb-muted">Todavía no tiene facturas.</div>'}
        </div>`;
      $('fcChat').onclick = () => abrirChat(c.phone);
      if($('fcRecordar')) $('fcRecordar').onclick = () => abrirChat(c.phone, textoRecordatorio(c));
      $('fcNueva').onclick = () => nuevaFacturaPara(c, s);
      $('fcCourier').onclick = () => abrirCourier(c.courier, d => guardarCourierCliente(c, d), c.nombre);
      M.cuerpo.querySelectorAll('[data-fid]').forEach(el => el.onclick = () => { cerrarTodas(); loadForEdit(el.dataset.fid); });
      M.cuerpo.querySelectorAll('[data-pdf]').forEach(b => b.onclick = e => { e.stopPropagation(); quickPDF(b.dataset.pdf); });
      M.cuerpo.querySelectorAll('[data-ab]').forEach(b => b.onclick = e => { e.stopPropagation(); abrirAbonos(b.dataset.ab); });
    };
    M.alRefrescar(pintar);
    pintar();
  }

  async function nuevaFacturaPara(c, s){
    cerrarTodas();
    await resetForm();
    fillClient(c.nombre, c.email, c.phone, c.address);
    const ult = s.ordenadas[0];
    // país/moneda: el del registro del cliente; si no lo tiene, el de su última factura
    $('f_country').value = (c.reg && c.reg.country) || (ult && (typeof paisDeMoneda === 'function') ? paisDeMoneda(ult.currency) : c.pais);
    if(tieneCourier(c.courier) && (c.courier.direccion || c.courier.casillero)){
      $('f_address_usa').value = c.courier.direccion; $('f_casillero').value = c.courier.casillero;
    }else if(ult){    // repite lo que casi no cambia: dirección en USA y casillero
      $('f_address_usa').value = ult.address_usa || ult.shipping_address_usa || '';
      $('f_casillero').value = ult.casillero || ult.casillero_number || '';
    }
    aplicarMonedaForm();
    try{ checkCourierBadge(); }catch(e){}
    window.scrollTo({ top: 0, behavior: 'smooth' });
    $('f_clientName').focus();
  }

  function abrirFichaDesdeForm(){
    const nombre = $('f_clientName').value;
    const k = normNombre(nombre);
    if(!k){ abrirClientes(); return; }
    if(!clientes().some(c => c.clave === k)){ toast('Este cliente todavía no tiene historial', 'warn'); return; }
    abrirFicha(k);
  }

  // ── Ciudades, courier y registro de clientes ──────────────
  const CIUDADES = {
    USA: [['Miami','FL'],['Hialeah','FL'],['Miami Beach','FL'],['Doral','FL'],['Homestead','FL'],['Fort Lauderdale','FL'],['Hollywood','FL'],['West Palm Beach','FL'],['Orlando','FL'],['Kissimmee','FL'],['Tampa','FL'],['Jacksonville','FL'],['New York','NY'],['Brooklyn','NY'],['Bronx','NY'],['Queens','NY'],['Newark','NJ'],['Paterson','NJ'],['Providence','RI'],['Lawrence','MA'],['Boston','MA'],['Philadelphia','PA'],['Atlanta','GA'],['Houston','TX'],['Dallas','TX'],['Chicago','IL'],['Los Angeles','CA']],
    RD: ['Santo Domingo','Santo Domingo Este','Santo Domingo Oeste','Santo Domingo Norte','Santiago','La Romana','San Pedro de Macorís','Puerto Plata','Punta Cana','Higüey','Bávaro','San Francisco de Macorís','La Vega','Moca','Bonao','Baní','San Cristóbal','Boca Chica','Haina','Azua','Barahona','Jarabacoa','Constanza','Samaná','Sosúa','Cabarete','Nagua','Mao','Cotuí','Monte Plata','Hato Mayor','El Seibo'].map(x => [x, '']),
  };
  // Selector de ciudad: las de tus clientes (con cuántos hay) + sugeridas + escribir otra
  function abrirCiudades({ pais, titulo, alElegir, soloExistentes, todas }){
    const M = modal('ciudadModal', titulo || '📍 Elegir ciudad', 420);
    const cuenta = new Map();
    clientes().filter(c => c.pais === pais && c.ciudad).forEach(c => cuenta.set(c.ciudad, (cuenta.get(c.ciudad) || 0) + 1));
    const conocidas = CIUDADES[pais] || [];
    const estadoDe = n => (conocidas.find(x => x[0].toLowerCase() === n.toLowerCase()) || [])[1] || '';
    M.cuerpo.innerHTML = `<input id="cdBuscar" placeholder="Buscar o escribir otra ciudad…" autocomplete="off"/><div id="cdLista" style="margin-top:10px;display:flex;flex-direction:column;gap:5px;max-height:50vh;overflow-y:auto"></div>`;
    const elegir = n => { M.cerrar(); alElegir(n, estadoDe(n)); };
    const opt = (n, txt, extra) => `<button type="button" class="cb-opt" data-n="${esc(n)}"><span>${txt}</span>${extra ? '<small>' + extra + '</small>' : ''}</button>`;
    const pintar = () => {
      const t = $('cdBuscar').value.trim(), tl = t.toLowerCase(), f = x => !tl || x.toLowerCase().includes(tl);
      const propias = [...cuenta.entries()].filter(([n]) => f(n)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'));
      const sug = soloExistentes ? [] : conocidas.filter(([n]) => !cuenta.has(n) && f(n));
      let h = '';
      if(todas && !tl) h += opt('', '🌎 Todas las ciudades', '');
      if(propias.length) h += '<div class="cb-muted" style="margin-top:4px">Ciudades de tus clientes</div>' + propias.map(([n, k]) => opt(n, '📍 ' + esc(n), k + ' cliente' + (k !== 1 ? 's' : ''))).join('');
      if(sug.length) h += '<div class="cb-muted" style="margin-top:6px">Sugeridas</div>' + sug.map(([n]) => opt(n, esc(n), '')).join('');
      if(!soloExistentes && t && ![...cuenta.keys(), ...conocidas.map(x => x[0])].some(n => n.toLowerCase() === tl)) h += opt(t, '➕ Usar «' + esc(t) + '»', '');
      if(!h || (todas && !tl && !propias.length)) h += '<div class="cb-muted" style="padding:8px 2px">' + (soloExistentes ? 'Todavía no hay ciudades registradas en esta lista.' : 'Sin resultados.') + '</div>';
      $('cdLista').innerHTML = h;
      $('cdLista').querySelectorAll('[data-n]').forEach(b => b.onclick = () => elegir(b.dataset.n));
    };
    $('cdBuscar').oninput = pintar;
    $('cdBuscar').onkeydown = e => { if(e.key === 'Enter'){ e.preventDefault(); const p = $('cdLista').querySelector('[data-n]'); if(p) p.click(); } };
    pintar();
    setTimeout(() => $('cdBuscar') && $('cdBuscar').focus(), 50);
  }

  // Ventana de información del courier (del cliente)
  function abrirCourier(inicial, alGuardar, quien){
    const cu = inicial || {};
    const M = modal('courierModal', '📦 Información del courier' + (quien ? ' · ' + esc(quien) : ''), 520);
    M.cuerpo.innerHTML = `
      <div class="cb-muted" style="margin-bottom:8px">El courier recibe los paquetes del cliente (casi siempre en Miami) y los lleva a su destino.</div>
      <div class="cb-grid">
        <div style="grid-column:1/-1"><label class="lbl">Nombre del courier</label><input id="cuNombre" placeholder="Ej: Best Way Courier" autocomplete="off" value="${esc(cu.nombre || '')}"/></div>
        <div style="grid-column:1/-1"><label class="lbl">Dirección del courier (USA)</label><input id="cuDir" placeholder="Calle, ciudad y código postal" autocomplete="off" value="${esc(cu.direccion || '')}"/></div>
        <div><label class="lbl">Casillero / # de cuenta</label><input id="cuCas" placeholder="Ej: PLS-1234" autocomplete="off" value="${esc(cu.casillero || '')}"/></div>
        <div><label class="lbl">Teléfono del courier</label><input id="cuTel" type="tel" placeholder="+1 (000) 000-0000" autocomplete="off" oninput="formatPhoneInput(this)" value="${esc(cu.telefono || '')}"/></div>
        <div style="grid-column:1/-1"><label class="lbl">Notas</label><input id="cuNotas" placeholder="Horario, persona de contacto, referencias…" autocomplete="off" value="${esc(cu.notas || '')}"/></div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
        <button class="btn btn-outline btn-sm" id="cuCancelar">Cancelar</button>
        <button class="btn btn-gold btn-sm" id="cuGuardar">💾 Guardar courier</button>
      </div>`;
    $('cuCancelar').onclick = M.cerrar;
    $('cuGuardar').onclick = async () => {
      const d = { nombre: $('cuNombre').value.trim(), direccion: $('cuDir').value.trim(), casillero: $('cuCas').value.trim(), telefono: $('cuTel').value.trim(), notas: $('cuNotas').value.trim() };
      if(!d.nombre && !d.direccion && !d.casillero){ toast('Escribe al menos el nombre, la dirección o el casillero del courier', 'warn'); $('cuNombre').focus(); return; }
      $('cuGuardar').disabled = true;
      M.cerrar();
      await alGuardar(d);
    };
    setTimeout(() => $('cuNombre') && $('cuNombre').focus(), 50);
  }
  const campoCourier = d => ({ courier_name: d.nombre || null, courier_address: d.direccion || null, courier_casillero: d.casillero || null, courier_phone: d.telefono || null, courier_notes: d.notas || null });
  // Guarda el courier en el registro del cliente (si solo existía por sus facturas, lo crea)
  async function guardarCourierCliente(c, d){
    const campos = campoCourier(d), ahora = new Date().toISOString();
    let reg = (DB.clients || []).find(x => normNombre(x.name) === c.clave), pendiente = false;
    if(reg){
      try{ await sbPATCH('clientes', 'id=eq.' + encodeURIComponent(reg.id), { ...campos, updated_at: ahora }); }catch(e){ pendiente = true; console.error('[Courier]', e.message); }
      Object.assign(reg, campos);
    }else{
      const fila = { id: 'cli-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7), name: c.nombre, email: c.email || null, phone: c.phone || null, country: c.pais,
        shipping_address: c.address || null, billing_address: null, preferred_payment: null, orders_count: 0, created_at: ahora, updated_at: ahora, ...campos };
      try{ await sbPOST('clientes', fila, 'return=minimal'); }catch(e){ pendiente = true; console.error('[Courier]', e.message); }
      DB.clients.push({ id: fila.id, name: c.nombre, email: c.email || '', phone: c.phone || '', country: c.pais, address: c.address || '', shipping_address: c.address || '', billing_address: '', preferred_payment: '', orders_count: 0, ...campos, ...(pendiente ? { pending_sync: true } : {}) });
    }
    try{ localStorage.setItem('pm_clients_v1', JSON.stringify(DB.clients)); }catch(e){}
    toast(pendiente ? '⚠ Courier guardado solo en la base local' : '📦 Courier guardado', pendiente ? 'warn' : 'ok');
    refrescarTodo();
  }

  // ── Registro de un cliente nuevo ──────────────────────────
  const dirJunta = (calle, ciudad, estado, zip) => [calle, ciudad, [estado, zip].filter(Boolean).join(' ')].map(x => String(x || '').trim()).filter(Boolean).join(', ');
  function abrirNuevoCliente(nombreInicial, paisInicial){
    const M = modal('clienteNuevoModal', '👤 Nuevo cliente', 600);
    let courier = null, ciudadRD = '';
    M.cuerpo.innerHTML = `
      <div class="cb-grid">
        <div style="grid-column:1/-1"><label class="lbl">Nombre *</label><input id="ncNombre" placeholder="Nombre y apellido" autocomplete="off" value="${esc(nombreInicial && !/^\d+$/.test(nombreInicial) ? nombreInicial : '')}"/></div>
        <div><label class="lbl">Teléfono</label><input id="ncTel" type="tel" placeholder="+1 (000) 000-0000" autocomplete="off" oninput="formatPhoneInput(this)"/></div>
        <div><label class="lbl">País y moneda</label><select id="ncPais"><option value="USA">USA · USD $</option><option value="RD">RD · DOP RD$</option></select></div>
        <div style="grid-column:1/-1"><label class="lbl">Correo electrónico</label><input id="ncEmail" type="email" placeholder="cliente@correo.com" autocomplete="off"/></div>
      </div>
      <div id="ncUSA" class="cb-grid" style="margin-top:0">
        <div style="grid-column:1/-1"><label class="lbl">Dirección (calle y número)</label><input id="ncCalle" placeholder="Calle y número" autocomplete="off"/></div>
        <div><label class="lbl">Código postal</label><input id="ncZip" inputmode="numeric" placeholder="33101" maxlength="10" autocomplete="off"/></div>
        <div><label class="lbl">Ciudad</label><div style="display:flex;gap:6px"><input id="ncCiudad" placeholder="Ciudad" autocomplete="off"/><button type="button" class="btn btn-outline btn-sm" id="ncCiudadBtn" title="Elegir la ciudad de una lista">📍</button></div></div>
        <div><label class="lbl">Estado</label><input id="ncEstado" placeholder="FL" maxlength="40" autocomplete="off"/></div>
        <div style="display:flex;align-items:flex-end"><span id="ncZipEst" class="cb-muted" style="min-height:18px"></span></div>
      </div>
      <div id="ncRD" class="cb-grid" style="margin-top:0;display:none">
        <div style="grid-column:1/-1"><label class="lbl">Dirección (una sola línea)</label><input id="ncLinea" placeholder="Calle, número, sector…" autocomplete="off"/></div>
        <div style="grid-column:1/-1;display:flex;align-items:center;gap:10px;flex-wrap:wrap"><button type="button" class="btn btn-outline btn-sm" id="ncCiudadRDBtn">📍 Seleccionar ciudad</button><span id="ncCiudadRD" class="cb-muted">Sin ciudad</span></div>
      </div>
      <div class="cb-grid" style="margin-top:0">
        <div style="grid-column:1/-1;display:flex;align-items:center;gap:10px;flex-wrap:wrap"><button type="button" class="btn btn-outline btn-sm" id="ncCourierBtn">📦 Información del courier</button><span id="ncCourierRes" class="cb-muted">Sin courier</span></div>
        <div style="grid-column:1/-1"><label class="lbl">Notas</label><input id="ncNotas" placeholder="Gustos, tallas, referencias…" autocomplete="off"/></div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
        <button class="btn btn-outline btn-sm" id="ncCancelar">Cancelar</button>
        <button class="btn btn-gold btn-sm" id="ncGuardar">💾 Guardar cliente</button>
      </div>`;
    const esRD = () => $('ncPais').value === 'RD';
    const aplicarPais = () => {
      $('ncUSA').style.display = esRD() ? 'none' : ''; $('ncRD').style.display = esRD() ? '' : 'none';
      $('ncTel').placeholder = '+1 (000) 000-0000';
    };
    $('ncPais').value = paisInicial === 'RD' ? 'RD' : 'USA'; aplicarPais();
    let seq = 0, tm = null;
    $('ncZip').oninput = () => {
      clearTimeout(tm);
      const zip = $('ncZip').value.replace(/\D/g, '').slice(0, 5), st = $('ncZipEst');
      if(zip.length !== 5){ st.textContent = ''; return; }
      st.textContent = '🔍 Buscando ciudad…'; const mi = ++seq;
      tm = setTimeout(async () => {
        try{
          const r = await fetch('https://api.zippopotam.us/us/' + zip); if(mi !== seq) return;
          const pl = r.ok && ((await r.json()).places || [])[0]; if(!pl) throw new Error('nf');
          $('ncCiudad').value = pl['place name'] || ''; $('ncEstado').value = pl['state abbreviation'] || pl['state'] || '';
          st.textContent = '✓ ' + $('ncCiudad').value + ($('ncEstado').value ? ', ' + $('ncEstado').value : '');
        }catch(e){ if(mi === seq) st.textContent = 'No se encontró ese código postal — escribe ciudad y estado.'; }
      }, 350);
    };
    $('ncPais').onchange = aplicarPais;
    $('ncCiudadBtn').onclick = () => abrirCiudades({ pais: 'USA', alElegir: (n, e) => { $('ncCiudad').value = n; if(e) $('ncEstado').value = e; } });
    $('ncCiudadRDBtn').onclick = () => abrirCiudades({ pais: 'RD', alElegir: n => { ciudadRD = n; $('ncCiudadRD').textContent = n ? '📍 ' + n : 'Sin ciudad'; } });
    $('ncCourierBtn').onclick = () => abrirCourier(courier, async d => { courier = d; $('ncCourierRes').textContent = [d.nombre, d.casillero && 'Casillero ' + d.casillero].filter(Boolean).join(' · ') || 'Courier guardado'; $('ncCourierBtn').textContent = '✏ Courier'; });
    $('ncCancelar').onclick = M.cerrar;
    $('ncGuardar').onclick = async () => {
      const nombre = nombreLimpio($('ncNombre').value);
      if(!nombre){ toast('Escribe el nombre del cliente', 'warn'); $('ncNombre').focus(); return; }
      const tel = $('ncTel').value.trim(), digs = tel.replace(/\D/g, '');
      const k = normNombre(nombre), ya = clientes().find(c => c.clave === k);
      if(ya){
        if(confirm('Ya existe un cliente llamado "' + ya.nombre + '".\n\nAceptar = abrir su ficha\nCancelar = seguir editando')){ M.cerrar(); abrirFicha(ya.clave); }
        return;
      }
      if(digs.length >= 7){
        const igual = clientes().find(c => c.phone && c.phone.replace(/\D/g, '') === digs);
        if(igual && !confirm('El teléfono ya pertenece a "' + igual.nombre + '".\n\n¿Guardar este cliente de todas formas?')) return;
      }
      const rd = esRD();
      const calle = (rd ? $('ncLinea').value : $('ncCalle').value).trim(), ciudad = rd ? ciudadRD : $('ncCiudad').value.trim();
      const estado = rd ? '' : $('ncEstado').value.trim(), zip = rd ? '' : $('ncZip').value.trim();
      const linea = rd ? (ciudad && !calle.toLowerCase().includes(ciudad.toLowerCase()) ? [calle, ciudad].filter(Boolean).join(', ') : calle) : dirJunta(calle, ciudad, estado, zip);
      const ahora = new Date().toISOString();
      const fila = { id: 'cli-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7), name: nombre, email: $('ncEmail').value.trim() || null, phone: tel || null,
        country: $('ncPais').value, street: calle || null, city: ciudad || null, state: estado || null, zip: zip || null,
        shipping_address: linea || null, billing_address: null, preferred_payment: null, notes: $('ncNotas').value.trim() || null,
        ...(courier ? campoCourier(courier) : {}), orders_count: 0, created_at: ahora, updated_at: ahora };
      $('ncGuardar').disabled = true;
      let pendiente = false;
      try{ await sbPOST('clientes', fila, 'return=minimal'); }catch(e){ pendiente = true; console.error('[Cliente]', e.message); }
      DB.clients.push({ id: fila.id, name: nombre, email: fila.email || '', phone: fila.phone || '', country: fila.country, street: calle, city: ciudad, state: estado, zip, notes: fila.notes || '',
        address: fila.shipping_address || '', shipping_address: fila.shipping_address || '', billing_address: '', preferred_payment: '', orders_count: 0,
        ...(courier ? campoCourier(courier) : {}), ...(pendiente ? { pending_sync: true } : {}) });
      try{ localStorage.setItem('pm_clients_v1', JSON.stringify(DB.clients)); }catch(e){}
      toast(pendiente ? '⚠ Cliente guardado solo en la base local' : '👤 Cliente guardado: ' + nombre, pendiente ? 'warn' : 'ok');
      M.cerrar(); refrescarTodo(); abrirFicha(k);
    };
    setTimeout(() => $('ncNombre') && $('ncNombre').focus(), 50);
  }

  function abrirClientes(){
    const M = modal('clientesModal', '📇 Clientes', 820);
    let q = '', orden = 'reciente', ciudad = '', pais = 'USA';
    try{ pais = localStorage.getItem('pm_cli_pais') === 'RD' ? 'RD' : 'USA'; }catch(e){}
    M.cuerpo.innerHTML = `
      <div class="cb-tabs">
        <button class="cb-tab" data-p="USA">Clientes en USA <small id="clN_USA">0</small></button>
        <button class="cb-tab" data-p="RD">Clientes en RD <small id="clN_RD">0</small></button>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
        <input id="clBuscar" placeholder="Buscar por nombre, teléfono o correo…" autocomplete="off" style="flex:1;min-width:200px"/>
        <button class="btn btn-outline btn-sm" id="clCiudad" title="Filtrar por la ciudad del cliente">📍 Ciudad: Todas</button>
        <button class="btn btn-gold btn-sm" id="clNuevo" title="Registrar un cliente nuevo">＋ Nuevo cliente</button>
        <select id="clOrden" style="width:auto"><option value="reciente">Más recientes</option><option value="compra">Mayor compra</option><option value="saldo">Mayor saldo</option><option value="az">A – Z</option></select>
      </div>
      <div id="clResumen" class="cb-muted" style="margin-bottom:8px"></div>
      <div id="clLista" style="display:flex;flex-direction:column;gap:6px"></div>`;
    const pintar = () => {
      const t = q.toLowerCase();
      const todos = clientes();
      ['USA', 'RD'].forEach(p => { $('clN_' + p).textContent = todos.filter(c => c.pais === p).length; });
      M.cuerpo.querySelectorAll('.cb-tab').forEach(b => b.classList.toggle('on', b.dataset.p === pais));
      $('clCiudad').textContent = '📍 Ciudad: ' + (ciudad || 'Todas');
      let lista = todos.filter(c => c.pais === pais && (!ciudad || c.ciudad === ciudad)).map(c => ({ c, s: estadisticas(c) }))
        .filter(({ c }) => !t || (c.nombre + ' ' + c.phone + ' ' + c.email).toLowerCase().includes(t));
      const val = ({ s }) => s.total.USD + s.total.DOP / (tasaVigente(hoyISO()) || 1);
      const deb = ({ s }) => s.saldo.USD + s.saldo.DOP / (tasaVigente(hoyISO()) || 1);
      lista.sort((a, b) => orden === 'az' ? a.c.nombre.localeCompare(b.c.nombre, 'es') : orden === 'compra' ? val(b) - val(a) : orden === 'saldo' ? deb(b) - deb(a) : (b.s.ultima || '').localeCompare(a.s.ultima || ''));
      $('clResumen').innerHTML = esc(lista.length + ' cliente' + (lista.length !== 1 ? 's' : '') + ' en ' + pais + (ciudad ? ' · ' + ciudad : '') + (lista.some(x => deb(x) > EPS) ? ' · ' + lista.filter(x => deb(x) > EPS).length + ' con saldo pendiente' : '')) + ' &nbsp;·&nbsp; Nivel por compras: ' + insignia(1) + insignia(2) + insignia(3);
      const nivs = nivelesClientes();
      $('clLista').innerHTML = lista.map(({ c, s }) => { const nv = nivs.get(c.clave) || 0; return `<div class="invoice-card${nv ? ' cb-t' + nv : ''}" data-k="${esc(c.clave)}" style="cursor:pointer;padding:9px 12px">
        <div style="display:flex;align-items:center;gap:10px;justify-content:space-between">
          <div style="display:flex;align-items:center;gap:10px;min-width:0"><div class="cb-avatar" style="width:38px;height:38px;font-size:14px">${esc(iniciales(c.nombre))}</div>
            <div style="min-width:0"><div style="font-weight:600;font-size:13px">${esc(c.nombre)}${insignia(nv)}</div><div class="cb-muted">${esc(c.phone || 'Sin teléfono')}${c.ciudad ? ' · 📍 ' + esc(c.ciudad) : ''} · ${s.n} factura${s.n !== 1 ? 's' : ''}${s.ultima ? ' · última ' + fechaCorta(s.ultima) : ''}</div></div></div>
          <div style="text-align:right;flex-shrink:0"><div class="inv-total" style="font-size:13px">${sumaMapa(s.total)}</div>
            ${(s.saldo.USD > EPS || s.saldo.DOP > EPS) ? '<span class="saldo-chip">💳 Debe ' + sumaMapa(s.saldo) + '</span>' : ''}</div>
        </div></div>`; }).join('') || '<div class="items-empty" style="padding:20px;text-align:center;color:var(--muted)">Sin clientes en ' + (pais === 'RD' ? 'RD' : 'USA') + (ciudad ? ' para esa ciudad' : ' que coincidan') + '</div>';
      $('clLista').querySelectorAll('[data-k]').forEach(el => el.onclick = () => abrirFicha(el.dataset.k));
    };
    M.cuerpo.querySelectorAll('.cb-tab').forEach(b => b.onclick = () => { pais = b.dataset.p; ciudad = ''; try{ localStorage.setItem('pm_cli_pais', pais); }catch(e){} pintar(); });
    $('clCiudad').onclick = () => abrirCiudades({ pais, titulo: '📍 Ciudad de los clientes en ' + pais, soloExistentes: true, todas: true, alElegir: n => { ciudad = n; pintar(); } });
    $('clNuevo').onclick = () => abrirNuevoCliente(q, pais);
    $('clBuscar').oninput = e => { q = e.target.value; pintar(); };
    $('clOrden').onchange = e => { orden = e.target.value; pintar(); };
    M.alRefrescar(pintar);
    pintar();
    setTimeout(() => $('clBuscar') && $('clBuscar').focus(), 50);
  }

  // ══════════════════════════════════════════════════════════
  //  CUENTAS POR COBRAR
  // ══════════════════════════════════════════════════════════
  function abrirCuentasPorCobrar(){
    const M = modal('cxcModal', '💳 Cuentas por cobrar', 820);
    M.cuerpo.innerHTML = `<input id="cxBuscar" placeholder="Buscar cliente o factura…" autocomplete="off" style="margin-bottom:10px"/><div id="cxResumen" style="margin-bottom:10px"></div><div id="cxLista" style="display:flex;flex-direction:column;gap:10px"></div>`;
    let q = '';
    const pintar = () => {
      const t = q.toLowerCase();
      const grupos = clientes().map(c => ({ c, deb: c.facturas.filter(o => saldoDe(o) > EPS).sort((a, b) => fechaFactura(a).localeCompare(fechaFactura(b))) }))
        .filter(x => x.deb.length && (!t || (x.c.nombre + ' ' + x.deb.map(o => o.invoice_num).join(' ')).toLowerCase().includes(t)))
        .sort((a, b) => fechaFactura(a.deb[0]).localeCompare(fechaFactura(b.deb[0])));      // la deuda más vieja primero
      const todas = grupos.flatMap(x => x.deb);
      const tasa = tasaVigente(hoyISO());
      const tot = { USD: 0, DOP: 0 }; todas.forEach(o => { tot[mon(o)] += saldoDe(o); });
      $('cxResumen').innerHTML = todas.length
        ? `<div class="cb-chips"><div class="cb-chip warn"><small>Por cobrar</small><b>${sumaMapa(tot)}</b></div>
           <div class="cb-chip"><small>Clientes</small><b>${grupos.length}</b></div><div class="cb-chip"><small>Facturas</small><b>${todas.length}</b></div>
           ${tasa && tot.USD > EPS && tot.DOP > EPS ? '<div class="cb-chip"><small>Total equivalente</small><b>' + fm(tot.USD + tot.DOP / tasa, 'USD') + '</b></div>' : ''}</div>`
        : '<div class="cb-muted">No hay saldos pendientes. 🎉</div>';
      $('cxLista').innerHTML = grupos.map(({ c, deb }) => {
        const t2 = { USD: 0, DOP: 0 }; deb.forEach(o => { t2[mon(o)] += saldoDe(o); });
        return `<div class="cb-box" style="margin-top:0"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px">
          <div><b>${esc(c.nombre)}</b> <span class="cb-muted">${esc(c.phone || '')}</span></div>
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><b style="color:#ff9a4d">${sumaMapa(t2)}</b>
            <button class="btn btn-sm btn-outline" data-ficha="${esc(c.clave)}">📇 Ficha</button>
            <button class="btn btn-sm btn-outline" data-rec="${esc(c.clave)}" style="border-color:rgba(47,227,181,.45);color:#2fe3b5">💬 Recordar</button></div></div>
          ${deb.map(o => { const ci = infoCobro(o); const dias = Math.max(0, Math.floor((Date.now() - new Date(fechaFactura(o) + 'T12:00:00')) / 86400000));
            return `<div class="cb-row"><span style="min-width:96px"><b class="inv-num">${esc(o.invoice_num || '')}</b></span>
              <span class="cb-muted" style="flex:1">${fechaCorta(fechaFactura(o))} · hace ${dias} día${dias !== 1 ? 's' : ''} · total ${fm(o.total, mon(o))} · abonado ${fm(ci.abonado, mon(o))}</span>
              <b style="color:#ff9a4d">${fm(ci.saldo, mon(o))}</b>
              <button class="btn btn-sm btn-gold" data-ab="${esc(o.id)}">💳 Abonar</button>
              <button class="btn btn-sm btn-outline" data-open="${esc(o.id)}" title="Abrir la factura">✏️</button></div>`; }).join('')}</div>`;
      }).join('');
      const L = $('cxLista');
      L.querySelectorAll('[data-ab]').forEach(b => b.onclick = () => abrirAbonos(b.dataset.ab));
      L.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { cerrarTodas(); loadForEdit(b.dataset.open); });
      L.querySelectorAll('[data-ficha]').forEach(b => b.onclick = () => abrirFicha(b.dataset.ficha));
      L.querySelectorAll('[data-rec]').forEach(b => b.onclick = () => { const x = clientes().find(y => y.clave === b.dataset.rec); if(x) abrirChat(x.phone, textoRecordatorio(x)); });
    };
    $('cxBuscar').oninput = e => { q = e.target.value; pintar(); };
    M.alRefrescar(pintar);
    pintar();
  }

  function refrescarTodo(){
    try{
      renderList(); updateKPIs();
      const im = $('invoicesModal'); if(im && im.style.display !== 'none') renderModal();
      pintarCobroForm();
    }catch(e){ console.warn('[Cobros] refrescar:', e.message); }
    refrescadores.forEach(f => { try{ f(); }catch(e){ console.warn('[Cobros] ventana:', e.message); } });
  }

  async function iniciar(){
    await Promise.all([cargarPagos(), cargarTasas()]);
    refrescarTodo();
    tasaOnline(false);
    setInterval(() => tasaOnline(false), 3600000);
  }

  Object.assign(window, { cargarPagos, cargarTasas, tasaVigente, convertir, equivalenteTexto, pintarEquivForm, cambiarPais, abrirTasa, tasaOnline,
    infoCobro, saldoDe, cobroImpresion, cobroBadge, sumaSaldos, pintarKpiCobros, pintarCobroForm, abrirAbonos, abrirAbonosForm,
    abrirFicha, abrirFichaDesdeForm, abrirClientes, abrirNuevoCliente, abrirCiudades, abrirCourier, abrirCuentasPorCobrar, sincronizarEstadoCobro, pmCobrosIniciar: iniciar,
    pmCobrosTasaActual: () => TASAS.slice() });
})();
