/* ════════════════════════════════════════════════════════════
   CONTRIX — Módulos (2/2): Pólizas, Catálogo, Reportes, IVA,
   EFOS, Conciliación SAT, Sincronización SAT, Portal Contador,
   COI, Noticias, Plan y pagos, Configuración
   ════════════════════════════════════════════════════════════ */
(function () {
  const { $, $$, esc, dinero, fecha, ico, r2 } = U;
  const M = window.MODULOS, D = window.DATOS;
  const cant = (v, uno, varios, ilim) => /^ilimitad/i.test(v) ? ilim : `${v} ${v === '1' ? uno : varios}`;
  const TIPOS_POL = { I: 'Ingreso', E: 'Egreso', D: 'Diario', T: 'Traslado' };
  const planPermite = (...ids) => ids.includes(U.planActual().id);
  const bloqueoPlan = (que) => `<div class="bloqueo">${ico('lock')}<h3>${que} está incluido en Empresarial y Corporativo</h3><p>Tu plan actual es ${U.planActual().nombre}. Cambia de plan para habilitarlo.</p><a class="btn btn-pri btn-g" href="#/app/plan">Ver planes</a></div>`;

  /* ════════════════════════ PÓLIZAS ════════════════════════ */
  M.polizas = async (el, params) => {
    const { desde, hasta, etiqueta } = U.rango();
    const polizas = await U.todo(() => C.sb.from('polizas').select('*').eq('empresa_id', C.empresa.id).gte('fecha', desde).lt('fecha', hasta).order('fecha', { ascending: false }).order('numero', { ascending: false }));
    const cuentas = await D.cuentas();
    el.innerHTML = `
      <div class="herr">
        <span class="peq">${polizas.length} póliza(s) · ${etiqueta}</span>
        <div class="der">
          <button class="btn btn-sec btn-c" id="pol-exp">${ico('excel')}Exportar</button>
          <button class="btn btn-pri btn-c" id="pol-nueva">${ico('plus')}Nueva póliza</button>
        </div>
      </div>
      ${!cuentas.length ? `<div class="banner aviso">${ico('alert')}<span>Primero necesitas un catálogo de cuentas.</span><a class="btn btn-sec btn-c" href="#/app/catalogo">Ir al catálogo</a></div>` : ''}
      <div id="pol-tabla">${polizas.length ? `<div class="tabla-env"><table class="t"><thead><tr><th>Número</th><th>Fecha</th><th>Tipo</th><th>Concepto</th><th>Origen</th><th class="num">Cargos</th><th class="num">Abonos</th><th>Estado</th></tr></thead><tbody>
        ${polizas.map((p) => `<tr class="clic" data-id="${p.id}"><td class="mono">${esc(p.numero)}</td><td>${fecha(p.fecha)}</td><td><span class="chip">${TIPOS_POL[p.tipo]}</span></td><td>${esc(p.concepto)}</td><td><span class="chip gris">${esc(p.origen)}</span></td><td class="num">${dinero(p.total_cargos)}</td><td class="num">${dinero(p.total_abonos)}</td><td>${p.estado === 'cancelada' ? '<span class="chip error">Cancelada</span>' : '<span class="chip ok">Registrada</span>'}</td></tr>`).join('')}
        </tbody></table></div>` : `<div class="tarjeta">${U.vacio('book', 'Sin pólizas en ' + etiqueta, 'Registra una póliza manual o genérala desde un CFDI.', cuentas.length ? `<button class="btn btn-pri" id="pol-nueva2">${ico('plus')}Nueva póliza</button>` : '')}</div>`}</div>`;
    const nueva = () => cuentas.length ? editorPoliza(cuentas) : U.aviso('Primero crea tu catálogo de cuentas', 'error');
    $('#pol-nueva').onclick = nueva; if ($('#pol-nueva2')) $('#pol-nueva2').onclick = nueva;
    $$('#pol-tabla tr[data-id]').forEach((tr) => tr.onclick = () => verPoliza(tr.dataset.id, cuentas));
    $('#pol-exp').onclick = async () => {
      const ids = polizas.map((p) => p.id);
      let as = [];
      for (let i = 0; i < ids.length; i += 200) { const { data } = await C.sb.from('asientos').select('*').in('poliza_id', ids.slice(i, i + 200)); as = as.concat(data || []); }
      const cta = Object.fromEntries(cuentas.map((c) => [c.id, c]));
      const pol = Object.fromEntries(polizas.map((p) => [p.id, p]));
      U.excel(`Pólizas ${C.empresa.rfc} ${etiqueta}`, [
        { nombre: 'Pólizas', filas: polizas.map((p) => ({ Número: p.numero, Fecha: p.fecha, Tipo: TIPOS_POL[p.tipo], Concepto: p.concepto, Origen: p.origen, Cargos: Number(p.total_cargos), Abonos: Number(p.total_abonos), Estado: p.estado })) },
        { nombre: 'Movimientos', filas: as.sort((a, b) => (pol[a.poliza_id].numero + a.orden).localeCompare(pol[b.poliza_id].numero + b.orden)).map((a) => ({ Póliza: pol[a.poliza_id].numero, Fecha: pol[a.poliza_id].fecha, Cuenta: cta[a.cuenta_id]?.numero, 'Código SAT': cta[a.cuenta_id]?.codigo_sat || '', Descripción: cta[a.cuenta_id]?.descripcion, Concepto: a.concepto || '', Cargo: Number(a.cargo), Abono: Number(a.abono), Referencia: a.referencia || '' })) }
      ]);
    };
    if (params.get('cfdi') && cuentas.length) {
      const { data: c } = await C.sb.from('cfdis').select('*').eq('id', params.get('cfdi')).single();
      if (c) editorPoliza(cuentas, sugerirDesdeCfdi(c, cuentas), c);
    }
  };

  // Sugerencia de asientos desde un CFDI (el usuario la revisa antes de guardar)
  function sugerirDesdeCfdi(c, cuentas) {
    const porSat = (cod) => cuentas.find((x) => x.codigo_sat === cod && x.activa !== false)?.id || '';
    const tc = c.moneda && c.moneda !== 'MXN' ? Number(c.tipo_cambio) || 1 : 1;
    const base = r2((Number(c.subtotal) - Number(c.descuento)) * tc), iva = r2(Number(c.iva_trasladado) * tc), total = r2(Number(c.total) * tc);
    const ivaRet = r2(Number(c.iva_retenido) * tc), isrRet = r2(Number(c.isr_retenido) * tc);
    const ppd = c.metodo_pago === 'PPD';
    const nombre = (c.origen === 'emitido' ? c.receptor_nombre : c.emisor_nombre) || '';
    const ref = (c.serie || '') + (c.folio || '') || c.uuid_sat.slice(0, 8);
    let l = [];
    if (c.origen === 'recibido') {
      l.push({ cuenta_id: porSat('601.84'), concepto: 'Gasto — ' + nombre, cargo: base, abono: 0 });
      if (iva) l.push({ cuenta_id: porSat(ppd ? '119.01' : '118.01'), concepto: ppd ? 'IVA pendiente de pago' : 'IVA acreditable pagado', cargo: iva, abono: 0 });
      if (ivaRet) l.push({ cuenta_id: porSat('216.10'), concepto: 'IVA retenido', cargo: 0, abono: ivaRet });
      if (isrRet) l.push({ cuenta_id: porSat('216.04'), concepto: 'ISR retenido', cargo: 0, abono: isrRet });
      l.push({ cuenta_id: porSat(ppd ? '201.01' : '102.01'), concepto: ppd ? 'Proveedor — ' + nombre : 'Pago — ' + nombre, cargo: 0, abono: r2(total) });
    } else {
      l.push({ cuenta_id: porSat(ppd ? '105.01' : '102.01'), concepto: ppd ? 'Cliente — ' + nombre : 'Cobro — ' + nombre, cargo: total, abono: 0 });
      if (ivaRet) l.push({ cuenta_id: '', concepto: 'IVA retenido por el cliente (elige cuenta)', cargo: ivaRet, abono: 0 });
      if (isrRet) l.push({ cuenta_id: '', concepto: 'ISR retenido por el cliente (elige cuenta)', cargo: isrRet, abono: 0 });
      l.push({ cuenta_id: porSat('401.01'), concepto: 'Venta — ' + nombre, cargo: 0, abono: base });
      if (iva) l.push({ cuenta_id: porSat(ppd ? '209.01' : '208.01'), concepto: ppd ? 'IVA trasladado no cobrado' : 'IVA trasladado cobrado', cargo: 0, abono: iva });
    }
    if (c.tipo === 'E') l = l.map((x) => ({ ...x, cargo: x.abono, abono: x.cargo }));
    return {
      tipo: c.origen === 'emitido' ? (ppd ? 'D' : 'I') : (ppd ? 'D' : 'E'),
      fecha: c.fecha_emision.slice(0, 10),
      concepto: `${SAT.tipoComprobante[c.tipo]} ${ref} ${nombre}`.trim().slice(0, 200),
      lineas: l.map((x) => ({ ...x, referencia: c.uuid_sat }))
    };
  }

  function editorPoliza(cuentas, pre = null, cfdi = null) {
    const hojas = cuentas.filter((c) => c.activa !== false);
    const opc = (sel) => '<option value="">Selecciona cuenta…</option>' + hojas.map((c) => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.numero)} · ${esc(c.descripcion)}</option>`).join('');
    const ahora = new Date(); const hoy = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(ahora.getDate()).padStart(2, '0')}`;
    const ini = pre || { tipo: 'D', fecha: hoy, concepto: '', lineas: [{ cuenta_id: '', concepto: '', cargo: 0, abono: 0 }, { cuenta_id: '', concepto: '', cargo: 0, abono: 0 }] };
    const fila = (l) => `<tr><td><select class="inp c" data-k="cuenta" style="min-width:230px">${opc(l.cuenta_id)}</select></td><td><input class="inp c" data-k="concepto" value="${esc(l.concepto || '')}"></td>
      <td><input class="inp c num" data-k="cargo" type="number" min="0" step="0.01" value="${l.cargo || ''}" style="width:120px"></td><td><input class="inp c num" data-k="abono" type="number" min="0" step="0.01" value="${l.abono || ''}" style="width:120px"></td>
      <td><input type="hidden" data-k="ref" value="${esc(l.referencia || '')}"><button class="btn btn-fant btn-c" data-quitar>${ico('x')}</button></td></tr>`;
    const m = U.modal({
      titulo: cfdi ? 'Póliza sugerida desde CFDI' : 'Nueva póliza', ancho: true,
      cuerpo: `${cfdi ? `<div class="banner info">${ico('info')}<span>Revisa las cuentas sugeridas antes de guardar. Se usaron cuentas del catálogo por código agrupador; si alguna está vacía, elígela.</span></div>` : ''}
        <div class="rejilla r3"><div class="campo"><label>Tipo</label><select class="inp" id="p-tipo">${Object.entries(TIPOS_POL).map(([k, v]) => `<option value="${k}" ${k === ini.tipo ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <div class="campo"><label>Fecha</label><input class="inp" type="date" id="p-fecha" value="${ini.fecha}"></div>
        <div class="campo"><label>Concepto</label><input class="inp" id="p-concepto" value="${esc(ini.concepto)}" maxlength="200"></div></div>
        <div class="tabla-env"><table class="t lineas-poliza"><thead><tr><th>Cuenta</th><th>Concepto del movimiento</th><th class="num">Cargo</th><th class="num">Abono</th><th></th></tr></thead><tbody id="p-lineas">${ini.lineas.map(fila).join('')}</tbody></table></div>
        <div class="herr" style="margin-top:10px"><button class="btn btn-sec btn-c" id="p-add">${ico('plus')}Agregar movimiento</button><div class="der cuadre" id="p-cuadre"></div></div>`,
      pie: `<button class="btn btn-sec" data-cerrar>Cancelar</button><button class="btn btn-pri" id="p-guardar">Guardar póliza</button>`
    });
    const tb = $('#p-lineas', m);
    const leer = () => $$('tr', tb).map((tr, i) => ({ cuenta_id: tr.querySelector('[data-k=cuenta]').value, concepto: tr.querySelector('[data-k=concepto]').value.trim(), cargo: r2(parseFloat(tr.querySelector('[data-k=cargo]').value) || 0), abono: r2(parseFloat(tr.querySelector('[data-k=abono]').value) || 0), referencia: tr.querySelector('[data-k=ref]').value || null, orden: i }));
    const cuadre = () => {
      const ls = leer(); const c = r2(ls.reduce((s, l) => s + l.cargo, 0)), a = r2(ls.reduce((s, l) => s + l.abono, 0));
      $('#p-cuadre').innerHTML = `<span>Cargos <b>${dinero(c)}</b></span><span>Abonos <b>${dinero(a)}</b></span><span class="chip ${Math.abs(c - a) < 0.005 && c > 0 ? 'ok' : 'error'}">${Math.abs(c - a) < 0.005 && c > 0 ? 'Cuadrada' : 'Diferencia ' + dinero(c - a)}</span>`;
      return { ls, c, a };
    };
    tb.addEventListener('input', cuadre); tb.addEventListener('change', cuadre);
    tb.addEventListener('click', (e) => { const b = e.target.closest('[data-quitar]'); if (b && $$('tr', tb).length > 2) { b.closest('tr').remove(); cuadre(); } });
    $('#p-add', m).onclick = () => { tb.insertAdjacentHTML('beforeend', fila({})); cuadre(); };
    cuadre();
    $('#p-guardar', m).onclick = async () => {
      const { ls, c, a } = cuadre();
      const tipo = $('#p-tipo').value, f = $('#p-fecha').value, concepto = $('#p-concepto').value.trim();
      const validas = ls.filter((l) => l.cargo || l.abono);
      if (!f || !concepto) return U.aviso('Escribe fecha y concepto', 'error');
      if (validas.length < 2) return U.aviso('La póliza necesita al menos dos movimientos', 'error');
      if (validas.some((l) => !l.cuenta_id)) return U.aviso('Todos los movimientos necesitan cuenta', 'error');
      if (validas.some((l) => l.cargo && l.abono)) return U.aviso('Un movimiento no puede tener cargo y abono a la vez', 'error');
      if (Math.abs(c - a) >= 0.005) return U.aviso('La póliza no cuadra: cargos y abonos deben ser iguales', 'error');
      const b = $('#p-guardar'); b.classList.add('cargando');
      try {
        const pref = `${tipo}-${f.slice(0, 4)}${f.slice(5, 7)}-`;
        const { count } = await C.sb.from('polizas').select('id', { count: 'exact', head: true }).eq('empresa_id', C.empresa.id).like('numero', pref + '%');
        let numero = pref + String((count || 0) + 1).padStart(4, '0');
        let ins = await C.sb.from('polizas').insert({ empresa_id: C.empresa.id, numero, tipo, fecha: f, concepto, total_cargos: c, total_abonos: a, estado: 'exitoso', origen: cfdi ? 'cfdi' : 'manual', cfdi_id: cfdi?.id || null, creada_por: C.usuario.id }).select('id').single();
        if (ins.error && /duplicate/.test(ins.error.message)) {
          numero = pref + Date.now().toString().slice(-6);
          ins = await C.sb.from('polizas').insert({ empresa_id: C.empresa.id, numero, tipo, fecha: f, concepto, total_cargos: c, total_abonos: a, estado: 'exitoso', origen: cfdi ? 'cfdi' : 'manual', cfdi_id: cfdi?.id || null, creada_por: C.usuario.id }).select('id').single();
        }
        if (ins.error) throw ins.error;
        const r = await C.sb.from('asientos').insert(validas.map((l) => ({ poliza_id: ins.data.id, cuenta_id: l.cuenta_id, cargo: l.cargo, abono: l.abono, concepto: l.concepto || null, referencia: l.referencia, orden: l.orden })));
        if (r.error) { await C.sb.from('polizas').delete().eq('id', ins.data.id); throw r.error; }
        if (cfdi) await C.sb.from('cfdis').update({ poliza_id: ins.data.id, conciliado: true }).eq('id', cfdi.id);
        U.registrar('poliza.crear', 'polizas', ins.data.id, { numero });
        U.aviso('Póliza ' + numero + ' registrada', 'ok'); U.cerrarModal();
        history.replaceState(null, '', '#/app/polizas'); C.params = new URLSearchParams(); U.renderModulo();
      } catch (e) { U.aviso(U.errorMsg(e), 'error'); }
      b.classList.remove('cargando');
    };
  }

  async function verPoliza(id, cuentas) {
    const [{ data: p }, { data: as }] = await Promise.all([C.sb.from('polizas').select('*').eq('id', id).single(), C.sb.from('asientos').select('*').eq('poliza_id', id).order('orden')]);
    const cta = Object.fromEntries(cuentas.map((c) => [c.id, c]));
    const m = U.modal({
      titulo: 'Póliza ' + esc(p.numero), ancho: true,
      cuerpo: `<dl class="dl" style="margin-bottom:16px"><dt>Tipo</dt><dd>${TIPOS_POL[p.tipo]}</dd><dt>Fecha</dt><dd>${fecha(p.fecha)}</dd><dt>Concepto</dt><dd>${esc(p.concepto)}</dd><dt>Estado</dt><dd>${p.estado === 'cancelada' ? 'Cancelada' : 'Registrada'}</dd></dl>
        <div class="tabla-env"><table class="t"><thead><tr><th>Cuenta</th><th>Concepto</th><th class="num">Cargo</th><th class="num">Abono</th></tr></thead><tbody>
        ${(as || []).map((a) => `<tr><td><span class="mono">${esc(cta[a.cuenta_id]?.numero || '')}</span> ${esc(cta[a.cuenta_id]?.descripcion || '')}</td><td>${esc(a.concepto || '')}</td><td class="num">${Number(a.cargo) ? dinero(a.cargo) : ''}</td><td class="num">${Number(a.abono) ? dinero(a.abono) : ''}</td></tr>`).join('')}
        </tbody><tfoot><tr><td colspan="2">Sumas iguales</td><td class="num">${dinero(p.total_cargos)}</td><td class="num">${dinero(p.total_abonos)}</td></tr></tfoot></table></div>`,
      pie: `${p.estado !== 'cancelada' ? `<button class="btn btn-peligro" id="pv-cancel" style="margin-right:auto">Cancelar póliza</button>` : ''}<button class="btn btn-sec" data-cerrar>Cerrar</button>`
    });
    if ($('#pv-cancel', m)) $('#pv-cancel', m).onclick = async () => {
      if (!(await U.confirmar('¿Cancelar la póliza ' + esc(p.numero) + '? Dejará de contar en la balanza.', 'Cancelar póliza'))) return;
      const { error } = await C.sb.from('polizas').update({ estado: 'cancelada' }).eq('id', id);
      if (error) return U.aviso(U.errorMsg(error), 'error');
      if (p.cfdi_id) await C.sb.from('cfdis').update({ poliza_id: null, conciliado: false }).eq('id', p.cfdi_id);
      U.registrar('poliza.cancelar', 'polizas', id, { numero: p.numero });
      U.aviso('Póliza cancelada', 'ok'); U.renderModulo();
    };
  }

  /* ════════════════════════ CATÁLOGO ════════════════════════ */
  M.catalogo = async (el) => {
    const cuentas = await D.cuentas();
    let q = '';
    el.innerHTML = `
      <div class="herr">
        <input class="inp c" id="cat-q" placeholder="Buscar número, descripción o código SAT" style="width:300px">
        <div class="der">
          <button class="btn btn-sec btn-c" id="cat-base">${ico('list')}Cargar catálogo base</button>
          <button class="btn btn-sec btn-c" id="cat-plantilla">${ico('download')}Plantilla Excel</button>
          <label class="btn btn-sec btn-c">${ico('upload')}Importar Excel<input type="file" accept=".xlsx,.xls,.csv" hidden id="cat-imp"></label>
          <button class="btn btn-sec btn-c" id="cat-exp">${ico('excel')}Exportar</button>
          <button class="btn btn-pri btn-c" id="cat-nueva">${ico('plus')}Nueva cuenta</button>
        </div>
      </div>
      <div class="banner info">${ico('info')}<span>El catálogo base usa el código agrupador del SAT (Anexo 24) como referencia. Revísalo y ajústalo a tu empresa.</span></div>
      <div id="cat-tabla"></div>`;
    const pintar = () => {
      const t = q.toUpperCase();
      const f = cuentas.filter((c) => !t || [c.numero, c.descripcion, c.codigo_sat].some((v) => String(v || '').toUpperCase().includes(t)));
      $('#cat-tabla').innerHTML = f.length ? `<div class="tabla-env"><table class="t"><thead><tr><th>Número</th><th>Descripción</th><th>Código SAT</th><th>Nivel</th><th>Naturaleza</th><th>Tipo</th><th>Estado</th></tr></thead><tbody>
        ${f.map((c) => `<tr class="clic" data-id="${c.id}"><td class="mono">${esc(c.numero)}</td><td style="padding-left:${14 + (Math.max(1, c.nivel || 1) - 1) * 18}px;${(c.nivel || 1) === 1 ? 'font-weight:750' : ''}">${esc(c.descripcion)}</td><td class="mono">${esc(c.codigo_sat || '—')}</td><td>${c.nivel || 1}</td><td>${c.naturaleza === 'A' ? 'Acreedora' : c.naturaleza === 'D' ? 'Deudora' : '—'}</td><td>${esc(c.tipo || '—')}</td><td>${c.activa === false ? '<span class="chip gris">Inactiva</span>' : '<span class="chip ok">Activa</span>'}</td></tr>`).join('')}
        </tbody></table></div>` : `<div class="tarjeta">${U.vacio('list', cuentas.length ? 'Sin resultados' : 'Tu catálogo está vacío', cuentas.length ? 'Prueba otra búsqueda.' : 'Carga el catálogo base, importa el tuyo desde Excel o crea cuentas una por una.')}</div>`;
      $$('#cat-tabla tr[data-id]').forEach((tr) => tr.onclick = () => editarCuenta(cuentas, cuentas.find((c) => c.id === tr.dataset.id)));
    };
    $('#cat-q').oninput = (e) => { q = e.target.value.trim(); pintar(); };
    $('#cat-nueva').onclick = () => editarCuenta(cuentas, null);
    $('#cat-base').onclick = async () => {
      if (!(await U.confirmar(`Se agregarán las cuentas del catálogo base que no existan (${SAT.catalogoBase.length} cuentas de referencia). Las que ya tienes con el mismo número no se modifican.`, 'Cargar'))) return;
      try { const n = await U.cargarCatalogoBase(C.empresa.id); U.aviso(n + ' cuenta(s) agregada(s)', 'ok'); U.renderModulo(); } catch (e) { U.aviso(U.errorMsg(e), 'error'); }
    };
    $('#cat-plantilla').onclick = () => U.excel('Plantilla catálogo de cuentas Contrix', [{ nombre: 'Catalogo', filas: [
      { Numero: '102-01', Descripcion: 'Bancos nacionales', CodigoSAT: '102.01', Nivel: 3, Naturaleza: 'D', Tipo: 'Activo', CuentaPadre: '102' }] }]);
    $('#cat-exp').onclick = () => {
      const porId = Object.fromEntries(cuentas.map((c) => [c.id, c.numero]));
      U.excel(`Catálogo ${C.empresa.rfc}`, [{ nombre: 'Catalogo', filas: cuentas.map((c) => ({ Numero: c.numero, Descripcion: c.descripcion, CodigoSAT: c.codigo_sat || '', Nivel: c.nivel, Naturaleza: c.naturaleza, Tipo: c.tipo || '', CuentaPadre: porId[c.cuenta_padre] || '', Activa: c.activa === false ? 'No' : 'Sí' })) }]);
    };
    $('#cat-imp').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const wb = XLSX.read(await f.arrayBuffer());
        const filas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
        const norm = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, ''), v]));
        const datos = filas.map(norm).filter((r) => String(r.numero).trim() && String(r.descripcion).trim()).map((r) => ({
          empresa_id: C.empresa.id, numero: String(r.numero).trim(), descripcion: String(r.descripcion).trim(), codigo_sat: String(r.codigosat || '').trim() || null,
          nivel: parseInt(r.nivel, 10) || 1, naturaleza: /^a/i.test(r.naturaleza) ? 'A' : 'D', tipo: String(r.tipo || '').trim() || null, _padre: String(r.cuentapadre || '').trim()
        }));
        if (!datos.length) return U.aviso('El archivo no tiene filas con columnas Numero y Descripcion', 'error');
        const { error } = await C.sb.from('catalogo_cuentas').upsert(datos.map(({ _padre, ...x }) => x), { onConflict: 'empresa_id,numero' });
        if (error) throw error;
        const todas = await D.cuentas(); const id = Object.fromEntries(todas.map((c) => [c.numero, c.id]));
        const conPadre = datos.filter((d) => d._padre && id[d._padre]).map(({ _padre, ...x }) => ({ ...x, cuenta_padre: id[_padre] }));
        if (conPadre.length) await C.sb.from('catalogo_cuentas').upsert(conPadre, { onConflict: 'empresa_id,numero' });
        U.aviso(datos.length + ' cuenta(s) importada(s)', 'ok'); U.renderModulo();
      } catch (err) { U.aviso(U.errorMsg(err), 'error'); }
      e.target.value = '';
    };
    pintar();
  };

  function editarCuenta(cuentas, c) {
    const m = U.modal({
      titulo: c ? 'Editar cuenta' : 'Nueva cuenta',
      cuerpo: `<div class="rejilla r2"><div class="campo"><label>Número</label><input class="inp" id="k-num" value="${esc(c?.numero || '')}" ${c ? 'readonly' : ''}></div>
        <div class="campo"><label>Código agrupador SAT</label><input class="inp" id="k-sat" value="${esc(c?.codigo_sat || '')}" placeholder="Ej. 102.01"></div></div>
        <div class="campo"><label>Descripción</label><input class="inp" id="k-desc" value="${esc(c?.descripcion || '')}"></div>
        <div class="rejilla r3"><div class="campo"><label>Nivel</label><input class="inp" id="k-niv" type="number" min="1" max="9" value="${c?.nivel || 1}"></div>
        <div class="campo"><label>Naturaleza</label><select class="inp" id="k-nat"><option value="D">Deudora</option><option value="A" ${c?.naturaleza === 'A' ? 'selected' : ''}>Acreedora</option></select></div>
        <div class="campo"><label>Tipo</label><select class="inp" id="k-tipo">${['Activo', 'Pasivo', 'Capital', 'Ingreso', 'Gasto'].map((t) => `<option ${c?.tipo === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div></div>
        <div class="campo"><label>Cuenta padre</label><select class="inp" id="k-padre"><option value="">(ninguna)</option>${cuentas.filter((x) => x.id !== c?.id).map((x) => `<option value="${x.id}" ${x.id === c?.cuenta_padre ? 'selected' : ''}>${esc(x.numero)} · ${esc(x.descripcion)}</option>`).join('')}</select></div>
        <label class="peq"><input type="checkbox" id="k-act" ${c?.activa === false ? '' : 'checked'}> Cuenta activa</label>`,
      pie: `${c ? '<button class="btn btn-peligro" id="k-borrar" style="margin-right:auto">Eliminar</button>' : ''}<button class="btn btn-sec" data-cerrar>Cancelar</button><button class="btn btn-pri" id="k-ok">Guardar</button>`
    });
    $('#k-ok', m).onclick = async () => {
      const d = { empresa_id: C.empresa.id, numero: $('#k-num').value.trim(), descripcion: $('#k-desc').value.trim(), codigo_sat: $('#k-sat').value.trim() || null, nivel: parseInt($('#k-niv').value, 10) || 1, naturaleza: $('#k-nat').value, tipo: $('#k-tipo').value, cuenta_padre: $('#k-padre').value || null, activa: $('#k-act').checked };
      if (!d.numero || !d.descripcion) return U.aviso('Número y descripción son obligatorios', 'error');
      const { error } = c ? await C.sb.from('catalogo_cuentas').update(d).eq('id', c.id) : await C.sb.from('catalogo_cuentas').insert(d);
      if (error) return U.aviso(/duplicate/.test(error.message) ? 'Ya existe una cuenta con ese número' : U.errorMsg(error), 'error');
      U.aviso('Cuenta guardada', 'ok'); U.cerrarModal(); U.renderModulo();
    };
    if ($('#k-borrar', m)) $('#k-borrar', m).onclick = async () => {
      const { error } = await C.sb.from('catalogo_cuentas').delete().eq('id', c.id);
      if (error) return U.aviso(/foreign key|violates/.test(error.message) ? 'La cuenta tiene movimientos o subcuentas; márcala como inactiva en lugar de eliminarla.' : U.errorMsg(error), 'error');
      U.aviso('Cuenta eliminada', 'ok'); U.cerrarModal(); U.renderModulo();
    };
  }

  /* ════════════════════════ BALANZA Y REPORTES ════════════════════════ */
  async function movimientos(hasta, desde = null) {
    return U.todo(() => {
      let q = C.sb.from('asientos').select('cuenta_id,cargo,abono,concepto,referencia,orden,polizas!inner(id,numero,fecha,tipo,concepto,empresa_id,estado)').eq('polizas.empresa_id', C.empresa.id).neq('polizas.estado', 'cancelada').lt('polizas.fecha', hasta);
      if (desde) q = q.gte('polizas.fecha', desde);
      return q;
    });
  }

  M.reportes = async (el) => {
    const { desde, hasta, etiqueta } = U.rango();
    const cuentas = await D.cuentas();
    const cta = Object.fromEntries(cuentas.map((c) => [c.id, c]));
    const movs = await movimientos(hasta);
    let tab = 'balanza';
    el.innerHTML = `<div class="herr"><div class="pestanas" id="t-rep"><button data-v="balanza" class="activa">Balanza de comprobación</button><button data-v="diario">Libro diario</button><button data-v="auxiliar">Auxiliar de cuenta</button></div><div class="der"><button class="btn btn-sec btn-c" id="rep-exp">${ico('excel')}Exportar</button></div></div><div id="rep"></div>`;

    const balanza = () => {
      const filas = {};
      movs.forEach((m) => {
        const f = (filas[m.cuenta_id] ||= { ini: 0, cargos: 0, abonos: 0 });
        const signo = cta[m.cuenta_id]?.naturaleza === 'A' ? -1 : 1;
        if (m.polizas.fecha < desde) f.ini += signo * (Number(m.cargo) - Number(m.abono));
        else { f.cargos += Number(m.cargo); f.abonos += Number(m.abono); }
      });
      return Object.entries(filas).map(([id, f]) => {
        const c = cta[id] || {}; const signo = c.naturaleza === 'A' ? -1 : 1;
        return { numero: c.numero, descripcion: c.descripcion, codigo_sat: c.codigo_sat, naturaleza: c.naturaleza, ini: r2(f.ini), cargos: r2(f.cargos), abonos: r2(f.abonos), fin: r2(f.ini + signo * (f.cargos - f.abonos)) };
      }).sort((a, b) => String(a.numero).localeCompare(String(b.numero), 'es', { numeric: true }));
    };

    const pintar = () => {
      $$('#t-rep button').forEach((b) => b.classList.toggle('activa', b.dataset.v === tab));
      if (tab === 'balanza') {
        const b = balanza();
        const tc = r2(b.reduce((s, x) => s + x.cargos, 0)), ta = r2(b.reduce((s, x) => s + x.abonos, 0));
        $('#rep').innerHTML = b.length ? `<p class="peq" style="margin-bottom:10px">${etiqueta} · Saldos según naturaleza de la cuenta · Solo pólizas no canceladas</p><div class="tabla-env"><table class="t"><thead><tr><th>Cuenta</th><th>Descripción</th><th>Cód. SAT</th><th class="num">Saldo inicial</th><th class="num">Cargos</th><th class="num">Abonos</th><th class="num">Saldo final</th></tr></thead><tbody>
          ${b.map((x) => `<tr><td class="mono">${esc(x.numero)}</td><td>${esc(x.descripcion)}</td><td class="mono">${esc(x.codigo_sat || '')}</td><td class="num">${dinero(x.ini)}</td><td class="num">${dinero(x.cargos)}</td><td class="num">${dinero(x.abonos)}</td><td class="num"><b>${dinero(x.fin)}</b></td></tr>`).join('')}
          </tbody><tfoot><tr><td colspan="4">Sumas del periodo ${Math.abs(tc - ta) < 0.01 ? '<span class="chip ok">Sumas iguales</span>' : '<span class="chip error">No cuadran</span>'}</td><td class="num">${dinero(tc)}</td><td class="num">${dinero(ta)}</td><td></td></tr></tfoot></table></div>`
          : `<div class="tarjeta">${U.vacio('scale', 'Sin movimientos', 'Registra pólizas para ver la balanza.')}</div>`;
      } else if (tab === 'diario') {
        const enPeriodo = movs.filter((m) => m.polizas.fecha >= desde).sort((a, b) => (a.polizas.fecha + a.polizas.numero + a.orden).localeCompare(b.polizas.fecha + b.polizas.numero + b.orden));
        $('#rep').innerHTML = enPeriodo.length ? `<div class="tabla-env"><table class="t"><thead><tr><th>Fecha</th><th>Póliza</th><th>Cuenta</th><th>Concepto</th><th class="num">Cargo</th><th class="num">Abono</th></tr></thead><tbody>
          ${enPeriodo.map((m) => `<tr><td>${fecha(m.polizas.fecha)}</td><td class="mono">${esc(m.polizas.numero)}</td><td><span class="mono">${esc(cta[m.cuenta_id]?.numero || '')}</span> ${esc(cta[m.cuenta_id]?.descripcion || '')}</td><td>${esc(m.concepto || m.polizas.concepto)}</td><td class="num">${Number(m.cargo) ? dinero(m.cargo) : ''}</td><td class="num">${Number(m.abono) ? dinero(m.abono) : ''}</td></tr>`).join('')}
          </tbody></table></div>` : `<div class="tarjeta">${U.vacio('book', 'Sin movimientos en ' + etiqueta, '')}</div>`;
      } else {
        const usadas = [...new Set(movs.map((m) => m.cuenta_id))].map((id) => cta[id]).filter(Boolean).sort((a, b) => a.numero.localeCompare(b.numero, 'es', { numeric: true }));
        $('#rep').innerHTML = `<div class="campo" style="max-width:420px"><label>Cuenta</label><select class="inp" id="aux-cta">${usadas.map((c) => `<option value="${c.id}">${esc(c.numero)} · ${esc(c.descripcion)}</option>`).join('')}</select></div><div id="aux"></div>`;
        const aux = () => {
          const id = $('#aux-cta').value; const c = cta[id]; if (!c) { $('#aux').innerHTML = U.vacio('list', 'Sin cuentas con movimientos', ''); return; }
          const signo = c.naturaleza === 'A' ? -1 : 1;
          const ms = movs.filter((m) => m.cuenta_id === id);
          let saldo = r2(ms.filter((m) => m.polizas.fecha < desde).reduce((s, m) => s + signo * (Number(m.cargo) - Number(m.abono)), 0));
          const filas = ms.filter((m) => m.polizas.fecha >= desde).sort((a, b) => (a.polizas.fecha + a.polizas.numero).localeCompare(b.polizas.fecha + b.polizas.numero));
          $('#aux').innerHTML = `<div class="tabla-env"><table class="t"><thead><tr><th>Fecha</th><th>Póliza</th><th>Concepto</th><th class="num">Cargo</th><th class="num">Abono</th><th class="num">Saldo</th></tr></thead><tbody>
            <tr><td colspan="5"><b>Saldo inicial</b></td><td class="num"><b>${dinero(saldo)}</b></td></tr>
            ${filas.map((m) => { saldo = r2(saldo + signo * (Number(m.cargo) - Number(m.abono))); return `<tr><td>${fecha(m.polizas.fecha)}</td><td class="mono">${esc(m.polizas.numero)}</td><td>${esc(m.concepto || m.polizas.concepto)}</td><td class="num">${Number(m.cargo) ? dinero(m.cargo) : ''}</td><td class="num">${Number(m.abono) ? dinero(m.abono) : ''}</td><td class="num">${dinero(saldo)}</td></tr>`; }).join('')}
            </tbody></table></div>`;
        };
        if ($('#aux-cta')) { $('#aux-cta').onchange = aux; aux(); }
      }
    };
    $$('#t-rep button').forEach((b) => b.onclick = () => { tab = b.dataset.v; pintar(); });
    $('#rep-exp').onclick = () => {
      const b = balanza();
      const diario = movs.filter((m) => m.polizas.fecha >= desde).map((m) => ({ Fecha: m.polizas.fecha, Póliza: m.polizas.numero, Cuenta: cta[m.cuenta_id]?.numero, Descripción: cta[m.cuenta_id]?.descripcion, Concepto: m.concepto || m.polizas.concepto, Cargo: Number(m.cargo), Abono: Number(m.abono) }));
      U.excel(`Reportes ${C.empresa.rfc} ${etiqueta}`, [
        { nombre: 'Balanza', filas: b.map((x) => ({ Cuenta: x.numero, Descripción: x.descripcion, 'Código SAT': x.codigo_sat || '', 'Saldo inicial': x.ini, Cargos: x.cargos, Abonos: x.abonos, 'Saldo final': x.fin })) },
        { nombre: 'Libro diario', filas: diario }]);
    };
    pintar();
  };

  /* ════════════════════════ IVA ════════════════════════ */
  M.iva = async (el) => {
    const { desde, hasta, etiqueta } = U.rango();
    const lista = await D.cfdis(desde, hasta);
    const r = D.calcIVA(lista);
    const fila = (t, v, cls = '') => `<div class="fila ${cls}"><span>${t}</span><b>${dinero(v)}</b></div>`;
    let mensual = '';
    if (!C.periodo.mes) {
      const filas = U.MESES.map((mes, i) => {
        const k = `${C.periodo.anio}-${String(i + 1).padStart(2, '0')}`;
        const x = D.calcIVA(lista.filter((c) => c.fecha_emision.slice(0, 7) === k));
        return { mes, ...x };
      });
      mensual = `<div class="tarjeta" style="margin-top:18px"><div class="tarjeta-cab"><h3>Por mes</h3></div><div class="tabla-env"><table class="t"><thead><tr><th>Mes</th><th class="num">IVA cobrado</th><th class="num">Retenido por clientes</th><th class="num">IVA acreditable</th><th class="num">Resultado</th></tr></thead><tbody>
        ${filas.map((f) => `<tr><td>${f.mes}</td><td class="num">${dinero(f.trasCobrado)}</td><td class="num">${dinero(f.retClientes)}</td><td class="num">${dinero(f.acredPagado)}</td><td class="num"><b style="color:${f.resultado > 0 ? 'var(--error)' : 'var(--ok)'}">${dinero(f.resultado)}</b></td></tr>`).join('')}</tbody></table></div></div>`;
    }
    el.innerHTML = `
      <div class="banner aviso">${ico('alert')}<span><b>Cálculo preliminar</b> con base en los CFDI cargados y flujo de efectivo (PUE y complementos de pago, menos notas de crédito). No considera proporción de acreditamiento, actos exentos ni tasa 0, ni saldos a favor anteriores. Revísalo con tu contador antes de declarar.</span></div>
      <div class="dos-col">
        <div class="tarjeta"><div class="tarjeta-cab"><div><h3>IVA del periodo</h3><p>${etiqueta}</p></div><button class="btn btn-sec btn-c" id="iva-exp">${ico('excel')}Exportar</button></div>
          <div class="resumen-iva">
            ${fila('IVA trasladado cobrado', r.trasCobrado)}
            ${fila('(−) IVA retenido por tus clientes', r.retClientes, 'menos')}
            ${fila('(−) IVA acreditable pagado', r.acredPagado, 'menos')}
            <div class="fila total"><span>${r.resultado > 0 ? 'IVA a cargo (preliminar)' : r.resultado < 0 ? 'IVA a favor (preliminar)' : 'Sin saldo'}</span><span style="color:${r.resultado > 0 ? 'var(--error)' : 'var(--ok)'}">${dinero(Math.abs(r.resultado))}</span></div>
          </div></div>
        <div class="tarjeta"><div class="tarjeta-cab"><h3>Aparte</h3></div>
          <div class="resumen-iva">
            ${fila('IVA retenido a terceros por enterar', r.retTerceros)}
            ${fila('IVA de facturas PPD emitidas en el periodo', r.trasNoCobrado)}
            ${fila('IVA de facturas PPD recibidas en el periodo', r.acredNoPagado)}
          </div><p class="peq" style="margin-top:10px">Las facturas PPD causan o acreditan IVA hasta que se pagan, con su complemento de pago; por eso se muestran por separado.</p></div>
      </div>
      <div class="tarjeta"><div class="tarjeta-cab"><h3>CFDIs considerados</h3><span class="peq">${r.detalle.length} comprobantes</span></div>
        ${r.detalle.length ? `<div class="tabla-env"><table class="t"><thead><tr><th>Fecha</th><th>Tipo</th><th>Contraparte</th><th>Método</th><th class="num">IVA</th><th class="num">IVA retenido</th></tr></thead><tbody>
          ${r.detalle.map((c) => `<tr class="clic" data-id="${c.id}"><td>${fecha(c.fecha_emision)}</td><td>${esc(SAT.tipoComprobante[c.tipo])} · ${c.origen === 'emitido' ? 'Emitido' : 'Recibido'}</td><td>${esc(D.contraparte(c).nombre || D.contraparte(c).rfc)}</td><td>${esc(c.tipo === 'P' ? 'Complemento' : c.metodo_pago || '')}</td><td class="num">${dinero(D.mxn(c, 'iva_trasladado'))}</td><td class="num">${dinero(D.mxn(c, 'iva_retenido'))}</td></tr>`).join('')}
          </tbody></table></div>` : U.vacio('percent', 'Sin CFDIs con IVA en ' + etiqueta, 'Sube tus XML del periodo.')}
      </div>${mensual}`;
    $$('tr[data-id]', el).forEach((tr) => tr.onclick = () => M.detalleCfdi(tr.dataset.id));
    $('#iva-exp').onclick = () => U.excel(`IVA ${C.empresa.rfc} ${etiqueta}`, [
      { nombre: 'Resumen', filas: [{ Concepto: 'IVA trasladado cobrado', Importe: r2(r.trasCobrado) }, { Concepto: 'IVA retenido por clientes', Importe: r2(r.retClientes) }, { Concepto: 'IVA acreditable pagado', Importe: r2(r.acredPagado) }, { Concepto: 'Resultado preliminar (positivo = a cargo)', Importe: r.resultado }, { Concepto: 'IVA retenido a terceros por enterar', Importe: r2(r.retTerceros) }] },
      { nombre: 'Detalle', filas: r.detalle.map(D.filaExcel) }]);
  };

  /* ════════════════════════ EFOS 69-B ════════════════════════ */
  M.efos = async (el) => {
    const { count: totalLista } = await C.sb.from('efos_blacklist').select('id', { count: 'exact', head: true });
    const todos = await U.todo(() => C.sb.from('cfdis').select('origen,emisor_rfc,emisor_nombre,receptor_rfc,receptor_nombre,total,tipo_cambio,moneda,estado').eq('empresa_id', C.empresa.id).neq('estado', 'borrador'));
    const contra = {};
    todos.forEach((c) => { const x = D.contraparte(c); (contra[x.rfc] ||= { rfc: x.rfc, nombre: x.nombre, origen: c.origen, n: 0, monto: 0 }); contra[x.rfc].n++; contra[x.rfc].monto += D.mxn(c, 'total'); });
    let hallados = [];
    try { hallados = await D.efosCruce(Object.keys(contra)); } catch (e) { /* sin lista */ }
    const graves = hallados.filter((h) => h.situacion === 'definitivo' || h.situacion === 'presunto');
    el.innerHTML = `
      ${!totalLista ? `<div class="banner aviso">${ico('alert')}<span>La lista 69-B aún no está cargada en Contrix. ${C.perfil?.is_admin ? 'Como administrador, cárgala abajo con el archivo oficial del SAT.' : 'Un administrador debe cargarla con el archivo oficial del SAT.'}</span></div>` : ''}
      <div class="kpis" style="grid-template-columns:repeat(3,1fr)">
        <div class="kpi dest"><div class="et">${ico('shield')}Contrapartes revisadas</div><div class="val">${Object.keys(contra).length}</div><div class="det">Clientes y proveedores en tus CFDI</div></div>
        <div class="kpi"><div class="et">Definitivos o presuntos</div><div class="val" style="color:${graves.length ? 'var(--error)' : 'var(--ok)'}">${graves.length}</div><div class="det">Requieren atención</div></div>
        <div class="kpi"><div class="et">Registros en la lista</div><div class="val">${(totalLista || 0).toLocaleString('es-MX')}</div><div class="det">Lista 69-B cargada en Contrix</div></div>
      </div>
      <div class="dos-col">
        <div class="tarjeta"><div class="tarjeta-cab"><h3>Coincidencias</h3>${hallados.length ? `<button class="btn btn-sec btn-c" id="efos-exp">${ico('excel')}Exportar</button>` : ''}</div>
          ${hallados.length ? `<div class="tabla-env"><table class="t"><thead><tr><th>RFC</th><th>Nombre</th><th>Relación</th><th>Situación</th><th class="num">Operaciones</th><th class="num">Monto</th></tr></thead><tbody>
            ${hallados.map((h) => `<tr><td class="mono">${esc(h.rfc)}</td><td>${esc(h.razon_social || contra[h.rfc]?.nombre || '')}</td><td>${contra[h.rfc]?.origen === 'emitido' ? 'Cliente' : 'Proveedor'}</td><td><span class="chip ${['definitivo', 'presunto'].includes(h.situacion) ? 'error' : 'aviso'}">${esc(SAT.situacion69B[h.situacion] || h.situacion)}</span></td><td class="num">${contra[h.rfc]?.n || 0}</td><td class="num">${dinero(contra[h.rfc]?.monto || 0)}</td></tr>`).join('')}
            </tbody></table></div>` : U.vacio('shield', totalLista ? 'Sin coincidencias' : 'Lista no cargada', totalLista ? 'Ninguno de tus clientes o proveedores aparece en la lista 69-B cargada.' : 'Cuando se cargue la lista, aquí verás si algún RFC coincide.')}
        </div>
        <div class="tarjeta"><div class="tarjeta-cab"><h3>Consultar un RFC</h3></div>
          <div class="herr"><input class="inp" id="efos-rfc" placeholder="RFC a consultar" style="text-transform:uppercase;flex:1"><button class="btn btn-pri" id="efos-buscar">${ico('search')}Consultar</button></div>
          <div id="efos-res"></div>
          ${C.perfil?.is_admin ? `<hr style="border:0;border-top:1px solid var(--linea);margin:18px 0">
            <h4 style="font-size:14px;color:var(--rey-900);margin-bottom:6px">Actualizar lista 69-B (administrador)</h4>
            <p class="peq" style="margin-bottom:10px">Descarga el listado completo del artículo 69-B (CSV) desde el portal de datos abiertos del SAT y súbelo aquí. Se reemplazan los registros con el mismo RFC.</p>
            <label class="carga" id="efos-zona" style="padding:18px"><input type="file" accept=".csv,.txt,.xlsx" hidden><h4>Subir CSV del SAT</h4></label><div id="efos-carga"></div>` : ''}
        </div>
      </div>`;
    $('#efos-buscar').onclick = async () => {
      const rfc = $('#efos-rfc').value.trim().toUpperCase();
      if (!CFDI.RFC_RE.test(rfc)) return ($('#efos-res').innerHTML = '<div class="msg ver error">RFC con formato inválido.</div>');
      const { data } = await C.sb.from('efos_blacklist').select('*').eq('rfc', rfc).maybeSingle();
      $('#efos-res').innerHTML = data
        ? `<div class="val-item ${['definitivo', 'presunto'].includes(data.situacion) ? 'error' : 'aviso'}">${ico('alert')}<span><b>${esc(rfc)}</b> aparece como <b>${esc(SAT.situacion69B[data.situacion])}</b>${data.razon_social ? ' · ' + esc(data.razon_social) : ''}${data.fecha_publicacion ? ' · publicado ' + fecha(data.fecha_publicacion) : ''}.</span></div>`
        : `<div class="val-item ok">${ico('check')}<span><b>${esc(rfc)}</b> no aparece en la lista cargada en Contrix${totalLista ? '' : ' (la lista aún no se ha cargado)'}.</span></div>`;
    };
    if ($('#efos-exp')) $('#efos-exp').onclick = () => U.excel('Coincidencias 69-B ' + C.empresa.rfc, [{ nombre: '69-B', filas: hallados.map((h) => ({ RFC: h.rfc, Nombre: h.razon_social || '', Situación: SAT.situacion69B[h.situacion], Relación: contra[h.rfc]?.origen === 'emitido' ? 'Cliente' : 'Proveedor', Operaciones: contra[h.rfc]?.n, Monto: r2(contra[h.rfc]?.monto || 0) })) }]);
    if ($('#efos-zona')) U.zonaCarga($('#efos-zona'), (files) => cargarLista69B(files[0]));
  };

  async function cargarLista69B(f) {
    const est = $('#efos-carga'); if (!f) return;
    est.innerHTML = '<p class="peq">Leyendo archivo…</p><div class="progreso"><div id="efos-barra"></div></div>';
    try {
      let filas;
      if (/\.xlsx$/i.test(f.name)) {
        const wb = XLSX.read(await f.arrayBuffer()); filas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
      } else {
        const buf = await f.arrayBuffer();
        let txt = new TextDecoder('utf-8').decode(buf);
        if (txt.includes('\uFFFD')) txt = new TextDecoder('windows-1252').decode(buf);
        const wb = XLSX.read(txt, { type: 'string' }); filas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
      }
      const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      const iCab = filas.findIndex((r) => r.some((c) => norm(c).trim() === 'rfc') && r.some((c) => norm(c).includes('situacion')));
      if (iCab < 0) throw new Error('No se encontró el encabezado con columnas "RFC" y "Situación del contribuyente".');
      const cab = filas[iCab].map(norm);
      const col = (pred) => cab.findIndex(pred);
      const cRfc = col((c) => c.trim() === 'rfc'), cSit = col((c) => c.includes('situacion')), cNom = col((c) => c.includes('nombre'));
      const cFecha = col((c) => c.includes('publicacion') && c.includes('dof') && c.includes('presunt'));
      const mapa = (s) => { const t = norm(s); if (t.includes('definitiv')) return 'definitivo'; if (t.includes('desvirtu')) return 'desvirtuado'; if (t.includes('sentencia')) return 'sentencia_favorable'; if (t.includes('presunt')) return 'presunto'; return null; };
      const aFecha = (v) => { const m = String(v).match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
      const unicos = {};
      filas.slice(iCab + 1).forEach((r) => {
        const rfc = String(r[cRfc] || '').trim().toUpperCase(); const sit = mapa(r[cSit]);
        if (rfc && sit && CFDI.RFC_RE.test(rfc)) unicos[rfc] = { rfc, situacion: sit, razon_social: cNom >= 0 ? String(r[cNom]).trim() : null, fecha_publicacion: cFecha >= 0 ? aFecha(r[cFecha]) : null, url_fuente: 'SAT — Listado completo 69-B' };
      });
      const lista = Object.values(unicos);
      if (!lista.length) throw new Error('No se encontraron registros válidos.');
      for (let i = 0; i < lista.length; i += 500) {
        const { error } = await C.sb.from('efos_blacklist').upsert(lista.slice(i, i + 500), { onConflict: 'rfc' });
        if (error) throw error;
        $('#efos-barra').style.width = Math.min(100, ((i + 500) / lista.length) * 100) + '%';
      }
      U.aviso(lista.length.toLocaleString('es-MX') + ' registros cargados de la lista 69-B', 'ok'); U.renderModulo();
    } catch (e) { est.innerHTML = `<div class="msg ver error">${esc(U.errorMsg(e))}</div>`; }
  }

  /* ════════════════════════ CONCILIACIÓN SAT ════════════════════════ */
  M.conciliacion = async (el) => {
    const { desde, hasta, etiqueta } = U.rango();
    el.innerHTML = `
      <div class="banner info">${ico('info')}<span>Descarga desde el portal del SAT el reporte del visor (ingresos o nómina) o los metadatos de la descarga masiva, en Excel o CSV, y súbelo aquí. Contrix compara los folios fiscales (UUID) con tus CFDI de <b>${etiqueta}</b>.</span></div>
      <div class="tarjeta" style="margin-bottom:18px">
        <div class="rejilla r3">
          <div class="campo"><label>Qué comparar</label><select class="inp" id="cc-tipo"><option value="ingresos">Visor de ingresos — CFDI emitidos de ingreso</option><option value="nomina">Visor de nómina — CFDI de nómina</option><option value="recibidos">CFDI recibidos (metadatos)</option><option value="todos">Todos los CFDI</option></select></div>
          <div class="campo" style="grid-column:span 2"><label>Archivo del SAT (.xlsx o .csv)</label><label class="carga" id="cc-zona" style="padding:14px"><input type="file" accept=".xlsx,.xls,.csv,.txt" hidden><p><b>Arrastra o elige el archivo</b></p></label></div>
        </div>
      </div>
      <div id="cc-res"></div>`;
    U.zonaCarga($('#cc-zona'), async (files) => {
      const f = files[0]; if (!f) return;
      const res = $('#cc-res'); res.innerHTML = '<p class="peq">Comparando…</p>';
      try {
        const wb = XLSX.read(await f.arrayBuffer());
        const filas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
        const UUID = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i;
        let cU = -1; const muestra = filas.slice(0, 60);
        for (let c = 0; c < 60 && cU < 0; c++) if (muestra.filter((r) => UUID.test(String(r[c] || '').trim())).length >= Math.min(3, muestra.length - 1)) cU = c;
        if (cU < 0) for (let c = 0; c < 60 && cU < 0; c++) if (muestra.some((r) => UUID.test(String(r[c] || '').trim()))) cU = c;
        if (cU < 0) throw new Error('No se encontró una columna con folios fiscales (UUID).');
        const iCab = filas.findIndex((r) => !UUID.test(String(r[cU] || '').trim()) && r.some((x) => String(x).trim()));
        const cab = iCab >= 0 ? filas[iCab].map((x) => String(x).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()) : [];
        const cEst = cab.findIndex((x) => x.includes('estatus') || x.includes('estado'));
        const cTot = cab.findIndex((x) => x.includes('total') || x.includes('monto'));
        const sat = {};
        filas.forEach((r) => {
          const u = String(r[cU] || '').trim().toUpperCase(); if (!UUID.test(u)) return;
          const est = cEst >= 0 ? String(r[cEst]).trim() : '';
          sat[u] = { uuid: u, cancelado: /cancel/i.test(est) || est === '0', total: cTot >= 0 ? parseFloat(String(r[cTot]).replace(/[$,\s]/g, '')) || null : null };
        });
        const tipo = $('#cc-tipo').value;
        const nuestros = await D.cfdis(desde, hasta, (q) => tipo === 'ingresos' ? q.eq('origen', 'emitido').eq('tipo', 'I') : tipo === 'nomina' ? q.eq('tipo', 'N') : tipo === 'recibidos' ? q.eq('origen', 'recibido') : q);
        const porUuid = Object.fromEntries(nuestros.map((c) => [c.uuid_sat.toUpperCase(), c]));
        const enAmbos = Object.keys(sat).filter((u) => porUuid[u]);
        const soloSat = Object.keys(sat).filter((u) => !porUuid[u]);
        const soloContrix = nuestros.filter((c) => !sat[c.uuid_sat.toUpperCase()]);
        const cancelSat = enAmbos.filter((u) => sat[u].cancelado && porUuid[u].estado !== 'cancelado').map((u) => porUuid[u]);
        const difMonto = enAmbos.filter((u) => sat[u].total !== null && Math.abs(sat[u].total - Number(porUuid[u].total)) > 0.01).map((u) => ({ ...porUuid[u], totalSat: sat[u].total }));
        res.innerHTML = `
          <div class="kpis">
            <div class="kpi dest"><div class="et">Coinciden</div><div class="val">${enAmbos.length}</div><div class="det">En el archivo del SAT y en Contrix</div></div>
            <div class="kpi"><div class="et">Solo en el SAT</div><div class="val" style="color:${soloSat.length ? 'var(--error)' : 'var(--ok)'}">${soloSat.length}</div><div class="det">Te falta subir su XML</div></div>
            <div class="kpi"><div class="et">Solo en Contrix</div><div class="val" style="color:${soloContrix.length ? 'var(--aviso)' : 'var(--ok)'}">${soloContrix.length}</div><div class="det">No vienen en el archivo (revisa el periodo)</div></div>
            <div class="kpi"><div class="et">Cancelados en el SAT</div><div class="val" style="color:${cancelSat.length ? 'var(--error)' : 'var(--ok)'}">${cancelSat.length}</div><div class="det">Vigentes en Contrix ${cEst < 0 ? '(sin columna de estatus)' : ''}</div></div>
          </div>
          ${cancelSat.length ? `<div class="banner error">${ico('alert')}<span>${cancelSat.length === 1 ? '1 CFDI aparece cancelado' : cancelSat.length + ' CFDI aparecen cancelados'} en el archivo del SAT pero ${cancelSat.length === 1 ? 'está vigente' : 'están vigentes'} en Contrix.</span><button class="btn btn-sec btn-c" id="cc-cancelar">Marcarlos como cancelados</button></div>` : ''}
          ${difMonto.length ? `<div class="banner aviso">${ico('alert')}<span>${difMonto.length} CFDI tienen un total distinto entre el SAT y Contrix.</span></div>` : ''}
          <div class="herr"><button class="btn btn-sec btn-c" id="cc-exp">${ico('excel')}Exportar resultado</button></div>
          ${soloSat.length ? `<div class="tarjeta" style="margin-bottom:14px"><div class="tarjeta-cab"><h3>Solo en el SAT</h3></div><div class="tabla-env"><table class="t"><tbody>${soloSat.slice(0, 100).map((u) => `<tr><td class="mono">${u}</td><td class="num">${sat[u].total !== null ? dinero(sat[u].total) : ''}</td><td>${sat[u].cancelado ? '<span class="chip error">Cancelado</span>' : ''}</td></tr>`).join('')}</tbody></table></div>${soloSat.length > 100 ? `<p class="peq">y ${soloSat.length - 100} más (ver Excel)</p>` : ''}</div>` : ''}`;
        $('#cc-exp').onclick = () => U.excel('Conciliación SAT ' + C.empresa.rfc + ' ' + etiqueta, [
          { nombre: 'Solo en SAT', filas: soloSat.map((u) => ({ UUID: u, 'Total SAT': sat[u].total, 'Cancelado en SAT': sat[u].cancelado ? 'Sí' : 'No' })) },
          { nombre: 'Solo en Contrix', filas: soloContrix.map(D.filaExcel) },
          { nombre: 'Cancelados en SAT', filas: cancelSat.map(D.filaExcel) },
          { nombre: 'Diferencia de total', filas: difMonto.map((c) => ({ UUID: c.uuid_sat, 'Total Contrix': Number(c.total), 'Total SAT': c.totalSat })) }]);
        if ($('#cc-cancelar')) $('#cc-cancelar').onclick = async () => {
          if (!(await U.confirmar(`¿Marcar ${cancelSat.length} CFDI como cancelados según el archivo del SAT?`, 'Marcar'))) return;
          const { error } = await C.sb.from('cfdis').update({ estado: 'cancelado', fecha_cancelacion: new Date().toISOString(), motivo_cancelacion: 'Según archivo del SAT' }).in('id', cancelSat.map((c) => c.id));
          if (error) return U.aviso(U.errorMsg(error), 'error');
          U.aviso('CFDIs marcados como cancelados', 'ok'); U.renderModulo();
        };
      } catch (e) { res.innerHTML = `<div class="msg ver error">${esc(U.errorMsg(e))}</div>`; }
    });
  };

  /* ════════════════════════ SINCRONIZACIÓN SAT ════════════════════════ */
  M.sat = async (el) => {
    const { count } = await C.sb.from('cfdis').select('id', { count: 'exact', head: true }).eq('empresa_id', C.empresa.id).neq('estado', 'borrador');
    const { data: ult } = await C.sb.from('cfdis').select('created_at').eq('empresa_id', C.empresa.id).order('created_at', { ascending: false }).limit(1);
    el.innerHTML = `
      <div class="dos-col">
        <div class="requiere"><h4>${ico('sync')}Sincronización diaria automática — en desarrollo</h4>
          <p class="peq" style="margin-top:8px">Para descargar tus CFDI del SAT cada día sin intervención se necesita:</p>
          <ul><li>Tu e.firma (archivo .cer, .key y contraseña) guardada de forma cifrada.</li><li>Un servicio en servidor que consulte el web service de descarga masiva del SAT y programe la tarea diaria.</li><li>Validar el estatus (vigente o cancelado) de cada CFDI con el servicio de consulta del SAT.</li></ul>
          <p class="peq" style="margin-top:12px">Mientras tanto, descarga tus XML desde el portal del SAT y súbelos aquí (puedes subir el .zip tal cual).</p></div>
        <div class="tarjeta"><div class="tarjeta-cab"><h3>Estado</h3></div>
          <dl class="dl"><dt>CFDIs en Contrix</dt><dd>${(count || 0).toLocaleString('es-MX')}</dd><dt>Última carga</dt><dd>${ult && ult[0] ? new Date(ult[0].created_at).toLocaleString('es-MX') : 'Sin cargas'}</dd><dt>Empresa</dt><dd>${esc(C.empresa.rfc)}</dd></dl></div>
      </div>
      <div class="tarjeta"><div class="tarjeta-cab"><h3>Carga masiva</h3><p>XML sueltos o .zip de la descarga masiva del SAT</p></div>
        <label class="carga" id="sat-zona"><input type="file" multiple accept=".xml,.zip" hidden>${ico('upload')}<h4>Arrastra aquí tus archivos</h4><p>Se clasifican automáticamente como emitidos o recibidos.</p></label>
        <div id="carga-estado" style="margin-top:14px"></div></div>`;
    U.zonaCarga($('#sat-zona'), (files) => M.procesarArchivos(files));
  };

  /* ════════════════════════ PORTAL CONTADOR ════════════════════════ */
  M.portal = async (el) => {
    if (!planPermite('empresarial', 'corporativo')) { el.innerHTML = bloqueoPlan('El Portal Contador'); return; }
    const { desde, hasta, etiqueta } = U.rango();
    const plan = U.planActual();
    const propias = C.empresas.filter((e) => e.owner_id === C.usuario.id).length;
    const tarjetas = await Promise.all(C.empresas.map(async (e) => {
      const [{ count: n }, { data: errs }] = await Promise.all([
        C.sb.from('cfdis').select('id', { count: 'exact', head: true }).eq('empresa_id', e.id).gte('fecha_emision', desde).lt('fecha_emision', hasta).neq('estado', 'borrador'),
        C.sb.from('cfdis').select('errores').eq('empresa_id', e.id).gte('fecha_emision', desde).lt('fecha_emision', hasta).neq('estado', 'borrador').neq('errores', '[]').limit(1000)
      ]);
      const conErr = (errs || []).filter((x) => (x.errores || []).some((v) => v.nivel === 'error')).length;
      return { e, n: n || 0, conErr };
    }));
    el.innerHTML = `
      <div class="herr"><span class="peq">${C.empresas.length} empresa(s) · ${etiqueta} · Tu plan permite ${plan.limites.empresas ? plan.limites.empresas + ' empresa(s) propias' : 'empresas ilimitadas'}</span>
        <div class="der"><button class="btn btn-pri btn-c" id="pc-nueva" ${plan.limites.empresas && propias >= plan.limites.empresas ? 'disabled title="Límite del plan alcanzado"' : ''}>${ico('plus')}Nueva empresa</button></div></div>
      <div class="kpis" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr))">
        ${tarjetas.map(({ e, n, conErr }) => `<div class="kpi ${e.id === C.empresa.id ? 'dest' : ''}"><div class="et">${ico('building')}${esc(e.rfc)} ${e.owner_id === C.usuario.id ? '' : '<span class="chip gris" style="margin-left:auto">Invitado</span>'}</div>
          <div style="font-weight:750;margin-top:8px;font-size:16px">${esc(e.nombre_comercial || e.razon_social)}</div>
          <div class="det">${n} CFDIs · ${conErr} con errores</div>
          <div style="display:flex;gap:8px;margin-top:14px"><button class="btn ${e.id === C.empresa.id ? 'btn-vidrio' : 'btn-sec'} btn-c" data-entrar="${e.id}">${e.id === C.empresa.id ? 'Activa' : 'Entrar'}</button><button class="btn ${e.id === C.empresa.id ? 'btn-vidrio' : 'btn-fant'} btn-c" data-equipo="${e.id}">${ico('users')}Equipo</button></div></div>`).join('')}
      </div>`;
    $$('[data-entrar]').forEach((b) => b.onclick = () => { C.empresa = C.empresas.find((x) => x.id === b.dataset.entrar); U.guardarLocal('empresa', C.empresa.id); U.refrescarCabecera(); location.hash = '#/app/inicio'; });
    $$('[data-equipo]').forEach((b) => b.onclick = () => equipo(C.empresas.find((x) => x.id === b.dataset.equipo)));
    $('#pc-nueva').onclick = () => {
      const m = U.modal({
        titulo: 'Nueva empresa',
        cuerpo: `<div class="msg" id="m-ne"></div><div class="rejilla r2"><div class="campo"><label>RFC</label><input class="inp" id="ne-rfc" maxlength="13" style="text-transform:uppercase"></div><div class="campo"><label>Código postal</label><input class="inp" id="ne-cp" maxlength="5"></div></div>
          <div class="campo"><label>Razón social</label><input class="inp" id="ne-rs" style="text-transform:uppercase"></div>
          <div class="campo"><label>Régimen fiscal</label><select class="inp" id="ne-reg"><option value="">Selecciona…</option>${Object.entries(SAT.regimen).map(([k, v]) => `<option value="${k}">${k} — ${v}</option>`).join('')}</select></div>
          <label class="peq"><input type="checkbox" id="ne-cat" checked> Cargar catálogo de cuentas base</label>`,
        pie: '<button class="btn btn-sec" data-cerrar>Cancelar</button><button class="btn btn-pri" id="ne-ok">Crear</button>'
      });
      $('#ne-ok', m).onclick = async () => {
        $('#ne-ok').classList.add('cargando');
        try {
          const e = await U.crearEmpresa({ rfc: $('#ne-rfc').value, codigo_postal: $('#ne-cp').value.trim(), razon_social: $('#ne-rs').value, regimen_fiscal: $('#ne-reg').value }, $('#ne-cat').checked);
          await U.cargarEmpresas(); C.empresa = C.empresas.find((x) => x.id === e.id); U.guardarLocal('empresa', e.id);
          U.cerrarModal(); U.refrescarCabecera(); U.aviso('Empresa creada', 'ok'); U.renderModulo();
        } catch (err) { const mm = $('#m-ne'); mm.className = 'msg ver error'; mm.textContent = U.errorMsg(err); $('#ne-ok').classList.remove('cargando'); }
      };
    };
  };

  async function equipo(emp) {
    const { data, error } = await C.sb.rpc('miembros_de_empresa', { p_empresa: emp.id });
    const ROLES = { admin: 'Administrador', contador: 'Contador', colaborador: 'Colaborador', solo_lectura: 'Solo lectura' };
    const m = U.modal({
      titulo: 'Equipo · ' + esc(emp.nombre_comercial || emp.razon_social),
      cuerpo: `${error ? `<div class="msg ver error">${esc(U.errorMsg(error))}</div>` : `<div class="tabla-env" style="margin-bottom:16px"><table class="t"><tbody>${(data || []).map((u) => `<tr><td><b>${esc(u.nombre || '')}</b><div class="peq">${esc(u.email)}</div></td><td>${u.es_dueno ? '<span class="chip">Dueño</span>' : `<span class="chip gris">${ROLES[u.rol] || u.rol}</span>`}</td><td class="num">${!u.es_dueno && emp.owner_id === C.usuario.id ? `<button class="btn btn-fant btn-c" data-quitar="${u.user_id}">${ico('trash')}</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`}
        <h4 style="font-size:14px;margin-bottom:8px">Invitar colaborador</h4><p class="peq" style="margin-bottom:10px">La persona debe tener una cuenta de Contrix con ese correo.</p>
        <div class="rejilla r2"><div class="campo"><label>Correo</label><input class="inp" id="inv-email" type="email"></div><div class="campo"><label>Rol</label><select class="inp" id="inv-rol">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${k === 'contador' ? 'selected' : ''}>${v}</option>`).join('')}</select></div></div>`,
      pie: '<button class="btn btn-sec" data-cerrar>Cerrar</button><button class="btn btn-pri" id="inv-ok">Invitar</button>'
    });
    $('#inv-ok', m).onclick = async () => {
      const { error: e } = await C.sb.rpc('invitar_miembro', { p_empresa: emp.id, p_email: $('#inv-email').value.trim(), p_rol: $('#inv-rol').value });
      if (e) return U.aviso(U.errorMsg(e), 'error');
      U.aviso('Colaborador agregado', 'ok'); equipo(emp);
    };
    $$('[data-quitar]', m).forEach((b) => b.onclick = async () => {
      const { error: e } = await C.sb.from('miembros_empresa').delete().eq('empresa_id', emp.id).eq('user_id', b.dataset.quitar);
      if (e) return U.aviso(U.errorMsg(e), 'error');
      U.aviso('Acceso retirado', 'ok'); equipo(emp);
    });
  }

  /* ════════════════════════ COI ════════════════════════ */
  M.coi = async (el) => {
    if (!planPermite('empresarial', 'corporativo')) { el.innerHTML = bloqueoPlan('La sincronización con COI'); return; }
    el.innerHTML = `
      <div class="requiere" style="margin-bottom:18px"><h4>${ico('sync')}Sincronización con Aspel COI — en desarrollo</h4>
        <p class="peq" style="margin-top:8px">Para enviar pólizas a COI se necesita el formato (layout) de importación de la versión de COI que usas, para generar el archivo exactamente como COI lo espera.</p>
        <ul><li>Versión de Aspel COI y su layout de importación de pólizas.</li><li>Relación entre tus cuentas de Contrix y las de COI (si son distintas).</li></ul></div>
      <div class="tarjeta"><div class="tarjeta-cab"><div><h3>Mientras tanto</h3><p>Exporta tus pólizas del periodo a Excel con número de cuenta, cargo y abono.</p></div><a class="btn btn-pri" href="#/app/polizas">${ico('book')}Ir a pólizas y exportar</a></div></div>`;
  };

  /* ════════════════════════ NOTICIAS ════════════════════════ */
  M.noticias = async (el) => {
    let extra = [];
    try {
      const { data } = await C.sb.from('noticias').select('*').eq('visible', true).order('fecha_publicacion', { ascending: false }).limit(30);
      extra = (data || []).filter((n) => n.url_oficial).map((n) => ({ fecha: n.fecha_publicacion, categoria: n.categoria || n.fuente, titulo: n.titulo, resumen: n.resumen || '', fuente: n.fuente, url: n.url_oficial }));
    } catch (e) { /* sin noticias en base de datos */ }
    const ind = C.indicadores || window.CONTRIX_DATOS.indicadores;
    el.innerHTML = `
      <div class="kpis" style="grid-template-columns:repeat(auto-fill,minmax(200px,1fr))">
        ${ind.map((i, k) => `<a class="kpi ${k === 0 ? 'dest' : ''}" href="${esc(i.url)}" target="_blank" rel="noopener" style="text-decoration:none"><div class="et">${esc(i.etiqueta)}</div><div class="val">${esc(i.valor)}</div><div class="det">${esc(i.unidad)} · ${esc(i.fecha)} · ${esc(i.fuente)} ↗</div></a>`).join('')}
      </div>
      <div class="noticias" id="app-noticias" style="margin-top:0"></div>
      <div class="aviso-legal">${ico('info')}<div><b>Aviso de derechos de autor.</b> Los resúmenes son redacción propia de Contrix; la información pertenece a sus autores. Consulta siempre la fuente original. Las iniciativas no son ley hasta su publicación en el DOF.</div></div>`;
    U.renderNoticias($('#app-noticias'), extra.concat(window.CONTRIX_DATOS.noticias));
  };

  /* ════════════════════════ PLAN Y PAGOS ════════════════════════ */
  M.plan = async (el, params) => {
    if (params.get('pago') === 'ok') {
      setTimeout(async () => {
        const { data } = await C.sb.from('profiles').select('*').eq('id', C.usuario.id).single();
        if (data) { C.perfil = data; U.refrescarCabecera(); }
      }, 3500);
    }
    const p = C.perfil || {}, plan = U.planActual(), ac = U.acceso();
    const estado = { prueba: `Periodo de prueba · ${ac.dias} día(s) restantes`, suscripcion: 'Suscripción activa', atraso: 'Pago pendiente', inactiva: 'Suscripción inactiva', prueba_vencida: 'Prueba terminada' }[ac.tipo];
    el.innerHTML = `
      ${params.get('pago') === 'ok' ? `<div class="banner info">${ico('check')}<span>Pago recibido. Tu plan se actualiza en unos segundos, en cuanto Stripe nos confirma.</span></div>` : ''}
      ${params.get('pago') === 'cancelado' ? `<div class="banner aviso">${ico('info')}<span>No se completó el pago. No se hizo ningún cargo.</span></div>` : ''}
      <div class="dos-col">
        <div class="tarjeta"><div class="tarjeta-cab"><div><h3>Tu plan</h3><p>${estado}</p></div><span class="chip oscuro">${plan.nombre}</span></div>
          <dl class="dl"><dt>Precio</dt><dd>$${plan.precio.toLocaleString('es-MX')} MXN / mes + IVA</dd>
          <dt>Límites</dt><dd>${cant(plan.filas.empresas, 'empresa', 'empresas', 'Empresas ilimitadas')} · ${plan.filas.cfdis === 'Ilimitados' ? 'CFDIs ilimitados' : plan.filas.cfdis + ' CFDIs/mes'} · ${cant(plan.filas.usuarios, 'usuario', 'usuarios', 'usuarios ilimitados')}</dd>
          ${p.trial_ends_at && ac.tipo === 'prueba' ? `<dt>Prueba hasta</dt><dd>${fecha(p.trial_ends_at)}</dd>` : ''}
          ${p.current_period_end ? `<dt>Próximo cobro</dt><dd>${fecha(p.current_period_end)}</dd>` : ''}</dl>
          ${p.stripe_customer_id ? `<button class="btn btn-sec" id="pl-portal" style="margin-top:16px">${ico('card')}Administrar tarjeta y facturas</button>` : ''}
        </div>
        <div class="tarjeta"><div class="tarjeta-cab"><h3>Pago seguro</h3></div>
          <p class="peq">El cobro se hace con <b>Stripe Checkout</b>: la tarjeta se captura en la página de Stripe y Contrix nunca ve ni guarda sus datos. Puedes cancelar cuando quieras desde "Administrar".</p>
          <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap"><span class="chip gris">Visa</span><span class="chip gris">Mastercard</span><span class="chip gris">American Express</span></div>
        </div>
      </div>
      <div class="planes" style="margin-top:0">${window.CONTRIX_CONFIG.PLANES.map((x) => `
        <div class="plan ${x.popular ? 'top' : ''}"><h3>${x.nombre}</h3><p class="pdesc">${x.desc}</p>
          <div class="precio"><b>$${x.precio.toLocaleString('es-MX')}</b><span>MXN / mes</span></div><div class="iva">Más IVA</div>
          <ul><li>${ico('check')}${cant(x.filas.empresas, 'empresa', 'empresas', 'Empresas ilimitadas')}</li><li>${ico('check')}${x.filas.cfdis === 'Ilimitados' ? 'CFDIs ilimitados' : x.filas.cfdis + ' CFDIs al mes'}</li><li>${ico('check')}${cant(x.filas.usuarios, 'usuario', 'usuarios', 'Usuarios ilimitados')}</li>
            <li class="${x.filas.portal ? '' : 'no'}">${ico(x.filas.portal ? 'check' : 'x')}Portal Contador</li><li class="${x.filas.coi ? '' : 'no'}">${ico(x.filas.coi ? 'check' : 'x')}Sincronización COI</li><li>${ico('check')}Soporte ${x.filas.soporte.toLowerCase()}</li></ul>
          ${x.id === plan.id && ac.tipo === 'suscripcion' ? `<button class="btn ${x.popular ? 'btn-blanco' : 'btn-sec'} btn-g" disabled>Plan actual</button>` : `<button class="btn ${x.popular ? 'btn-blanco' : 'btn-pri'} btn-g" data-plan="${x.id}">${p.stripe_subscription_id && ac.tipo === 'suscripcion' ? 'Cambiar a ' + x.nombre : 'Suscribirme'}</button>`}
        </div>`).join('')}</div>`;
    const base = location.protocol.startsWith('http') ? location.origin + location.pathname : undefined;
    const invocar = async (fn, body, boton) => {
      boton.classList.add('cargando');
      try {
        const { data, error } = await C.sb.functions.invoke(fn, { body });
        if (error) {
          let detalle = error.message;
          try { const j = await error.context.json(); detalle = j.error || detalle; } catch (e) { /* sin detalle */ }
          throw new Error(/Failed to send|not found|404/i.test(detalle) ? 'El cobro con tarjeta aún no está configurado en el servidor. Sigue la sección "Stripe" del archivo LEEME.md.' : detalle);
        }
        if (data?.url) location.href = data.url; else throw new Error(data?.error || 'Respuesta inesperada del servidor de pagos');
      } catch (e) { U.aviso(U.errorMsg(e), 'error'); boton.classList.remove('cargando'); }
    };
    $$('[data-plan]').forEach((b) => b.onclick = () => {
      if (p.stripe_subscription_id && ac.tipo === 'suscripcion') return invocar('stripe-portal', { return_url: base }, b);
      invocar('stripe-checkout', { plan: b.dataset.plan, return_url: base }, b);
    });
    if ($('#pl-portal')) $('#pl-portal').onclick = (e) => invocar('stripe-portal', { return_url: base }, e.currentTarget);
  };

  /* ════════════════════════ CONFIGURACIÓN ════════════════════════ */
  M.config = async (el) => {
    const p = C.perfil || {}, e = C.empresa;
    const esDueno = e.owner_id === C.usuario.id;
    el.innerHTML = `
      <div class="dos-col">
        <div class="tarjeta"><div class="tarjeta-cab"><h3>Empresa activa</h3>${esDueno ? '' : '<span class="chip gris">Solo el dueño puede editar</span>'}</div>
          <div class="rejilla r2"><div class="campo"><label>RFC</label><input class="inp" value="${esc(e.rfc)}" readonly></div><div class="campo"><label>Código postal</label><input class="inp" id="ce-cp" value="${esc(e.codigo_postal || '')}" maxlength="5"></div></div>
          <div class="campo"><label>Razón social</label><input class="inp" id="ce-rs" value="${esc(e.razon_social)}"></div>
          <div class="rejilla r2"><div class="campo"><label>Nombre comercial</label><input class="inp" id="ce-nc" value="${esc(e.nombre_comercial || '')}"></div>
          <div class="campo"><label>Régimen fiscal</label><select class="inp" id="ce-reg">${Object.entries(SAT.regimen).map(([k, v]) => `<option value="${k}" ${k === e.regimen_fiscal ? 'selected' : ''}>${k} — ${v}</option>`).join('')}</select></div></div>
          <div class="rejilla r2"><div class="campo"><label>Correo de contacto</label><input class="inp" id="ce-mail" value="${esc(e.email_contacto || '')}"></div><div class="campo"><label>Teléfono</label><input class="inp" id="ce-tel" value="${esc(e.telefono || '')}"></div></div>
          <button class="btn btn-pri" id="ce-ok" ${esDueno ? '' : 'disabled'}>Guardar empresa</button>
        </div>
        <div>
          <div class="tarjeta" style="margin-bottom:18px"><div class="tarjeta-cab"><h3>Mi perfil</h3></div>
            <div class="campo"><label>Nombre</label><input class="inp" id="cp-nom" value="${esc(p.nombre || '')}"></div>
            <div class="rejilla r2"><div class="campo"><label>Teléfono</label><input class="inp" id="cp-tel" value="${esc(p.telefono || '')}"></div><div class="campo"><label>RFC personal</label><input class="inp" id="cp-rfc" value="${esc(p.rfc_personal || '')}" style="text-transform:uppercase"></div></div>
            <div class="campo"><label>Correo</label><input class="inp" value="${esc(C.usuario.email)}" readonly></div>
            <button class="btn btn-pri" id="cp-ok">Guardar perfil</button></div>
          <div class="tarjeta"><div class="tarjeta-cab"><h3>Seguridad</h3></div>
            <div class="campo"><label>Nueva contraseña</label><input class="inp" id="cs-pass" type="password" minlength="8" autocomplete="new-password"></div>
            <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn btn-sec" id="cs-ok">Cambiar contraseña</button><button class="btn btn-peligro" id="cs-salir">${ico('logout')}Cerrar sesión</button></div></div>
        </div>
      </div>`;
    $('#ce-ok').onclick = async () => {
      const d = { razon_social: $('#ce-rs').value.trim().toUpperCase(), nombre_comercial: $('#ce-nc').value.trim() || null, regimen_fiscal: $('#ce-reg').value, codigo_postal: $('#ce-cp').value.trim(), email_contacto: $('#ce-mail').value.trim() || null, telefono: $('#ce-tel').value.trim() || null };
      if (!d.razon_social || !/^\d{5}$/.test(d.codigo_postal)) return U.aviso('Razón social y CP de 5 dígitos son obligatorios', 'error');
      const { error } = await C.sb.from('empresas').update(d).eq('id', e.id);
      if (error) return U.aviso(U.errorMsg(error), 'error');
      Object.assign(e, d); U.refrescarCabecera(); U.aviso('Empresa actualizada', 'ok');
    };
    $('#cp-ok').onclick = async () => {
      const d = { nombre: $('#cp-nom').value.trim(), telefono: $('#cp-tel').value.trim() || null, rfc_personal: $('#cp-rfc').value.trim().toUpperCase() || null };
      const { error } = await C.sb.from('profiles').update(d).eq('id', C.usuario.id);
      if (error) return U.aviso(U.errorMsg(error), 'error');
      Object.assign(C.perfil, d); U.refrescarCabecera(); U.aviso('Perfil actualizado', 'ok');
    };
    $('#cs-ok').onclick = async () => {
      const pass = $('#cs-pass').value; if (pass.length < 8) return U.aviso('Mínimo 8 caracteres', 'error');
      const { error } = await C.sb.auth.updateUser({ password: pass });
      if (error) return U.aviso(U.errorMsg(error), 'error');
      $('#cs-pass').value = ''; U.aviso('Contraseña actualizada', 'ok');
    };
    $('#cs-salir').onclick = () => C.sb.auth.signOut();
  };
})();
