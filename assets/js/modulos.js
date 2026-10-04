/* ════════════════════════════════════════════════════════════
   CONTRIX — Módulos (1/2): datos compartidos, Panel, CFDIs,
   Crear CFDI, Pagos PPD y Materialidad
   ════════════════════════════════════════════════════════════ */
(function () {
  const { $, $$, esc, dinero, fecha, ico, r2 } = U;
  const M = window.MODULOS = {};

  /* ── Datos compartidos ───────────────────────────────────── */
  const CAMPOS_CFDI = 'id,uuid_sat,serie,folio,tipo,fecha_emision,emisor_rfc,emisor_nombre,receptor_rfc,receptor_nombre,subtotal,descuento,iva_trasladado,iva_retenido,isr_retenido,total,moneda,tipo_cambio,forma_pago,metodo_pago,estado,origen,errores,xml_url,poliza_id,version,receptor_uso_cfdi';
  const mxn = (c, campo) => (Number(c[campo]) || 0) * (c.moneda && c.moneda !== 'MXN' && c.moneda !== 'XXX' ? (Number(c.tipo_cambio) || 1) : 1);
  const contraparte = (c) => c.origen === 'emitido' ? { rfc: c.receptor_rfc, nombre: c.receptor_nombre } : { rfc: c.emisor_rfc, nombre: c.emisor_nombre };
  const numErrores = (c) => (c.errores || []).filter((e) => e.nivel === 'error').length;

  const D = window.DATOS = {
    mxn, contraparte, numErrores, CAMPOS_CFDI,

    async cfdis(desde, hasta, extra) {
      return U.todo(() => {
        let q = C.sb.from('cfdis').select(CAMPOS_CFDI).eq('empresa_id', C.empresa.id).neq('estado', 'borrador');
        if (desde) q = q.gte('fecha_emision', desde);
        if (hasta) q = q.lt('fecha_emision', hasta);
        if (extra) q = extra(q);
        return q.order('fecha_emision', { ascending: false });
      });
    },

    /* IVA con base en flujo de efectivo (PUE + complementos de pago) */
    calcIVA(lista) {
      const r = { trasCobrado: 0, retClientes: 0, acredPagado: 0, retTerceros: 0, trasNoCobrado: 0, acredNoPagado: 0, detalle: [] };
      lista.filter((c) => c.estado === 'vigente').forEach((c) => {
        const iva = mxn(c, 'iva_trasladado'), ret = mxn(c, 'iva_retenido');
        const signo = c.tipo === 'E' ? -1 : 1;
        let cuenta = null;
        if ((c.tipo === 'I' || c.tipo === 'E') && c.metodo_pago !== 'PPD') cuenta = 'flujo';
        else if (c.tipo === 'P') cuenta = 'flujo';
        else if (c.tipo === 'I' && c.metodo_pago === 'PPD') cuenta = 'diferido';
        if (!cuenta) return;
        if (c.origen === 'emitido') {
          if (cuenta === 'flujo') { r.trasCobrado += signo * iva; r.retClientes += signo * ret; } else r.trasNoCobrado += iva;
        } else {
          if (cuenta === 'flujo') { r.acredPagado += signo * iva; r.retTerceros += signo * ret; } else r.acredNoPagado += iva;
        }
        if (cuenta === 'flujo' && (iva || ret)) r.detalle.push(c);
      });
      r.resultado = r2(r.trasCobrado - r.retClientes - r.acredPagado);
      return r;
    },

    async pendientesPPD(hasta) {
      const ppd = await U.todo(() => {
        let q = C.sb.from('cfdis').select(CAMPOS_CFDI).eq('empresa_id', C.empresa.id).eq('tipo', 'I').eq('metodo_pago', 'PPD').eq('estado', 'vigente');
        if (hasta) q = q.lt('fecha_emision', hasta);
        return q.order('fecha_emision');
      });
      if (!ppd.length) return [];
      const doctos = await U.todo(() => C.sb.from('cfdi_pagos_doctos').select('uuid_relacionado,imp_pagado,imp_saldo_insoluto,num_parcialidad,fecha_pago,cfdi_pago_id').eq('empresa_id', C.empresa.id));
      const porUuid = {};
      doctos.forEach((d) => { (porUuid[d.uuid_relacionado.toUpperCase()] ||= []).push(d); });
      const hoy = Date.now();
      return ppd.map((c) => {
        const ps = porUuid[c.uuid_sat.toUpperCase()] || [];
        const pagado = ps.reduce((s, p) => s + Number(p.imp_pagado || 0), 0);
        const ultimo = ps.sort((a, b) => (b.num_parcialidad || 0) - (a.num_parcialidad || 0))[0];
        const saldo = ultimo ? Number(ultimo.imp_saldo_insoluto) : Number(c.total);
        return { ...c, pagado: r2(pagado), saldo: r2(Math.max(0, saldo)), parcialidades: ps.length, dias: Math.floor((hoy - new Date(c.fecha_emision)) / 864e5) };
      }).filter((c) => c.saldo > 0.01);
    },

    async cuentas() {
      return U.todo(() => C.sb.from('catalogo_cuentas').select('*').eq('empresa_id', C.empresa.id).order('numero'));
    },

    async efosCruce(rfcs) {
      const unicos = [...new Set(rfcs.filter(Boolean).map((r) => r.toUpperCase()))];
      let res = [];
      for (let i = 0; i < unicos.length; i += 150) {
        const { data, error } = await C.sb.from('efos_blacklist').select('*').in('rfc', unicos.slice(i, i + 150));
        if (error) throw error;
        res = res.concat(data || []);
      }
      return res;
    }
  };

  const chipEstado = (c) => {
    if (c.estado === 'cancelado') return '<span class="chip error">Cancelado</span>';
    if (c.estado === 'borrador') return '<span class="chip gris">Borrador</span>';
    const n = numErrores(c);
    if (n) return `<span class="chip error">${n} error${n > 1 ? 'es' : ''}</span>`;
    if ((c.errores || []).some((e) => e.nivel === 'aviso')) return '<span class="chip aviso">Con avisos</span>';
    return '<span class="chip ok">Vigente</span>';
  };
  const chipTipo = (c) => `<span class="chip ${c.origen === 'emitido' ? '' : 'gris'}">${esc(SAT.tipoComprobante[c.tipo] || c.tipo)} · ${c.origen === 'emitido' ? 'Emitido' : 'Recibido'}</span>`;
  D.chipEstado = chipEstado;

  /* ════════════════════════ PANEL ════════════════════════ */
  M.inicio = async (el) => {
    const { desde, hasta, etiqueta } = U.rango();
    const lista = await D.cfdis(desde, hasta);
    const vig = lista.filter((c) => c.estado === 'vigente');
    const sumar = (arr, f) => arr.reduce((s, c) => s + f(c), 0);
    const base = (c) => mxn(c, 'subtotal') - mxn(c, 'descuento');
    const ingresos = sumar(vig.filter((c) => c.origen === 'emitido' && c.tipo === 'I'), base) - sumar(vig.filter((c) => c.origen === 'emitido' && c.tipo === 'E'), base);
    const gastos = sumar(vig.filter((c) => c.origen === 'recibido' && c.tipo === 'I'), base) - sumar(vig.filter((c) => c.origen === 'recibido' && c.tipo === 'E'), base);
    const iva = D.calcIVA(lista);
    const conError = lista.filter((c) => numErrores(c));
    const cancelados = lista.filter((c) => c.estado === 'cancelado');
    const ppd = await D.pendientesPPD();
    const ppdEmit = ppd.filter((c) => c.origen === 'emitido'), ppdRec = ppd.filter((c) => c.origen === 'recibido');
    const { count: totalCfdi } = await C.sb.from('cfdis').select('id', { count: 'exact', head: true }).eq('empresa_id', C.empresa.id);
    const { count: totalCuentas } = await C.sb.from('catalogo_cuentas').select('id', { count: 'exact', head: true }).eq('empresa_id', C.empresa.id);
    const { count: totalPolizas } = await C.sb.from('polizas').select('id', { count: 'exact', head: true }).eq('empresa_id', C.empresa.id);
    const marca = (n) => { const s = document.querySelector(`[data-cuenta="pagos"]`); if (s) { s.textContent = n; s.classList.toggle('oculto', !n); s.classList.add('alerta'); } };
    marca(ppd.length);

    const guia = (totalCfdi || 0) === 0 || !totalPolizas;
    const paso = (hecho, href, t, s) => `<a class="check ${hecho ? 'hecho' : ''}" href="${href}"><span class="c">${hecho ? ico('check') : ''}</span><div><b>${t}</b><small>${s}</small></div></a>`;

    el.innerHTML = `
      ${guia ? `<div class="tarjeta" style="margin-bottom:18px"><div class="tarjeta-cab"><div><h3>Primeros pasos</h3><p>Completa estos pasos para aprovechar Contrix.</p></div></div>
        <div class="checklist">
          ${paso(true, '#/app/config', 'Empresa registrada', esc(C.empresa.razon_social) + ' · ' + esc(C.empresa.rfc))}
          ${paso((totalCuentas || 0) > 0, '#/app/catalogo', 'Catálogo de cuentas', totalCuentas ? totalCuentas + ' cuentas' : 'Carga el catálogo base o importa el tuyo desde Excel')}
          ${paso((totalCfdi || 0) > 0, '#/app/cfdis?cargar=1', 'Sube tus XML', totalCfdi ? totalCfdi + ' CFDIs cargados' : 'Arrastra tus facturas emitidas y recibidas (XML o .zip)')}
          ${paso((totalPolizas || 0) > 0, '#/app/polizas', 'Registra tu primera póliza', 'Manual o generada desde un CFDI')}
        </div></div>` : ''}
      <div class="kpis">
        <div class="kpi dest"><div class="et">${ico('trend')}Ingresos facturados</div><div class="val">${dinero(ingresos)}</div><div class="det">${etiqueta} · sin IVA, netos de notas de crédito</div></div>
        <div class="kpi"><div class="et">${ico('file')}Gastos recibidos</div><div class="val">${dinero(gastos)}</div><div class="det">${vig.filter((c) => c.origen === 'recibido').length} CFDIs recibidos vigentes</div></div>
        <div class="kpi"><div class="et">${ico('percent')}IVA preliminar</div><div class="val" style="color:${iva.resultado > 0 ? 'var(--error)' : 'var(--ok)'}">${dinero(Math.abs(iva.resultado))}</div><div class="det">${iva.resultado > 0 ? 'A cargo' : iva.resultado < 0 ? 'A favor' : 'Sin saldo'} · <a href="#/app/iva" style="color:var(--azul)">ver cálculo</a></div></div>
        <div class="kpi"><div class="et">${ico('alert')}Por atender</div><div class="val">${conError.length + ppd.length}</div><div class="det">${conError.length} con errores · ${ppd.length} PPD pendientes</div></div>
      </div>
      <div class="dos-col">
        <div class="tarjeta"><div class="tarjeta-cab"><div><h3>Ingresos vs. gastos</h3><p>Últimos 12 meses (sin IVA)</p></div></div><div style="height:280px"><canvas id="g-12m"></canvas></div></div>
        <div class="tarjeta"><div class="tarjeta-cab"><div><h3>Alertas</h3><p>${etiqueta}</p></div></div>
          <div class="checklist">
            ${alerta(conError.length, ['CFDI con errores', 'CFDIs con errores'], 'Revisa qué no cuadra en cada factura', '#/app/cfdis?filtro=errores', 'alert')}
            ${alerta(ppdEmit.length, ['Complemento por emitir', 'Complementos por emitir'], 'Facturas PPD tuyas con saldo pendiente', '#/app/pagos', 'clock')}
            ${alerta(ppdRec.length, ['Complemento por recibir', 'Complementos por recibir'], 'Facturas PPD de proveedores con saldo', '#/app/pagos?tab=recibir', 'clock')}
            ${alerta(cancelados.length, ['CFDI cancelado', 'CFDIs cancelados'], 'Marcados como cancelados en el periodo', '#/app/cfdis?filtro=cancelados', 'x')}
            <a class="check" href="#/app/efos"><span class="c" style="border-color:var(--azul);color:var(--azul)">${ico('shield')}</span><div><b>Revisión 69-B</b><small>Cruza tus clientes y proveedores con la lista del SAT</small></div></a>
          </div>
        </div>
      </div>
      <div class="dos-col">
        <div class="tarjeta"><div class="tarjeta-cab"><div><h3>CFDIs recientes</h3><p>${etiqueta}</p></div><a class="btn btn-sec btn-c" href="#/app/cfdis">Ver todos</a></div>
          ${lista.length ? `<div class="tabla-env"><table class="t"><thead><tr><th>Fecha</th><th>Contraparte</th><th>Tipo</th><th class="num">Total</th><th>Estado</th></tr></thead><tbody>
            ${lista.slice(0, 7).map((c) => `<tr class="clic" data-id="${c.id}"><td>${fecha(c.fecha_emision)}</td><td><b>${esc(contraparte(c).nombre || contraparte(c).rfc)}</b><div class="peq mono">${esc(contraparte(c).rfc)}</div></td><td>${chipTipo(c)}</td><td class="num">${dinero(c.total, c.moneda)}</td><td>${chipEstado(c)}</td></tr>`).join('')}
            </tbody></table></div>` : U.vacio('file', 'Sin CFDIs en ' + etiqueta, 'Sube tus XML para ver aquí tu actividad.', `<a class="btn btn-pri" href="#/app/cfdis?cargar=1">${ico('upload')}Subir XML</a>`)}
        </div>
        <div class="tarjeta"><div class="tarjeta-cab"><div><h3>Principales contrapartes</h3><p>Por monto facturado en el periodo</p></div></div>${topContrapartes(vig)}</div>
      </div>`;

    el.querySelectorAll('tr[data-id]').forEach((tr) => tr.onclick = () => M.detalleCfdi(tr.dataset.id));

    // Gráfica de 12 meses
    const fin = new Date(C.periodo.anio, (C.periodo.mes || 12), 1);
    const ini = new Date(fin.getFullYear(), fin.getMonth() - 12, 1);
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    const hist = await D.cfdis(iso(ini), iso(fin), (q) => q.in('tipo', ['I', 'E']).eq('estado', 'vigente'));
    const etiquetas = [], ing = [], gas = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(ini.getFullYear(), ini.getMonth() + i, 1); const k = iso(d).slice(0, 7);
      etiquetas.push(U.MESES[d.getMonth()].slice(0, 3) + ' ' + String(d.getFullYear()).slice(2));
      const delMes = hist.filter((c) => c.fecha_emision.slice(0, 7) === k);
      const s = (o) => delMes.filter((c) => c.origen === o).reduce((t, c) => t + (c.tipo === 'E' ? -1 : 1) * base(c), 0);
      ing.push(r2(s('emitido'))); gas.push(r2(s('recibido')));
    }
    if (window.Chart) {
      C.graficas.push(new Chart($('#g-12m'), {
        type: 'bar',
        data: { labels: etiquetas, datasets: [{ label: 'Ingresos', data: ing, backgroundColor: '#1A3A8F', borderRadius: 6 }, { label: 'Gastos', data: gas, backgroundColor: '#7CC8F8', borderRadius: 6 }] },
        options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } }, tooltip: { callbacks: { label: (x) => x.dataset.label + ': ' + dinero(x.raw) } } }, scales: { y: { ticks: { callback: (v) => '$' + Intl.NumberFormat('es-MX', { notation: 'compact' }).format(v) }, grid: { color: '#EEF2FA' } }, x: { grid: { display: false } } } }
      }));
    }
  };

  function alerta(n, t, s, href, icono) {
    return `<a class="check" href="${href}"><span class="c" style="${n ? 'background:var(--error-bg);border-color:#FCA5A5;color:var(--error)' : 'background:var(--ok-bg);border-color:#A7F3D0;color:var(--ok)'}">${n ? ico(icono) : ico('check')}</span><div><b>${n} ${n === 1 ? t[0] : t[1]}</b><small>${s}</small></div></a>`;
  }

  function topContrapartes(vig) {
    const mapa = {};
    vig.filter((c) => c.tipo === 'I').forEach((c) => {
      const k = c.origen + '|' + contraparte(c).rfc;
      mapa[k] ||= { ...contraparte(c), origen: c.origen, monto: 0, n: 0 };
      mapa[k].monto += mxn(c, 'total'); mapa[k].n++;
    });
    const top = Object.values(mapa).sort((a, b) => b.monto - a.monto).slice(0, 6);
    if (!top.length) return U.vacio('users', 'Sin datos', 'Aparecerán cuando cargues CFDIs del periodo.');
    const max = top[0].monto || 1;
    return top.map((t) => `<div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;font-size:13.5px;gap:10px"><span><b>${esc(t.nombre || t.rfc)}</b> <span class="peq">${t.origen === 'emitido' ? 'Cliente' : 'Proveedor'} · ${t.n} CFDI</span></span><b>${dinero(t.monto)}</b></div><div class="progreso"><div style="width:${(t.monto / max) * 100}%"></div></div></div>`).join('');
  }

  /* ════════════════════════ CFDIs ════════════════════════ */
  M.cfdis = async (el, params) => {
    const { desde, hasta, etiqueta } = U.rango();
    let lista = await D.cfdis(desde, hasta);
    let filtro = { origen: 'todos', tipo: '', estado: params.get('filtro') || '', q: '' };
    let pagina = 0; const POR_PAG = 50;

    el.innerHTML = `
      <div class="herr">
        <div class="pestanas" id="t-origen"><button data-v="todos" class="activa">Todos</button><button data-v="emitido">Emitidos</button><button data-v="recibido">Recibidos</button></div>
        <select class="inp c" id="f-tipo" style="width:auto"><option value="">Todos los tipos</option>${Object.entries(SAT.tipoComprobante).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
        <select class="inp c" id="f-estado" style="width:auto"><option value="">Todos los estados</option><option value="vigente">Vigentes</option><option value="errores">Con errores</option><option value="cancelados">Cancelados</option></select>
        <input class="inp c" id="f-q" placeholder="Buscar RFC, nombre, UUID o folio" style="width:260px">
        <div class="der">
          <button class="btn btn-sec btn-c" id="b-exp">${ico('excel')}Exportar</button>
          <button class="btn btn-pri btn-c" id="b-cargar">${ico('upload')}Subir XML</button>
        </div>
      </div>
      <div id="resumen-cfdi" class="peq" style="margin-bottom:10px"></div>
      <div id="tabla-cfdi"></div>`;
    $('#f-estado').value = filtro.estado;

    const filtrados = () => lista.filter((c) => {
      if (filtro.origen !== 'todos' && c.origen !== filtro.origen) return false;
      if (filtro.tipo && c.tipo !== filtro.tipo) return false;
      if (filtro.estado === 'vigente' && c.estado !== 'vigente') return false;
      if (filtro.estado === 'cancelados' && c.estado !== 'cancelado') return false;
      if (filtro.estado === 'errores' && !numErrores(c)) return false;
      if (filtro.q) {
        const t = filtro.q.toUpperCase();
        return [c.emisor_rfc, c.receptor_rfc, c.emisor_nombre, c.receptor_nombre, c.uuid_sat, c.folio, c.serie, [c.serie, c.folio].filter(Boolean).join('-')].some((v) => String(v || '').toUpperCase().includes(t));
      }
      return true;
    });

    const pintar = () => {
      const f = filtrados();
      const tot = f.filter((c) => c.estado === 'vigente').reduce((s, c) => s + mxn(c, 'total'), 0);
      $('#resumen-cfdi').innerHTML = `${f.length} de ${lista.length} CFDIs · ${etiqueta} · Total vigente ${dinero(tot)}`;
      if (!f.length) {
        $('#tabla-cfdi').innerHTML = `<div class="tarjeta">${U.vacio('file', lista.length ? 'Sin resultados con estos filtros' : 'Aún no hay CFDIs en ' + etiqueta, lista.length ? 'Cambia los filtros o la búsqueda.' : 'Sube tus XML emitidos y recibidos. También puedes cambiar el periodo arriba.', lista.length ? '' : `<button class="btn btn-pri" onclick="MODULOS.cargarXML()">${ico('upload')}Subir XML</button>`)}</div>`;
        return;
      }
      const pags = Math.ceil(f.length / POR_PAG); pagina = Math.min(pagina, pags - 1);
      const vis = f.slice(pagina * POR_PAG, (pagina + 1) * POR_PAG);
      $('#tabla-cfdi').innerHTML = `<div class="tabla-env"><table class="t"><thead><tr><th>Fecha</th><th>Tipo</th><th>Serie / folio</th><th>Contraparte</th><th>Método</th><th class="num">Subtotal</th><th class="num">IVA</th><th class="num">Total</th><th>Estado</th></tr></thead><tbody>
        ${vis.map((c) => `<tr class="clic" data-id="${c.id}"><td>${fecha(c.fecha_emision)}</td><td>${chipTipo(c)}</td><td class="mono">${esc([c.serie, c.folio].filter(Boolean).join('-') || '—')}</td>
          <td><b>${esc(contraparte(c).nombre || '—')}</b><div class="peq mono">${esc(contraparte(c).rfc)}</div></td><td>${esc(c.metodo_pago || '—')}</td>
          <td class="num">${dinero(c.subtotal, c.moneda)}</td><td class="num">${dinero(c.iva_trasladado, c.moneda)}</td><td class="num"><b>${dinero(c.total, c.moneda)}</b></td><td>${chipEstado(c)}</td></tr>`).join('')}
        </tbody></table></div>
        ${pags > 1 ? `<div class="herr" style="margin-top:12px;justify-content:flex-end"><button class="btn btn-sec btn-c" id="p-ant" ${pagina ? '' : 'disabled'}>Anterior</button><span class="peq">Página ${pagina + 1} de ${pags}</span><button class="btn btn-sec btn-c" id="p-sig" ${pagina < pags - 1 ? '' : 'disabled'}>Siguiente</button></div>` : ''}`;
      $$('#tabla-cfdi tr[data-id]').forEach((tr) => tr.onclick = () => M.detalleCfdi(tr.dataset.id));
      if ($('#p-ant')) { $('#p-ant').onclick = () => { pagina--; pintar(); }; $('#p-sig').onclick = () => { pagina++; pintar(); }; }
    };

    $$('#t-origen button').forEach((b) => b.onclick = () => { $$('#t-origen button').forEach((x) => x.classList.remove('activa')); b.classList.add('activa'); filtro.origen = b.dataset.v; pagina = 0; pintar(); });
    $('#f-tipo').onchange = (e) => { filtro.tipo = e.target.value; pagina = 0; pintar(); };
    $('#f-estado').onchange = (e) => { filtro.estado = e.target.value; pagina = 0; pintar(); };
    $('#f-q').oninput = (e) => { filtro.q = e.target.value.trim(); pagina = 0; pintar(); };
    $('#b-cargar').onclick = () => M.cargarXML();
    $('#b-exp').onclick = () => U.excel(`CFDIs ${C.empresa.rfc} ${etiqueta}`, [{ nombre: 'CFDIs', filas: filtrados().map(filaExcel) }]);
    pintar();
    if (params.get('cargar')) M.cargarXML();
  };

  const filaExcel = (c) => ({
    UUID: c.uuid_sat, Fecha: c.fecha_emision?.slice(0, 10), Origen: c.origen, Tipo: SAT.tipoComprobante[c.tipo] || c.tipo, Serie: c.serie || '', Folio: c.folio || '',
    'RFC emisor': c.emisor_rfc, Emisor: c.emisor_nombre || '', 'RFC receptor': c.receptor_rfc, Receptor: c.receptor_nombre || '', 'Uso CFDI': c.receptor_uso_cfdi || '',
    'Método de pago': c.metodo_pago || '', 'Forma de pago': c.forma_pago || '', Moneda: c.moneda, 'Tipo de cambio': Number(c.tipo_cambio),
    Subtotal: Number(c.subtotal), Descuento: Number(c.descuento), 'IVA trasladado': Number(c.iva_trasladado), 'IVA retenido': Number(c.iva_retenido), 'ISR retenido': Number(c.isr_retenido), Total: Number(c.total),
    Estado: c.estado, Errores: (c.errores || []).filter((e) => e.nivel === 'error').map((e) => e.msg).join(' | ')
  });
  D.filaExcel = filaExcel;

  /* ── Carga de XML / ZIP ──────────────────────────────────── */
  M.cargarXML = () => {
    const m = U.modal({
      titulo: 'Subir CFDI', ancho: false,
      cuerpo: `<label class="carga" id="z-carga"><input type="file" multiple accept=".xml,.zip,text/xml,application/zip" hidden>
          ${ico('upload')}<h4>Arrastra tus XML o un .zip</h4><p>Emitidos y recibidos de <b>${esc(C.empresa.rfc)}</b>. Puedes subir el .zip de la descarga masiva del SAT.</p></label>
        <div id="carga-estado" style="margin-top:14px"></div>`,
      pie: '<button class="btn btn-sec" data-cerrar>Cerrar</button>'
    });
    U.zonaCarga($('#z-carga', m), procesarArchivos);
  };

  async function extraerXMLs(archivos) {
    const xmls = [];
    for (const f of archivos) {
      if (/\.zip$/i.test(f.name)) {
        if (!window.JSZip) throw new Error('No se pudo cargar el lector de .zip');
        const zip = await JSZip.loadAsync(f);
        for (const nombre of Object.keys(zip.files)) {
          if (/\.xml$/i.test(nombre) && !zip.files[nombre].dir) xmls.push({ nombre, texto: await zip.files[nombre].async('string') });
        }
      } else if (/\.xml$/i.test(f.name) || f.type.includes('xml')) xmls.push({ nombre: f.name, texto: await f.text() });
    }
    return xmls;
  }

  async function procesarArchivos(archivos) {
    const est = $('#carga-estado');
    const plan = U.planActual();
    est.innerHTML = '<p class="peq">Leyendo archivos…</p><div class="progreso"><div id="barra"></div></div>';
    let xmls;
    try { xmls = await extraerXMLs(archivos); } catch (e) { est.innerHTML = `<div class="msg ver error">${esc(e.message)}</div>`; return; }
    if (!xmls.length) { est.innerHTML = '<div class="msg ver error">No se encontraron archivos XML.</div>'; return; }

    // Límite mensual de CFDIs del plan
    let restantes = Infinity;
    if (plan.limites.cfdis) {
      const ini = new Date(); const iniMes = `${ini.getFullYear()}-${String(ini.getMonth() + 1).padStart(2, '0')}-01`;
      const { count } = await C.sb.from('cfdis').select('id', { count: 'exact', head: true }).eq('empresa_id', C.empresa.id).gte('created_at', iniMes);
      restantes = Math.max(0, plan.limites.cfdis - (count || 0));
    }

    const leidos = [], fallas = [], ajenos = [];
    const rfcE = C.empresa.rfc.toUpperCase();
    xmls.forEach((x) => {
      try {
        const d = CFDI.leer(x.texto);
        if (!d.uuid_sat) { fallas.push({ nombre: x.nombre, motivo: 'Sin timbre (UUID)' }); return; }
        if (d.emisor_rfc !== rfcE && d.receptor_rfc !== rfcE) { ajenos.push({ nombre: x.nombre, motivo: `No es de ${rfcE}` }); return; }
        d.origen = d.emisor_rfc === rfcE ? 'emitido' : 'recibido';
        leidos.push({ d, texto: x.texto, nombre: x.nombre });
      } catch (e) { fallas.push({ nombre: x.nombre, motivo: e.message }); }
    });

    // Duplicados ya cargados
    const uuids = leidos.map((l) => l.d.uuid_sat);
    const existentes = new Set();
    for (let i = 0; i < uuids.length; i += 200) {
      const { data } = await C.sb.from('cfdis').select('uuid_sat').eq('empresa_id', C.empresa.id).in('uuid_sat', uuids.slice(i, i + 200));
      (data || []).forEach((r) => existentes.add(r.uuid_sat.toUpperCase()));
    }
    const vistos = new Set();
    const nuevos = leidos.filter((l) => { const u = l.d.uuid_sat; if (existentes.has(u) || vistos.has(u)) return false; vistos.add(u); return true; });
    const duplicados = leidos.length - nuevos.length;
    const aImportar = nuevos.slice(0, restantes === Infinity ? undefined : restantes);
    const excedidos = nuevos.length - aImportar.length;

    // Cruce 69-B de las contrapartes
    let efos = [];
    try { efos = await D.efosCruce(aImportar.map((l) => l.d.origen === 'emitido' ? l.d.receptor_rfc : l.d.emisor_rfc)); } catch (e) { /* lista no disponible */ }
    const efosPor = Object.fromEntries(efos.map((e) => [e.rfc, e]));

    let ok = 0; const errores = [];
    for (let i = 0; i < aImportar.length; i++) {
      const { d, texto, nombre } = aImportar[i];
      $('#barra') && ($('#barra').style.width = ((i + 1) / aImportar.length * 100) + '%');
      try {
        const contra = d.origen === 'emitido' ? d.receptor_rfc : d.emisor_rfc;
        const vals = CFDI.validar(d, { rfcEmpresa: rfcE, efos: efosPor[contra] ? [efosPor[contra]] : [] }).filter((v) => v.nivel !== 'ok');
        const ruta = `${C.empresa.id}/cfdi/${d.uuid_sat}.xml`;
        const subida = await C.sb.storage.from('uploads').upload(ruta, new Blob([texto], { type: 'application/xml' }), { upsert: true, contentType: 'application/xml' });
        const fila = {
          empresa_id: C.empresa.id, uuid_sat: d.uuid_sat, serie: d.serie, folio: d.folio, tipo: d.tipo,
          fecha_emision: d.fecha_emision, fecha_timbrado: d.fecha_timbrado, emisor_rfc: d.emisor_rfc, emisor_nombre: d.emisor_nombre, emisor_regimen: d.emisor_regimen,
          receptor_rfc: d.receptor_rfc, receptor_nombre: d.receptor_nombre, receptor_uso_cfdi: d.receptor_uso_cfdi, receptor_cp: d.receptor_cp,
          subtotal: d.subtotal, descuento: d.descuento, iva_trasladado: d.iva_trasladado, iva_retenido: d.iva_retenido, isr_retenido: d.isr_retenido,
          total: d.total, moneda: d.moneda, tipo_cambio: d.tipo_cambio, forma_pago: d.forma_pago, metodo_pago: d.metodo_pago, condiciones_pago: d.condiciones_pago,
          lugar_expedicion: d.lugar_expedicion, pac: d.pac, origen: d.origen, estado: 'vigente', version: d.version, exportacion: d.exportacion,
          errores: vals, xml_url: subida.error ? null : ruta, sello_ultimos8: d.sello8 || null
        };
        const { data: ins, error } = await C.sb.from('cfdis').insert(fila).select('id').single();
        if (error) throw error;
        if (d.conceptos.length) {
          await C.sb.from('cfdi_conceptos').insert(d.conceptos.slice(0, 500).map((c) => ({
            cfdi_id: ins.id, clave_prod_serv: c.clave_prod_serv, no_identificacion: c.no_identificacion, cantidad: c.cantidad, clave_unidad: c.clave_unidad,
            unidad: c.unidad, descripcion: c.descripcion, valor_unitario: c.valor_unitario, importe: c.importe, descuento: c.descuento, objeto_imp: c.objeto_imp, orden: c.orden
          })));
        }
        if (d.pagos.length) {
          await C.sb.from('cfdi_pagos_doctos').insert(d.pagos.map((p) => ({ empresa_id: C.empresa.id, cfdi_pago_id: ins.id, ...p, fecha_pago: p.fecha_pago || null })));
        }
        ok++;
      } catch (e) { errores.push({ nombre, motivo: U.errorMsg(e) }); }
    }
    U.registrar('cfdi.importar', 'cfdis', null, { importados: ok, duplicados, ajenos: ajenos.length });

    const lst = (arr) => arr.slice(0, 8).map((x) => `<li><span class="mono">${esc(x.nombre)}</span> — ${esc(x.motivo)}</li>`).join('') + (arr.length > 8 ? `<li>y ${arr.length - 8} más…</li>` : '');
    est.innerHTML = `
      <div class="msg ver ${ok ? 'ok' : 'info'}"><b>${ok}</b> CFDI importado${ok === 1 ? '' : 's'} de ${xmls.length} archivo${xmls.length === 1 ? '' : 's'}.</div>
      ${duplicados ? `<p class="peq">• ${duplicados} ya estaban cargados (se omitieron).</p>` : ''}
      ${excedidos ? `<div class="msg ver error">Tu plan ${plan.nombre} permite ${plan.limites.cfdis} CFDIs al mes; ${excedidos} no se importaron. <a href="#/app/plan">Cambiar de plan</a></div>` : ''}
      ${ajenos.length ? `<p class="peq" style="margin-top:6px">• ${ajenos.length} no pertenecen a la empresa activa:</p><ul class="peq" style="margin-left:18px">${lst(ajenos)}</ul>` : ''}
      ${fallas.length ? `<p class="peq" style="margin-top:6px">• ${fallas.length} no se pudieron leer:</p><ul class="peq" style="margin-left:18px">${lst(fallas)}</ul>` : ''}
      ${errores.length ? `<p class="peq" style="margin-top:6px;color:var(--error)">• ${errores.length} con error al guardar:</p><ul class="peq" style="margin-left:18px">${lst(errores)}</ul>` : ''}`;
    if (ok && ['cfdis', 'inicio', 'sat', 'pagos', 'iva'].includes(C.modulo)) {
      const pie = $('#modal .modal-pie');
      if (pie) pie.innerHTML = `<button class="btn btn-pri" id="ver-import">Listo</button>`;
      $('#ver-import') && ($('#ver-import').onclick = () => { U.cerrarModal(); U.renderModulo(); });
    }
  }
  M.procesarArchivos = procesarArchivos;

  /* ── Detalle de CFDI ─────────────────────────────────────── */
  M.detalleCfdi = async (id) => {
    const { data: c, error } = await C.sb.from('cfdis').select('*').eq('id', id).single();
    if (error) return U.aviso(U.errorMsg(error), 'error');
    const [{ data: conc }, { data: docs }, { data: soportes }] = await Promise.all([
      C.sb.from('cfdi_conceptos').select('*').eq('cfdi_id', id).order('orden'),
      c.tipo === 'P' ? C.sb.from('cfdi_pagos_doctos').select('*').eq('cfdi_pago_id', id)
        : C.sb.from('cfdi_pagos_doctos').select('*, cfdis!cfdi_pago_id(uuid_sat,fecha_emision)').eq('empresa_id', C.empresa.id).eq('uuid_relacionado', c.uuid_sat.toUpperCase()),
      C.sb.from('uploads').select('id').eq('cfdi_id', id)
    ]);
        const vals = c.errores || [];
    const urlSat = c.estado !== 'borrador' ? CFDI.urlVerificacion({ ...c, sello8: c.sello_ultimos8 }) : null;

    const m = U.modal({
      titulo: `${esc(SAT.tipoComprobante[c.tipo] || c.tipo)} ${esc([c.serie, c.folio].filter(Boolean).join('-'))}`, ancho: true,
      cuerpo: `
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">${chipTipo(c)} ${chipEstado(c)} ${c.version ? `<span class="chip gris">CFDI ${esc(c.version)}</span>` : ''} ${c.poliza_id ? '<span class="chip ok">Con póliza</span>' : ''} <span class="chip gris">${(soportes || []).length} soporte(s) de materialidad</span></div>
        <div class="rejilla r2">
          <dl class="dl">
            <dt>UUID</dt><dd class="mono">${esc(c.uuid_sat)}</dd>
            <dt>Fecha</dt><dd>${fecha(c.fecha_emision)}</dd>
            <dt>Emisor</dt><dd>${esc(c.emisor_nombre || '')}<div class="mono peq">${esc(c.emisor_rfc)} · Rég. ${esc(c.emisor_regimen || '—')}</div></dd>
            <dt>Receptor</dt><dd>${esc(c.receptor_nombre || '')}<div class="mono peq">${esc(c.receptor_rfc)} · CP ${esc(c.receptor_cp || '—')}</div></dd>
            <dt>Uso CFDI</dt><dd>${esc(c.receptor_uso_cfdi || '—')} ${SAT.usoCfdi[c.receptor_uso_cfdi] ? '· ' + esc(SAT.usoCfdi[c.receptor_uso_cfdi]) : ''}</dd>
          </dl>
          <dl class="dl">
            <dt>Método / forma</dt><dd>${esc(c.metodo_pago || '—')} · ${esc(c.forma_pago || '—')} ${SAT.formaPago[c.forma_pago] ? '(' + esc(SAT.formaPago[c.forma_pago]) + ')' : ''}</dd>
            <dt>Subtotal</dt><dd>${dinero(c.subtotal, c.moneda)}${Number(c.descuento) ? ' · Desc. ' + dinero(c.descuento, c.moneda) : ''}</dd>
            <dt>IVA trasladado</dt><dd>${dinero(c.iva_trasladado, c.moneda)}</dd>
            <dt>Retenciones</dt><dd>IVA ${dinero(c.iva_retenido, c.moneda)} · ISR ${dinero(c.isr_retenido, c.moneda)}</dd>
            <dt>Total</dt><dd style="font-size:18px">${dinero(c.total, c.moneda)} ${c.moneda !== 'MXN' ? `<span class="peq">TC ${esc(c.tipo_cambio)}</span>` : ''}</dd>
          </dl>
        </div>
        <h4 style="margin:20px 0 10px">Validación</h4>
        <div class="val-lista">${vals.length ? vals.map((v) => `<div class="val-item ${v.nivel}">${ico(v.nivel === 'error' ? 'x' : 'alert')}<span>${esc(v.msg)}</span></div>`).join('') : `<div class="val-item ok">${ico('check')}<span>Sin errores ni avisos en la revisión automática.</span></div>`}</div>
        ${(conc || []).length ? `<h4 style="margin:20px 0 10px">Conceptos</h4><div class="tabla-env"><table class="t"><thead><tr><th>Clave</th><th>Descripción</th><th class="num">Cant.</th><th class="num">V. unitario</th><th class="num">Importe</th></tr></thead><tbody>
          ${conc.map((x) => `<tr><td class="mono">${esc(x.clave_prod_serv || '')}</td><td>${esc(x.descripcion)}</td><td class="num">${U.num(x.cantidad, 2)}</td><td class="num">${dinero(x.valor_unitario, c.moneda)}</td><td class="num">${dinero(x.importe, c.moneda)}</td></tr>`).join('')}</tbody></table></div>` : ''}
        ${(docs || []).length ? `<h4 style="margin:20px 0 10px">${c.tipo === 'P' ? 'Documentos pagados' : 'Complementos de pago recibidos'}</h4><div class="tabla-env"><table class="t"><thead><tr><th>${c.tipo === 'P' ? 'UUID relacionado' : 'Complemento'}</th><th>Parcialidad</th><th class="num">Saldo anterior</th><th class="num">Pagado</th><th class="num">Saldo insoluto</th></tr></thead><tbody>
          ${docs.map((x) => `<tr><td class="mono">${esc(c.tipo === 'P' ? x.uuid_relacionado : (x.cfdis?.uuid_sat || ''))}</td><td>${x.num_parcialidad || '—'}</td><td class="num">${dinero(x.imp_saldo_ant)}</td><td class="num">${dinero(x.imp_pagado)}</td><td class="num">${dinero(x.imp_saldo_insoluto)}</td></tr>`).join('')}</tbody></table></div>` : (c.metodo_pago === 'PPD' ? '<div class="banner aviso" style="margin-top:16px">' + ico('clock') + '<span>Factura PPD sin complementos de pago cargados.</span></div>' : '')}`,
      pie: `
        <button class="btn btn-peligro" id="d-eliminar" style="margin-right:auto">${ico('trash')}Eliminar</button>
        ${c.xml_url ? `<button class="btn btn-sec" id="d-xml">${ico('download')}XML</button>` : ''}
        ${urlSat ? `<a class="btn btn-sec" href="${esc(urlSat)}" target="_blank" rel="noopener">${ico('search')}Verificar en SAT</a>` : ''}
        ${c.estado !== 'borrador' ? `<button class="btn btn-sec" id="d-estado">${c.estado === 'cancelado' ? 'Marcar vigente' : 'Marcar cancelado'}</button>` : ''}
        <a class="btn btn-sec" href="#/app/materialidad?cfdi=${c.id}">${ico('paperclip')}Materialidad</a>
        ${c.estado === 'vigente' && ['I', 'E'].includes(c.tipo) && !c.poliza_id ? `<a class="btn btn-pri" href="#/app/polizas?cfdi=${c.id}">${ico('book')}Generar póliza</a>` : ''}`
    });
    m.querySelectorAll('a[href^="#/app"]').forEach((a) => a.addEventListener('click', U.cerrarModal));
    if ($('#d-xml')) $('#d-xml').onclick = async () => {
      const { data, error: e } = await C.sb.storage.from('uploads').download(c.xml_url);
      if (e) return U.aviso(U.errorMsg(e), 'error');
      U.descargar(c.uuid_sat + '.xml', await data.text());
    };
    if ($('#d-estado')) $('#d-estado').onclick = async () => {
      const nuevo = c.estado === 'cancelado' ? 'vigente' : 'cancelado';
      if (nuevo === 'cancelado' && !(await U.confirmar('¿Marcar este CFDI como cancelado? Hazlo después de verificarlo en el portal del SAT.', 'Marcar cancelado'))) return;
      const { error: e } = await C.sb.from('cfdis').update({ estado: nuevo, fecha_cancelacion: nuevo === 'cancelado' ? new Date().toISOString() : null }).eq('id', c.id);
      if (e) return U.aviso(U.errorMsg(e), 'error');
      U.registrar('cfdi.estado', 'cfdis', c.id, { estado: nuevo });
      U.aviso('Estado actualizado', 'ok'); U.cerrarModal(); U.renderModulo();
    };
    $('#d-eliminar').onclick = async () => {
      if (!(await U.confirmar('¿Eliminar este CFDI de Contrix? No afecta al SAT.', 'Eliminar'))) return;
      if (c.xml_url) await C.sb.storage.from('uploads').remove([c.xml_url]);
      const { error: e } = await C.sb.from('cfdis').delete().eq('id', c.id);
      if (e) return U.aviso(U.errorMsg(e), 'error');
      U.registrar('cfdi.eliminar', 'cfdis', c.id, { uuid: c.uuid_sat });
      U.aviso('CFDI eliminado', 'ok'); U.renderModulo();
    };
  };

  /* ════════════════════════ CREAR CFDI ════════════════════════ */
  M.emitir = async (el) => {
    const e = C.empresa;
    const opts = (obj, sel) => Object.entries(obj).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${k} — ${esc(v)}</option>`).join('');
    const { data: borradores } = await C.sb.from('cfdis').select('id,serie,folio,fecha_emision,receptor_rfc,receptor_nombre,total').eq('empresa_id', e.id).eq('estado', 'borrador').order('created_at', { ascending: false }).limit(20);
    el.innerHTML = `
      <div class="banner info">${ico('info')}<span>Captura tu factura y descarga el XML 4.0 como <b>borrador</b>. Para que sea un CFDI válido debe sellarse con tu CSD y timbrarse con un PAC autorizado (aún no conectado).</span></div>
      <div class="tarjeta" style="margin-bottom:18px">
        <div class="tarjeta-cab"><h3>Datos generales</h3><span class="peq">Emisor: <b>${esc(e.razon_social)}</b> · ${esc(e.rfc)} · Régimen ${esc(e.regimen_fiscal || '—')} · CP ${esc(e.codigo_postal || '—')}</span></div>
        <div class="rejilla r4">
          <div class="campo"><label>Serie</label><input class="inp" id="e-serie" maxlength="25"></div>
          <div class="campo"><label>Folio</label><input class="inp" id="e-folio" maxlength="40"></div>
          <div class="campo"><label>Método de pago</label><select class="inp" id="e-metodo">${opts(SAT.metodoPago, 'PUE')}</select></div>
          <div class="campo"><label>Forma de pago</label><select class="inp" id="e-forma">${opts(SAT.formaPago, '03')}</select></div>
        </div>
        <h4 style="margin:6px 0 12px;font-size:14px;color:var(--rey-900)">Receptor</h4>
        <div class="rejilla r3">
          <div class="campo"><label>RFC</label><input class="inp" id="e-rrfc" maxlength="13" style="text-transform:uppercase"></div>
          <div class="campo" style="grid-column:span 2"><label>Nombre o razón social (como en su constancia)</label><input class="inp" id="e-rnombre" style="text-transform:uppercase"></div>
          <div class="campo"><label>Código postal</label><input class="inp" id="e-rcp" maxlength="5"></div>
          <div class="campo"><label>Régimen fiscal</label><select class="inp" id="e-rreg">${opts(SAT.regimen, '601')}</select></div>
          <div class="campo"><label>Uso del CFDI</label><select class="inp" id="e-uso">${opts(SAT.usoCfdi, 'G03')}</select></div>
        </div>
      </div>
      <div class="tarjeta" style="margin-bottom:18px">
        <div class="tarjeta-cab"><h3>Conceptos</h3><button class="btn btn-sec btn-c" id="e-add">${ico('plus')}Agregar concepto</button></div>
        <div class="tabla-env"><table class="t lineas-poliza"><thead><tr><th>Clave prod/serv</th><th>Descripción</th><th>Unidad</th><th class="num">Cantidad</th><th class="num">Valor unitario</th><th>Impuesto</th><th class="num">Importe</th><th></th></tr></thead><tbody id="e-lineas"></tbody></table></div>
        <div class="cuadre" id="e-tot"></div>
      </div>
      <div class="herr" style="justify-content:flex-end">
        <button class="btn btn-sec" id="e-xml">${ico('download')}Descargar XML borrador</button>
        <button class="btn btn-sec" disabled title="Requiere conectar un PAC">${ico('lock')}Timbrar (requiere PAC)</button>
        <button class="btn btn-pri" id="e-guardar">${ico('check')}Guardar borrador</button>
      </div>
      <div class="tarjeta" style="margin-top:18px"><div class="tarjeta-cab"><h3>Borradores guardados</h3></div>
        ${(borradores || []).length ? `<div class="tabla-env"><table class="t"><thead><tr><th>Fecha</th><th>Serie/folio</th><th>Receptor</th><th class="num">Total</th><th></th></tr></thead><tbody>
          ${borradores.map((b) => `<tr><td>${fecha(b.fecha_emision)}</td><td class="mono">${esc([b.serie, b.folio].filter(Boolean).join('-') || '—')}</td><td>${esc(b.receptor_nombre || '')}<div class="peq mono">${esc(b.receptor_rfc)}</div></td><td class="num">${dinero(b.total)}</td><td class="num"><button class="btn btn-fant btn-c" data-borrar="${b.id}">${ico('trash')}</button></td></tr>`).join('')}</tbody></table></div>`
        : U.vacio('plus-file', 'Sin borradores', 'Los borradores que guardes aparecerán aquí.')}</div>`;

    const IMP = [['0.16', 'IVA 16%'], ['0.08', 'IVA 8% (frontera)'], ['0', 'IVA 0%'], ['exento', 'Exento'], ['no', 'No objeto de impuesto']];
    const linea = () => `<tr><td><input class="inp c" data-k="clave" value="01010101" maxlength="8" style="width:100px"></td><td><input class="inp c" data-k="desc" style="min-width:200px"></td>
      <td><select class="inp c" data-k="unidad">${Object.entries(SAT.claveUnidad).map(([k, v]) => `<option value="${k}">${k} ${v}</option>`).join('')}</select></td>
      <td><input class="inp c num" data-k="cant" type="number" min="0" step="any" value="1" style="width:80px"></td><td><input class="inp c num" data-k="vu" type="number" min="0" step="0.01" value="0" style="width:120px"></td>
      <td><select class="inp c" data-k="imp">${IMP.map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></td><td class="num" data-k="importe">$0.00</td><td><button class="btn btn-fant btn-c" data-quitar>${ico('x')}</button></td></tr>`;
    const tb = $('#e-lineas');
    const leerLineas = () => $$('tr', tb).map((tr) => {
      const g = (k) => tr.querySelector(`[data-k="${k}"]`).value;
      const cantidad = parseFloat(g('cant')) || 0, vu = parseFloat(g('vu')) || 0, imp = g('imp');
      return { clave_prod_serv: g('clave').trim(), descripcion: g('desc').trim(), clave_unidad: g('unidad'), cantidad, valor_unitario: vu, importe: r2(cantidad * vu), objeto_imp: imp === 'no' ? '01' : '02', iva: imp === 'no' ? null : imp };
    });
    const totales = () => {
      const ls = leerLineas();
      let sub = 0, iva = 0;
      ls.forEach((l, i) => { sub += l.importe; if (l.iva && l.iva !== 'exento') iva += l.importe * parseFloat(l.iva); $$('tr', tb)[i].querySelector('[data-k="importe"]').textContent = dinero(l.importe); });
      $('#e-tot').innerHTML = `<span>Subtotal <b>${dinero(sub)}</b></span><span>IVA <b>${dinero(r2(iva))}</b></span><span>Total <b style="font-size:18px">${dinero(r2(sub + r2(iva)))}</b></span>`;
      return { ls, sub: r2(sub), iva: r2(iva), total: r2(sub + r2(iva)) };
    };
    const agregar = () => { tb.insertAdjacentHTML('beforeend', linea()); totales(); };
    tb.addEventListener('input', totales); tb.addEventListener('change', totales);
    tb.addEventListener('click', (ev) => { const b = ev.target.closest('[data-quitar]'); if (b && $$('tr', tb).length > 1) { b.closest('tr').remove(); totales(); } });
    $('#e-add').onclick = agregar; agregar();
    $('#e-metodo').onchange = () => { if ($('#e-metodo').value === 'PPD') $('#e-forma').value = '99'; else if ($('#e-forma').value === '99') $('#e-forma').value = '03'; };

    const armar = () => {
      const t = totales();
      const f = {
        serie: $('#e-serie').value.trim() || null, folio: $('#e-folio').value.trim() || null,
        fecha: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 19),
        forma_pago: $('#e-forma').value, metodo_pago: $('#e-metodo').value, lugar_expedicion: e.codigo_postal,
        emisor_rfc: e.rfc, emisor_nombre: e.razon_social, emisor_regimen: e.regimen_fiscal,
        receptor_rfc: $('#e-rrfc').value.trim().toUpperCase(), receptor_nombre: $('#e-rnombre').value.trim().toUpperCase(),
        receptor_cp: $('#e-rcp').value.trim(), receptor_regimen: $('#e-rreg').value, receptor_uso_cfdi: $('#e-uso').value,
        conceptos: t.ls, subtotal: t.sub, total: t.total, iva: t.iva
      };
      const errs = [];
      if (!CFDI.RFC_RE.test(f.receptor_rfc)) errs.push('RFC del receptor inválido');
      if (!f.receptor_nombre) errs.push('Falta el nombre del receptor');
      if (!/^\d{5}$/.test(f.receptor_cp)) errs.push('CP del receptor debe tener 5 dígitos');
      if (!/^\d{5}$/.test(e.codigo_postal || '')) errs.push('Tu empresa no tiene CP registrado (Configuración)');
      if (f.metodo_pago === 'PPD' && f.forma_pago !== '99') errs.push('Con PPD la forma de pago debe ser 99');
      if (f.metodo_pago === 'PUE' && f.forma_pago === '99') errs.push('Con PUE la forma de pago no puede ser 99');
      if (t.ls.some((l) => !/^\d{8}$/.test(l.clave_prod_serv))) errs.push('Cada clave de producto/servicio debe tener 8 dígitos');
      if (t.ls.some((l) => !l.descripcion)) errs.push('Cada concepto necesita descripción');
      if (t.ls.some((l) => l.importe <= 0)) errs.push('Cada concepto debe tener importe mayor a cero');
      if (errs.length) { U.aviso(errs.join(' · '), 'error'); return null; }
      return f;
    };
    $('#e-xml').onclick = () => { const f = armar(); if (f) U.descargar(`BORRADOR_${f.serie || ''}${f.folio || Date.now()}.xml`, CFDI.generarXML40(f)); };
    $('#e-guardar').onclick = async () => {
      const f = armar(); if (!f) return;
      const b = $('#e-guardar'); b.classList.add('cargando');
      const { data, error } = await C.sb.from('cfdis').insert({
        empresa_id: e.id, uuid_sat: 'BORRADOR-' + crypto.randomUUID(), serie: f.serie, folio: f.folio, tipo: 'I', fecha_emision: f.fecha,
        emisor_rfc: f.emisor_rfc, emisor_nombre: f.emisor_nombre, emisor_regimen: f.emisor_regimen, receptor_rfc: f.receptor_rfc, receptor_nombre: f.receptor_nombre,
        receptor_uso_cfdi: f.receptor_uso_cfdi, receptor_cp: f.receptor_cp, subtotal: f.subtotal, iva_trasladado: f.iva, total: f.total, moneda: 'MXN',
        forma_pago: f.forma_pago, metodo_pago: f.metodo_pago, lugar_expedicion: f.lugar_expedicion, origen: 'emitido', estado: 'borrador', version: '4.0', exportacion: '01'
      }).select('id').single();
      if (!error) await C.sb.from('cfdi_conceptos').insert(f.conceptos.map((c, i) => ({ cfdi_id: data.id, clave_prod_serv: c.clave_prod_serv, cantidad: c.cantidad, clave_unidad: c.clave_unidad, unidad: SAT.claveUnidad[c.clave_unidad], descripcion: c.descripcion, valor_unitario: c.valor_unitario, importe: c.importe, objeto_imp: c.objeto_imp, orden: i })));
      b.classList.remove('cargando');
      if (error) return U.aviso(U.errorMsg(error), 'error');
      U.aviso('Borrador guardado', 'ok'); U.renderModulo();
    };
    $$('[data-borrar]').forEach((b) => b.onclick = async () => {
      if (!(await U.confirmar('¿Eliminar este borrador?', 'Eliminar'))) return;
      await C.sb.from('cfdis').delete().eq('id', b.dataset.borrar); U.renderModulo();
    });
  };

  /* ════════════════════════ PAGOS PPD ════════════════════════ */
  M.pagos = async (el, params) => {
    const lista = await D.pendientesPPD();
    let tab = params.get('tab') === 'recibir' ? 'recibido' : 'emitido';
    el.innerHTML = `
      <div class="banner info">${ico('info')}<span>Facturas con método <b>PPD</b> vigentes cuyo saldo no está cubierto por complementos de pago cargados en Contrix. Sube tus complementos (tipo P) para que se descuenten.</span></div>
      <div class="herr"><div class="pestanas" id="t-ppd"><button data-v="emitido">Por emitir (tus clientes)</button><button data-v="recibido">Por recibir (tus proveedores)</button></div>
        <div class="der"><button class="btn btn-sec btn-c" id="ppd-exp">${ico('excel')}Exportar</button></div></div>
      <div class="kpis" id="ppd-kpis" style="grid-template-columns:repeat(3,1fr)"></div>
      <div id="ppd-tabla"></div>`;
    const pintar = () => {
      $$('#t-ppd button').forEach((b) => b.classList.toggle('activa', b.dataset.v === tab));
      const f = lista.filter((c) => c.origen === tab);
      const saldo = f.reduce((s, c) => s + c.saldo, 0), viejos = f.filter((c) => c.dias > 30).length;
      $('#ppd-kpis').innerHTML = `<div class="kpi dest"><div class="et">Facturas pendientes</div><div class="val">${f.length}</div><div class="det">${tab === 'emitido' ? 'Debes emitir complemento al cobrar' : 'Tu proveedor debe emitirte complemento'}</div></div>
        <div class="kpi"><div class="et">Saldo pendiente</div><div class="val">${dinero(saldo)}</div><div class="det">Según el último saldo insoluto</div></div>
        <div class="kpi"><div class="et">Con más de 30 días</div><div class="val">${viejos}</div><div class="det">Desde la fecha de emisión</div></div>`;
      $('#ppd-tabla').innerHTML = f.length ? `<div class="tabla-env"><table class="t"><thead><tr><th>Fecha</th><th>Serie/folio</th><th>${tab === 'emitido' ? 'Cliente' : 'Proveedor'}</th><th class="num">Total</th><th class="num">Pagado</th><th class="num">Saldo</th><th>Parcialidades</th><th>Antigüedad</th></tr></thead><tbody>
        ${f.map((c) => `<tr class="clic" data-id="${c.id}"><td>${fecha(c.fecha_emision)}</td><td class="mono">${esc([c.serie, c.folio].filter(Boolean).join('-') || '—')}</td><td><b>${esc(contraparte(c).nombre || '')}</b><div class="peq mono">${esc(contraparte(c).rfc)}</div></td><td class="num">${dinero(c.total, c.moneda)}</td><td class="num">${dinero(c.pagado, c.moneda)}</td><td class="num"><b>${dinero(c.saldo, c.moneda)}</b></td><td>${c.parcialidades}</td><td><span class="chip ${c.dias > 30 ? 'error' : c.dias > 15 ? 'aviso' : 'gris'}">${c.dias} días</span></td></tr>`).join('')}
        </tbody></table></div>` : `<div class="tarjeta">${U.vacio('check', 'Sin pendientes', tab === 'emitido' ? 'No tienes facturas PPD emitidas con saldo.' : 'No tienes facturas PPD recibidas con saldo.')}</div>`;
      $$('#ppd-tabla tr[data-id]').forEach((tr) => tr.onclick = () => M.detalleCfdi(tr.dataset.id));
    };
    $$('#t-ppd button').forEach((b) => b.onclick = () => { tab = b.dataset.v; pintar(); });
    $('#ppd-exp').onclick = () => U.excel(`PPD pendientes ${C.empresa.rfc}`, [
      { nombre: 'Por emitir', filas: lista.filter((c) => c.origen === 'emitido').map((c) => ({ ...filaExcel(c), Pagado: c.pagado, Saldo: c.saldo, Parcialidades: c.parcialidades, 'Días': c.dias })) },
      { nombre: 'Por recibir', filas: lista.filter((c) => c.origen === 'recibido').map((c) => ({ ...filaExcel(c), Pagado: c.pagado, Saldo: c.saldo, Parcialidades: c.parcialidades, 'Días': c.dias })) }]);
    pintar();
  };

  /* ════════════════════════ MATERIALIDAD ════════════════════════ */
  const TIPOS_SOPORTE = ['Contrato', 'Orden de compra / cotización', 'Entregable o evidencia del servicio', 'Comprobante de pago', 'Fotografía', 'Correspondencia', 'Otro'];
  M.materialidad = async (el, params) => {
    const { desde, hasta, etiqueta } = U.rango();
    const lista = (await D.cfdis(desde, hasta, (q) => q.in('tipo', ['I', 'E']).eq('estado', 'vigente')));
    const ids = lista.map((c) => c.id);
    let soportes = [];
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await C.sb.from('uploads').select('id,cfdi_id,filename,storage_path,notas,created_at,size_bytes').eq('empresa_id', C.empresa.id).eq('categoria', 'soporte_materialidad').in('cfdi_id', ids.slice(i, i + 200));
      soportes = soportes.concat(data || []);
    }
    const porCfdi = {}; soportes.forEach((s) => (porCfdi[s.cfdi_id] ||= []).push(s));
    let filtro = 'sin';
    el.innerHTML = `
      <div class="banner info">${ico('info')}<span>Adjunta a cada operación la evidencia de que realmente ocurrió (contratos, entregables, pagos). Los archivos se guardan en tu almacenamiento privado.</span></div>
      <div class="kpis" style="grid-template-columns:repeat(3,1fr)">
        <div class="kpi dest"><div class="et">CFDIs del periodo</div><div class="val">${lista.length}</div><div class="det">${etiqueta}</div></div>
        <div class="kpi"><div class="et">Con soporte</div><div class="val" style="color:var(--ok)">${lista.filter((c) => porCfdi[c.id]).length}</div><div class="det">Al menos un archivo</div></div>
        <div class="kpi"><div class="et">Sin soporte</div><div class="val" style="color:var(--error)">${lista.filter((c) => !porCfdi[c.id]).length}</div><div class="det">Pendientes de documentar</div></div>
      </div>
      <div class="herr"><div class="pestanas" id="t-mat"><button data-v="sin" class="activa">Sin soporte</button><button data-v="con">Con soporte</button><button data-v="todos">Todos</button></div></div>
      <div id="mat-tabla"></div>`;
    const pintar = () => {
      const f = lista.filter((c) => filtro === 'todos' || (filtro === 'con' ? porCfdi[c.id] : !porCfdi[c.id]));
      $('#mat-tabla').innerHTML = f.length ? `<div class="tabla-env"><table class="t"><thead><tr><th>Fecha</th><th>Tipo</th><th>Contraparte</th><th class="num">Total</th><th>Soportes</th><th></th></tr></thead><tbody>
        ${f.map((c) => `<tr><td>${fecha(c.fecha_emision)}</td><td>${chipTipo(c)}</td><td><b>${esc(contraparte(c).nombre || '')}</b><div class="peq mono">${esc(contraparte(c).rfc)}</div></td><td class="num">${dinero(c.total, c.moneda)}</td><td>${porCfdi[c.id] ? `<span class="chip ok">${porCfdi[c.id].length} archivo(s)</span>` : '<span class="chip gris">Ninguno</span>'}</td><td class="num"><button class="btn btn-sec btn-c" data-adj="${c.id}">${ico('paperclip')}Adjuntar</button></td></tr>`).join('')}
        </tbody></table></div>` : `<div class="tarjeta">${U.vacio('paperclip', 'Nada por aquí', lista.length ? 'Cambia el filtro.' : 'No hay CFDIs vigentes en ' + etiqueta + '.')}</div>`;
      $$('[data-adj]').forEach((b) => b.onclick = () => abrirSoportes(lista.find((c) => c.id === b.dataset.adj), porCfdi[b.dataset.adj] || []));
    };
    $$('#t-mat button').forEach((b) => b.onclick = () => { $$('#t-mat button').forEach((x) => x.classList.remove('activa')); b.classList.add('activa'); filtro = b.dataset.v; pintar(); });
    pintar();
    const pedido = params.get('cfdi');
    if (pedido) {
      let c = lista.find((x) => x.id === pedido);
      if (!c) { const r = await C.sb.from('cfdis').select(CAMPOS_CFDI).eq('id', pedido).single(); c = r.data; }
      if (c) { const { data } = await C.sb.from('uploads').select('*').eq('cfdi_id', c.id).eq('categoria', 'soporte_materialidad'); abrirSoportes(c, data || []); }
    }
  };

  function abrirSoportes(c, actuales) {
    const m = U.modal({
      titulo: 'Materialidad de la operación',
      cuerpo: `<p class="peq" style="margin-bottom:12px">${esc(SAT.tipoComprobante[c.tipo])} · ${esc(contraparte(c).nombre || contraparte(c).rfc)} · ${dinero(c.total, c.moneda)} · ${fecha(c.fecha_emision)}</p>
        ${actuales.length ? `<div class="tabla-env" style="margin-bottom:14px"><table class="t"><tbody>${actuales.map((s) => `<tr><td>${ico('paperclip')} ${esc(s.filename)}<div class="peq">${esc(s.notas || '')}</div></td><td class="num"><button class="btn btn-fant btn-c" data-ver="${esc(s.storage_path)}">Ver</button><button class="btn btn-fant btn-c" data-quitar="${s.id}" data-ruta="${esc(s.storage_path)}">${ico('trash')}</button></td></tr>`).join('')}</tbody></table></div>` : ''}
        <div class="rejilla r2"><div class="campo"><label>Tipo de evidencia</label><select class="inp" id="s-tipo">${TIPOS_SOPORTE.map((t) => `<option>${t}</option>`).join('')}</select></div><div class="campo"><label>Nota (opcional)</label><input class="inp" id="s-nota"></div></div>
        <label class="carga" id="s-zona"><input type="file" multiple hidden>${ico('upload')}<h4>Arrastra o elige archivos</h4><p>PDF, imágenes, documentos. Máx. 20 MB por archivo.</p></label>
        <div id="s-estado"></div>`,
      pie: '<button class="btn btn-sec" data-cerrar>Cerrar</button>'
    });
    U.zonaCarga($('#s-zona', m), async (files) => {
      let ok = 0;
      for (const f of files) {
        if (f.size > 20 * 1024 * 1024) { U.aviso(f.name + ' supera 20 MB', 'error'); continue; }
        const limpio = f.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.\-]+/g, '_');
        const ruta = `${C.empresa.id}/materialidad/${c.id}/${Date.now()}_${limpio}`;
        const up = await C.sb.storage.from('uploads').upload(ruta, f, { contentType: f.type || 'application/octet-stream' });
        if (up.error) { U.aviso(U.errorMsg(up.error), 'error'); continue; }
        const { error } = await C.sb.from('uploads').insert({ empresa_id: C.empresa.id, user_id: C.usuario.id, storage_path: ruta, filename: f.name, mime_type: f.type, size_bytes: f.size, categoria: 'soporte_materialidad', cfdi_id: c.id, notas: [$('#s-tipo').value, $('#s-nota').value.trim()].filter(Boolean).join(' · ') });
        if (error) U.aviso(U.errorMsg(error), 'error'); else ok++;
      }
      if (ok) { U.aviso(ok + ' archivo(s) adjuntado(s)', 'ok'); U.cerrarModal(); history.replaceState(null, '', '#/app/materialidad'); C.params = new URLSearchParams(); U.renderModulo(); }
    });
    $$('[data-ver]', m).forEach((b) => b.onclick = async () => {
      const { data, error } = await C.sb.storage.from('uploads').createSignedUrl(b.dataset.ver, 120);
      if (error) return U.aviso(U.errorMsg(error), 'error');
      window.open(data.signedUrl, '_blank', 'noopener');
    });
    $$('[data-quitar]', m).forEach((b) => b.onclick = async () => {
      if (!(await U.confirmar('¿Quitar este archivo?', 'Quitar'))) return;
      await C.sb.storage.from('uploads').remove([b.dataset.ruta]);
      await C.sb.from('uploads').delete().eq('id', b.dataset.quitar);
      U.aviso('Archivo eliminado', 'ok'); U.renderModulo();
    });
  }
})();
