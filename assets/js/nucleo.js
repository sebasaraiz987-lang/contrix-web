/* ════════════════════════════════════════════════════════════
   CONTRIX — Núcleo: Supabase, estado, utilidades, enrutador,
   acceso (login/registro), alta de empresa y estructura de la app
   ════════════════════════════════════════════════════════════ */
(function () {
  const CFG = window.CONTRIX_CONFIG;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  /* ── Estado global ───────────────────────────────────────── */
  const hoy = new Date();
  const C = window.C = {
    sb: null, sesion: null, usuario: null, perfil: null,
    empresas: [], empresa: null,
    periodo: { anio: hoy.getFullYear(), mes: hoy.getMonth() + 1 },
    modulo: 'inicio', graficas: []
  };

  try {
    C.sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
  } catch (e) { console.error('[Contrix] No se pudo iniciar Supabase', e); }

  /* ── Utilidades ──────────────────────────────────────────── */
  const U = window.U = {
    $, $$,
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    dinero: (v, mon = 'MXN') => (Number(v) || 0).toLocaleString('es-MX', { style: 'currency', currency: mon === 'XXX' ? 'MXN' : (mon || 'MXN') }),
    num: (v, d = 2) => (Number(v) || 0).toLocaleString('es-MX', { minimumFractionDigits: d, maximumFractionDigits: d }),
    fecha: (d) => { if (!d) return '—'; const x = new Date(String(d).length === 10 ? d + 'T12:00:00' : d); return isNaN(x) ? '—' : x.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }); },
    r2: (v) => Math.round((Number(v) || 0) * 100) / 100,
    ico: (id, cls = '') => `<svg class="${cls}"><use href="#i-${id}"/></svg>`,
    MESES: ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'],
    guardarLocal(k, v) { try { localStorage.setItem('contrix.' + k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } },
    leerLocal(k) { try { return JSON.parse(localStorage.getItem('contrix.' + k)); } catch (e) { return null; } },

    rango() {
      const { anio, mes } = C.periodo;
      if (!mes) return { desde: `${anio}-01-01`, hasta: `${anio + 1}-01-01`, etiqueta: `Ejercicio ${anio}` };
      const sig = mes === 12 ? `${anio + 1}-01-01` : `${anio}-${String(mes + 1).padStart(2, '0')}-01`;
      return { desde: `${anio}-${String(mes).padStart(2, '0')}-01`, hasta: sig, etiqueta: `${U.MESES[mes - 1]} ${anio}` };
    },

    async todo(fabrica) {
      let salida = [], i = 0; const paso = 1000;
      for (;;) {
        const { data, error } = await fabrica().range(i, i + paso - 1);
        if (error) throw error;
        salida = salida.concat(data || []);
        if (!data || data.length < paso) break;
        i += paso;
      }
      return salida;
    },

    aviso(texto, tipo = '') {
      const el = document.createElement('div');
      el.className = 'toast ' + tipo;
      el.innerHTML = U.ico(tipo === 'error' ? 'alert' : tipo === 'ok' ? 'check' : 'info') + '<div>' + U.esc(texto) + '</div>';
      $('#avisos').appendChild(el);
      setTimeout(() => el.remove(), tipo === 'error' ? 7000 : 4200);
    },

    errorMsg(e) {
      const m = (e && (e.message || e.error_description || e.msg)) || String(e);
      if (/Invalid login credentials/i.test(m)) return 'Correo o contraseña incorrectos.';
      if (/Email not confirmed/i.test(m)) return 'Tu correo aún no está confirmado. Revisa tu bandeja de entrada.';
      if (/User already registered/i.test(m)) return 'Ya existe una cuenta con ese correo. Inicia sesión.';
      if (/Password should be at least/i.test(m)) return 'La contraseña es muy corta.';
      if (/rate limit/i.test(m)) return 'Demasiados intentos. Espera un momento y vuelve a intentar.';
      if (/Failed to fetch|NetworkError/i.test(m)) return 'No hay conexión con el servidor. Revisa tu internet.';
      if (/duplicate key value.*uuid_sat/i.test(m)) return 'Ese CFDI ya estaba cargado.';
      if (/duplicate key value.*owner_id, rfc|empresas_owner_id_rfc_key/i.test(m)) return 'Ya tienes una empresa con ese RFC.';
      if (/does not exist|schema cache/i.test(m)) return 'Falta aplicar la migración en Supabase (supabase/migracion-final.sql). Detalle: ' + m;
      return m;
    },

    modal({ titulo, cuerpo, pie = '', ancho = false }) {
      const m = $('#modal');
      m.className = 'modal' + (ancho ? ' ancho' : '');
      m.innerHTML = `<div class="modal-cab"><h3>${titulo}</h3><button class="cerrar" data-cerrar aria-label="Cerrar">${U.ico('x')}</button></div>
        <div class="modal-cuerpo">${cuerpo}</div>${pie ? `<div class="modal-pie">${pie}</div>` : ''}`;
      $('#capa').classList.add('ver');
      m.querySelectorAll('[data-cerrar]').forEach((b) => b.onclick = U.cerrarModal);
      return m;
    },
    cerrarModal() { $('#capa').classList.remove('ver'); $('#modal').innerHTML = ''; },

    confirmar(texto, okTexto = 'Confirmar') {
      return new Promise((res) => {
        const m = U.modal({ titulo: 'Confirmar', cuerpo: `<p>${texto}</p>`, pie: `<button class="btn btn-sec" data-cerrar>Cancelar</button><button class="btn btn-pri" id="conf-ok">${okTexto}</button>` });
        m.querySelectorAll('[data-cerrar]').forEach((b) => b.onclick = () => { U.cerrarModal(); res(false); });
        $('#conf-ok').onclick = () => { U.cerrarModal(); res(true); };
      });
    },

    excel(nombre, hojas) {
      if (!window.XLSX) return U.aviso('No se cargó la librería de Excel. Revisa tu conexión.', 'error');
      const wb = XLSX.utils.book_new();
      hojas.forEach((h) => {
        const ws = XLSX.utils.json_to_sheet(h.filas.length ? h.filas : [{ Aviso: 'Sin registros en el periodo' }]);
        const cols = Object.keys(h.filas[0] || { Aviso: '' });
        ws['!cols'] = cols.map((c) => ({ wch: Math.min(48, Math.max(10, c.length + 2, ...h.filas.slice(0, 200).map((f) => String(f[c] ?? '').length + 1))) }));
        XLSX.utils.book_append_sheet(wb, ws, h.nombre.slice(0, 31));
      });
      XLSX.writeFile(wb, nombre.replace(/[\\/:*?"<>|]/g, '-') + '.xlsx');
      U.aviso('Archivo de Excel generado', 'ok');
    },

    descargar(nombre, contenido, tipo = 'application/xml') {
      const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
      const a = document.createElement('a'); a.href = url; a.download = nombre; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    },

    zonaCarga(el, alSoltar) {
      const input = el.querySelector('input[type=file]');
      el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('sobre'); });
      el.addEventListener('dragleave', () => el.classList.remove('sobre'));
      el.addEventListener('drop', (e) => { e.preventDefault(); el.classList.remove('sobre'); alSoltar([...e.dataTransfer.files]); });
      if (input) input.addEventListener('change', () => { alSoltar([...input.files]); input.value = ''; });
    },

    vacio(icono, titulo, texto, boton = '') {
      return `<div class="vacio">${U.ico(icono)}<h4>${titulo}</h4><p>${texto}</p>${boton}</div>`;
    },

    planActual() { return CFG.PLANES.find((p) => p.id === (C.perfil?.plan || 'pymes')) || CFG.PLANES[0]; },

    acceso() {
      const p = C.perfil || {};
      const ahora = Date.now();
      if (p.stripe_subscription_id) {
        if (['active', 'trialing'].includes(p.subscription_status)) return { ok: true, tipo: 'suscripcion' };
        if (p.subscription_status === 'past_due') return { ok: true, tipo: 'atraso' };
        return { ok: false, tipo: 'inactiva' };
      }
      const fin = p.trial_ends_at ? new Date(p.trial_ends_at).getTime() : ahora + 1;
      if (fin > ahora) return { ok: true, tipo: 'prueba', dias: Math.ceil((fin - ahora) / 864e5) };
      return { ok: false, tipo: 'prueba_vencida' };
    },

    destruirGraficas() { C.graficas.forEach((g) => g.destroy()); C.graficas = []; },

    async registrar(accion, entidad, entidad_id, detalles) {
      try {
        await C.sb.from('actividad_log').insert({ empresa_id: C.empresa?.id, user_id: C.usuario?.id, accion, entidad, entidad_id, detalles, user_agent: navigator.userAgent.slice(0, 200) });
      } catch (e) { /* el registro de actividad no debe interrumpir */ }
    }
  };

  /* ── Indicadores (franja, widget y barra) ────────────────── */
  async function indicadores() {
    const D = window.CONTRIX_DATOS;
    let lista = D.indicadores.slice();
    // Si hay datos más recientes cargados por un admin en Supabase, se usan
    if (C.usuario) {
      try {
        const { data } = await C.sb.from('indicadores_economicos').select('*').order('fecha', { ascending: false }).limit(1);
        const f = data && data[0];
        if (f && f.fecha > D.consultado) {
          const fecha = U.fecha(f.fecha);
          lista = lista.map((i) => {
            if (i.id === 'usd' && f.tipo_cambio_usd) return { ...i, valor: '$' + Number(f.tipo_cambio_usd).toFixed(4), fecha, fuente: f.fuente || i.fuente };
            if (i.id === 'udi' && f.udi) return { ...i, valor: Number(f.udi).toFixed(6), fecha, fuente: f.fuente || i.fuente };
            return i;
          });
        }
      } catch (e) { /* se mantienen los datos consultados */ }
    }
    C.indicadores = lista;
    const pista = lista.map((i) => `<span class="franja-item">${U.esc(i.etiqueta)} <b>${U.esc(i.valor)}</b> <small>${U.esc(i.fuente)} · ${U.esc(i.fecha)}</small></span>`).join('');
    $('#franja').innerHTML = pista + pista;

    const usd = lista.find((i) => i.id === 'usd'), infl = lista.find((i) => i.id === 'infl');
    $('#widget-pastilla').innerHTML = `<span class="vivo">${U.ico('trend')}</span><span>USD <b>${U.esc(usd.valor)}</b></span><span style="opacity:.5">·</span><span>Inflación <b>${U.esc(infl.valor)}</b></span>`;
    $('#widget-panel').innerHTML = `<h4>Indicadores <button class="cerrar" id="widget-cerrar">${U.ico('x')}</button></h4>` +
      lista.map((i) => `<div class="ind-fila"><div>${U.esc(i.etiqueta)}<small>${U.esc(i.unidad)} · ${U.esc(i.fecha)}</small></div><div class="v">${U.esc(i.valor)}<br><a href="${U.esc(i.url)}" target="_blank" rel="noopener">${U.esc(i.fuente)} ↗</a></div></div>`).join('') +
      `<div class="ind-pie">Consultados el ${U.fecha(D.consultado)}. Verifica en la fuente antes de usarlos en un cálculo oficial.</div>`;
    $('#widget-pastilla').onclick = () => $('#widget-ind').classList.toggle('abierto');
    $('#widget-cerrar').onclick = (e) => { e.stopPropagation(); $('#widget-ind').classList.remove('abierto'); };
    $('#ind-mini').innerHTML = `<span>USD <b>${U.esc(usd.valor)}</b></span><span>Inflación <b>${U.esc(infl.valor)}</b></span><span>INPC <b>${U.esc(lista.find((i) => i.id === 'inpc').valor)}</b></span>`;
    $('#ind-mini').onclick = () => U.modal({ titulo: 'Indicadores', cuerpo: lista.map((i) => `<div class="ind-fila"><div>${U.esc(i.etiqueta)}<small>${U.esc(i.unidad)} · ${U.esc(i.fecha)}</small></div><div class="v">${U.esc(i.valor)}<br><a href="${U.esc(i.url)}" target="_blank" rel="noopener">${U.esc(i.fuente)} ↗</a></div></div>`).join('') + `<p class="ind-pie">Consultados el ${U.fecha(D.consultado)}. Verifica en la fuente antes de usarlos en un cálculo oficial.</p>` });
  }

  /* ── Landing ─────────────────────────────────────────────── */
  const FUNCIONES = [
    { ic: 'home', t: 'Dashboard de indicadores', d: 'Ingresos, gastos, IVA preliminar, errores y pendientes del periodo, con gráfica de 12 meses.', e: 'ok', c: 'c4 oscura' },
    { ic: 'file', t: 'Análisis de facturas', d: 'Lee XML 3.3 y 4.0, nómina y pagos. Valida RFC, sumas, IVA, forma y método de pago.', e: 'ok', c: 'c2' },
    { ic: 'alert', t: 'Errores en CFDI', d: 'Cada factura muestra qué no cuadra y por qué, para pedir corrección a tiempo.', e: 'ok', c: 'c2' },
    { ic: 'clock', t: 'Pagos PPD pendientes', d: 'Facturas PPD sin complemento: cuáles debes emitir y cuáles debes recibir.', e: 'ok', c: 'c2' },
    { ic: 'percent', t: 'Cálculo de IVA', d: 'IVA trasladado cobrado, acreditable pagado y retenciones del periodo.', e: 'ok', c: 'c2' },
    { ic: 'book', t: 'Movimientos y asientos', d: 'Pólizas de ingreso, egreso y diario con cuadre automático; pólizas sugeridas desde un CFDI.', e: 'ok', c: 'c3' },
    { ic: 'excel', t: 'Exportación a Excel', d: 'CFDIs, pólizas, balanza de comprobación, IVA, pendientes y catálogo.', e: 'ok', c: 'c3' },
    { ic: 'shield', t: 'Consulta de EFOS (69-B)', d: 'Cruza a tus clientes y proveedores contra la lista del SAT.', e: 'ok', c: 'c2' },
    { ic: 'x', t: 'CFDIs cancelados', d: 'Verificación en el portal del SAT con un clic y detección desde los archivos del SAT.', e: 'ok', c: 'c2' },
    { ic: 'paperclip', t: 'Materialidad', d: 'Adjunta contratos, evidencias y entregables a cada operación.', e: 'ok', c: 'c2' },
    { ic: 'git', t: 'Conciliación con visores SAT', d: 'Compara el archivo del visor de ingresos o nómina contra tus CFDI.', e: 'ok', c: 'c3' },
    { ic: 'users', t: 'Portal Contador', d: 'Varias empresas en una cuenta, con colaboradores y roles.', e: 'ok', c: 'c3' },
    { ic: 'plus-file', t: 'Crear CFDI', d: 'Captura tu factura 4.0 y descarga el XML. El timbrado requiere conectar un PAC.', e: 'parcial', c: 'c2' },
    { ic: 'sync', t: 'Sincronización diaria con el SAT', d: 'Descarga masiva automática con e.firma.', e: 'pend', c: 'c2' },
    { ic: 'sync', t: 'Sincronización con COI', d: 'Envío de pólizas a Aspel COI.', e: 'pend', c: 'c2' }
  ];
  const ESTADO = { ok: '<span class="chip ok"><span class="punto"></span>Disponible</span>', parcial: '<span class="chip aviso"><span class="punto"></span>Parcial</span>', pend: '<span class="chip gris"><span class="punto"></span>En desarrollo</span>' };

  function landing() {
    $('#bento').innerHTML = FUNCIONES.map((f) => `<div class="celda ${f.c}"><span class="estado">${ESTADO[f.e]}</span><div class="ic">${U.ico(f.ic)}</div><h3>${f.t}</h3><p>${f.d}</p></div>`).join('');

    $('#planes-lista').innerHTML = CFG.PLANES.map((p) => `
      <div class="plan ${p.popular ? 'top' : ''}">
        ${p.popular ? '<span class="cinta chip" style="background:var(--cielo);color:var(--rey-900)">Más elegido</span>' : ''}
        <h3>${p.nombre}</h3><p class="pdesc">${p.desc}</p>
        <div class="precio"><b>$${p.precio.toLocaleString('es-MX')}</b><span>MXN / mes</span></div><div class="iva">Más IVA</div>
        <ul>
          <li>${U.ico('check')}${/^ilim/i.test(p.filas.empresas) ? 'Empresas ilimitadas' : p.filas.empresas + (p.filas.empresas === '1' ? ' empresa' : ' empresas')}</li>
          <li>${U.ico('check')}${/^ilim/i.test(p.filas.cfdis) ? 'CFDIs ilimitados' : p.filas.cfdis + ' CFDIs al mes'}</li>
          <li>${U.ico('check')}${/^ilim/i.test(p.filas.usuarios) ? 'Usuarios ilimitados' : p.filas.usuarios + (p.filas.usuarios === '1' ? ' usuario' : ' usuarios')}</li>
          <li>${U.ico('check')}Sincronización SAT: ${p.filas.sync}</li>
          <li class="${p.filas.portal ? '' : 'no'}">${U.ico(p.filas.portal ? 'check' : 'x')}Portal Contador</li>
          <li class="${p.filas.coi ? '' : 'no'}">${U.ico(p.filas.coi ? 'check' : 'x')}Sincronización con COI</li>
          <li>${U.ico('check')}Soporte ${p.filas.soporte.toLowerCase()}</li>
        </ul>
        <a class="btn ${p.popular ? 'btn-blanco' : 'btn-pri'} btn-g" href="#/registro?plan=${p.id}">Empezar con ${p.nombre}</a>
      </div>`).join('');
    const filas = [['Empresas', 'empresas'], ['CFDIs por mes', 'cfdis'], ['Usuarios', 'usuarios'], ['Sincronización SAT', 'sync'], ['Sincronización COI', 'coi'], ['Portal Contador', 'portal'], ['Soporte', 'soporte']];
    const celda = (v) => v === true ? `<span style="color:var(--ok)">${U.ico('check')}</span>` : v === false ? '<span style="color:var(--gris-2)">—</span>' : U.esc(v);
    $('#tabla-comp').innerHTML = `<thead><tr><th>Comparativa</th>${CFG.PLANES.map((p) => `<th>${p.nombre}<br><small style="font-weight:500;color:var(--gris)">$${p.precio.toLocaleString('es-MX')}/mes + IVA</small></th>`).join('')}</tr></thead><tbody>` +
      filas.map(([t, k]) => `<tr><td>${t}</td>${CFG.PLANES.map((p) => `<td>${celda(p.filas[k])}</td>`).join('')}</tr>`).join('') + '</tbody>';
    $$('#tabla-comp svg').forEach((s) => { s.style.width = '18px'; s.style.height = '18px'; });

    renderNoticias($('#noticias-lista'));
    $('#noticias-fecha').textContent = 'Selección consultada el ' + U.fecha(window.CONTRIX_DATOS.consultado) + '. Cada nota enlaza a su fuente original.';
    $('#anio').textContent = new Date().getFullYear();

    // Navegación por anclas sin romper el enrutador
    $$('[data-ancla]').forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      if (!location.hash.startsWith('#/') || location.hash.length > 2) history.replaceState(null, '', '#/');
      mostrar('v-landing');
      const destino = document.querySelector(a.getAttribute('href'));
      if (destino) destino.scrollIntoView({ behavior: 'smooth' });
      $('#nav').classList.remove('abierto');
    }));
    $('#nav-menu').onclick = () => $('#nav').classList.toggle('abierto');

    // Analizador de CFDI de la portada (funciona sin cuenta)
    U.zonaCarga($('#zona-xml'), async (archivos) => {
      const f = archivos.find((a) => /\.xml$/i.test(a.name)) || archivos[0];
      if (!f) return;
      const caja = $('#revisiones'), res = $('#analizador-res');
      try {
        const d = CFDI.leer(await f.text());
        const vals = CFDI.validar(d);
        caja.innerHTML = vals.slice(0, 7).map((v, i) => `<div class="revision ${v.nivel}" style="animation-delay:${i * 0.08}s"><span class="ico">${U.ico(v.nivel === 'ok' ? 'check' : v.nivel === 'error' ? 'x' : 'alert')}</span>${U.esc(v.msg)}</div>`).join('');
        res.classList.remove('oculto');
        res.innerHTML = `<div><small>Tipo</small><b>${U.esc(SAT.tipoComprobante[d.tipo] || d.tipo)}</b></div><div><small>Total</small><b>${U.dinero(d.total, d.moneda)}</b></div><div><small>IVA</small><b>${U.dinero(d.iva_trasladado, d.moneda)}</b></div>`;
      } catch (e) {
        caja.innerHTML = `<div class="revision error"><span class="ico">${U.ico('x')}</span>${U.esc(e.message)}</div>`;
        res.classList.add('oculto');
      }
    });
  }

  function renderNoticias(cont, lista) {
    const ns = (lista || window.CONTRIX_DATOS.noticias).slice().sort((a, b) => b.fecha.localeCompare(a.fecha));
    cont.innerHTML = ns.map((n) => `
      <article class="noticia">
        <div class="meta"><span class="chip">${U.esc(n.categoria)}</span><span>${U.fecha(n.fecha)}</span></div>
        <h3>${U.esc(n.titulo)}</h3>
        <p>${U.esc(n.resumen)}</p>
        <div class="fuente"><span>Fuente: <b>${U.esc(n.fuente)}</b></span><a href="${U.esc(n.url)}" target="_blank" rel="noopener">Leer original ${U.ico('ext')}</a></div>
      </article>`).join('');
  }
  U.renderNoticias = renderNoticias;

  /* ── Vistas y enrutador ──────────────────────────────────── */
  function mostrar(id) {
    $$('.vista').forEach((v) => v.classList.toggle('activa', v.id === id));
    $('#widget-ind').classList.toggle('oculto', id !== 'v-landing');
  }

  function parsearHash() {
    const h = location.hash || '#/';
    const [ruta, qs] = h.split('?');
    return { ruta, params: new URLSearchParams(qs || '') };
  }

  async function enrutar() {
    const { ruta, params } = parsearHash();
    if (!ruta.startsWith('#/')) { mostrar('v-landing'); return; }
    const partes = ruta.slice(2).split('/');

    if (partes[0] === '' ) { mostrar('v-landing'); window.scrollTo(0, 0); return; }
    if (['login', 'registro', 'recuperar', 'nueva-contrasena'].includes(partes[0])) {
      if (C.usuario && partes[0] !== 'nueva-contrasena' && !C.cambiandoPass) { location.hash = '#/app/inicio'; return; }
      return vistaAuth(partes[0], params);
    }
    if (partes[0] === 'onboarding') {
      if (!C.usuario) { location.hash = '#/login'; return; }
      return vistaOnboarding();
    }
    if (partes[0] === 'app') {
      if (!C.usuario) { location.hash = '#/login'; return; }
      if (!C.empresas.length) { location.hash = '#/onboarding'; return; }
      return vistaApp(partes[1] || 'inicio', params);
    }
    mostrar('v-landing');
  }

  /* ── Acceso ──────────────────────────────────────────────── */
  function msg(id, texto, tipo = 'error') { const m = $('#' + id); m.className = 'msg ver ' + tipo; m.textContent = texto; }
  function limpiarMsg(id) { $('#' + id).className = 'msg'; }
  function urlBase() { return location.protocol.startsWith('http') ? location.origin + location.pathname : null; }

  function vistaAuth(tipo, params) {
    mostrar('v-auth');
    ['f-login', 'f-registro', 'f-recuperar', 'f-nueva'].forEach((f) => $('#' + f).classList.add('oculto'));
    const mapa = { login: 'f-login', registro: 'f-registro', recuperar: 'f-recuperar', 'nueva-contrasena': 'f-nueva' };
    $('#' + mapa[tipo]).classList.remove('oculto');
    if (tipo === 'recuperar' && !C.cambiandoPass) pasoRecuperar(1);
    if (tipo === 'registro') {
      $('#r-plan').innerHTML = CFG.PLANES.map((p) => `<option value="${p.id}">${p.nombre} — $${p.precio.toLocaleString('es-MX')} MXN/mes + IVA</option>`).join('');
      if (params.get('plan')) $('#r-plan').value = params.get('plan');
    }
    if (!urlBase() && (tipo === 'registro' || tipo === 'recuperar')) {
      msg(tipo === 'registro' ? 'm-registro' : 'm-recuperar', 'Estás abriendo Contrix como archivo local. Para que funcionen los enlaces de confirmación por correo, ábrelo desde un servidor (ver LEEME.md).', 'info');
    }
  }

  function enviando(form, si) { const b = form.querySelector('button[type=submit]'); b.classList.toggle('cargando', si); b.disabled = si; }

  $('#f-login').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target; limpiarMsg('m-login');
    const email = $('#l-email').value.trim(), password = $('#l-pass').value;
    if (!email || !password) return msg('m-login', 'Escribe tu correo y contraseña.');
    enviando(f, true);
    const { error } = await C.sb.auth.signInWithPassword({ email, password });
    enviando(f, false);
    if (error) return msg('m-login', U.errorMsg(error));
    $('#l-pass').value = '';
  });

  $('#f-registro').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target; limpiarMsg('m-registro');
    const nombre = $('#r-nombre').value.trim(), email = $('#r-email').value.trim(), password = $('#r-pass').value;
    if (!nombre || !email) return msg('m-registro', 'Completa nombre y correo.');
    if (password.length < 8) return msg('m-registro', 'La contraseña debe tener al menos 8 caracteres.');
    enviando(f, true);
    const opciones = { data: { nombre, plan_interes: $('#r-plan').value } };
    if (urlBase()) opciones.emailRedirectTo = urlBase();
    const { data, error } = await C.sb.auth.signUp({ email, password, options: opciones });
    enviando(f, false);
    if (error) return msg('m-registro', U.errorMsg(error));
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) return msg('m-registro', 'Ya existe una cuenta con ese correo. Inicia sesión.');
    if (!data.session) {
      f.reset();
      msg('m-registro', 'Te enviamos un correo a ' + email + '. Abre el enlace para confirmar tu cuenta y después inicia sesión.', 'ok');
    }
  });

  /* Recuperar contraseña con código enviado al correo */
  function validarNueva(p1, p2, idMsg) {
    if (p1.length < 8) { msg(idMsg, 'La contraseña debe tener al menos 8 caracteres.'); return false; }
    if (p1 !== p2) { msg(idMsg, 'Las contraseñas no coinciden. Escríbelas igual en los dos campos.'); return false; }
    return true;
  }
  let rcEspera = 0, rcTimer = null;
  function contadorReenvio() {
    const a = $('#rc-reenviar'); clearInterval(rcTimer); rcEspera = 60;
    const pintar = () => { a.textContent = rcEspera > 0 ? `Reenviar código (${rcEspera}s)` : 'Reenviar código'; a.style.pointerEvents = rcEspera > 0 ? 'none' : ''; a.style.opacity = rcEspera > 0 ? '.6' : ''; };
    pintar(); rcTimer = setInterval(() => { rcEspera--; pintar(); if (rcEspera <= 0) clearInterval(rcTimer); }, 1000);
  }
  function pasoRecuperar(n) {
    $('#rc-paso1').classList.toggle('oculto', n !== 1);
    $('#rc-paso2').classList.toggle('oculto', n !== 2);
    $('#rc-sub').textContent = n === 1 ? 'Te enviaremos un código a tu correo para crear una contraseña nueva.' : 'Escribe el código que te enviamos a ' + $('#rc-email').value.trim() + ' y tu contraseña nueva.';
    if (n === 2) setTimeout(() => $('#rc-codigo').focus(), 50);
  }
  U.pasoRecuperar = pasoRecuperar;
  async function enviarCodigo() {
    const email = $('#rc-email').value.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) { msg('m-recuperar', 'Escribe un correo válido.'); return false; }
    const { error } = await C.sb.auth.resetPasswordForEmail(email, urlBase() ? { redirectTo: urlBase() } : undefined);
    if (error) { msg('m-recuperar', U.errorMsg(error)); return false; }
    msg('m-recuperar', 'Si existe una cuenta con ese correo, te llegará un código en unos momentos.', 'ok');
    contadorReenvio();
    return true;
  }
  $('#f-recuperar').addEventListener('submit', async (e) => {
    e.preventDefault(); limpiarMsg('m-recuperar');
    const b = $('#rc-enviar'); b.classList.add('cargando'); b.disabled = true;
    const ok = await enviarCodigo();
    b.classList.remove('cargando'); b.disabled = false;
    if (ok) pasoRecuperar(2);
  });
  $('#rc-reenviar').onclick = async () => { if (rcEspera > 0) return; limpiarMsg('m-recuperar'); await enviarCodigo(); };
  $('#rc-otro').onclick = () => { limpiarMsg('m-recuperar'); clearInterval(rcTimer); rcEspera = 0; pasoRecuperar(1); };
  $('#rc-codigo').addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, ''); });
  $('#rc-cambiar').onclick = async () => {
    limpiarMsg('m-recuperar');
    const email = $('#rc-email').value.trim(), token = $('#rc-codigo').value.trim();
    const p1 = $('#rc-pass').value, p2 = $('#rc-pass2').value;
    if (!/^\d{6,10}$/.test(token)) return msg('m-recuperar', 'Escribe el código completo que llegó a tu correo (solo números).');
    if (!validarNueva(p1, p2, 'm-recuperar')) return;
    const b = $('#rc-cambiar'); b.classList.add('cargando'); b.disabled = true;
    C.cambiandoPass = true;
    try {
      const { error } = await C.sb.auth.verifyOtp({ email, token, type: 'recovery' });
      if (error) throw new Error(/expired|invalid|otp/i.test(error.message) ? 'El código no es válido o ya expiró. Pide uno nuevo con "Reenviar código".' : U.errorMsg(error));
      const r = await C.sb.auth.updateUser({ password: p1 });
      if (r.error) throw new Error(/same|different from the old/i.test(r.error.message) ? 'La contraseña nueva debe ser distinta a la anterior.' : U.errorMsg(r.error));
      ['rc-codigo', 'rc-pass', 'rc-pass2'].forEach((id) => { $('#' + id).value = ''; });
      pasoRecuperar(1);
      C.cambiandoPass = false;
      U.aviso('Contraseña actualizada. Ya iniciaste sesión.', 'ok');
      if (!C.perfil) await cargarUsuario();
      location.hash = C.empresas.length ? '#/app/inicio' : '#/onboarding';
    } catch (err) {
      C.cambiandoPass = false;
      msg('m-recuperar', err.message);
    }
    b.classList.remove('cargando'); b.disabled = false;
  };

  $('#f-nueva').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target; limpiarMsg('m-nueva');
    const p1 = $('#n-pass').value, p2 = $('#n-pass2').value;
    if (!validarNueva(p1, p2, 'm-nueva')) return;
    enviando(f, true);
    const { error } = await C.sb.auth.updateUser({ password: p1 });
    enviando(f, false);
    if (error) return msg('m-nueva', /same|different from the old/i.test(error.message) ? 'La contraseña nueva debe ser distinta a la anterior.' : U.errorMsg(error));
    $('#n-pass').value = ''; $('#n-pass2').value = '';
    C.recuperando = false;
    U.aviso('Contraseña actualizada', 'ok');
    if (!C.perfil) await cargarUsuario();
    location.hash = C.empresas.length ? '#/app/inicio' : '#/onboarding';
  });

  /* ── Carga de datos del usuario ─────────────────────────── */
  async function cargarUsuario() {
    const uid = C.usuario.id;
    let { data: perfil } = await C.sb.from('profiles').select('*').eq('id', uid).maybeSingle();
    if (!perfil) {
      // Respaldo por si el trigger de alta no creó el perfil
      const nombre = C.usuario.user_metadata?.nombre || C.usuario.email.split('@')[0];
      const r = await C.sb.from('profiles').insert({ id: uid, email: C.usuario.email, nombre }).select().single();
      perfil = r.data || { id: uid, email: C.usuario.email, nombre, plan: 'pymes' };
    }
    C.perfil = perfil;
    await cargarEmpresas();
  }

  async function cargarEmpresas() {
    const { data, error } = await C.sb.from('empresas').select('*').eq('activo', true).order('razon_social');
    if (error) { U.aviso(U.errorMsg(error), 'error'); C.empresas = []; return; }
    C.empresas = data || [];
    const guardada = U.leerLocal('empresa');
    C.empresa = C.empresas.find((e) => e.id === guardada) || C.empresas[0] || null;
  }
  U.cargarEmpresas = cargarEmpresas;

  /* ── Alta de empresa ─────────────────────────────────────── */
  function vistaOnboarding() {
    mostrar('v-onboarding');
    const sel = $('#f-empresa [name=regimen_fiscal]');
    if (!sel.options.length) sel.innerHTML = '<option value="">Selecciona…</option>' + Object.entries(SAT.regimen).map(([k, v]) => `<option value="${k}">${k} — ${v}</option>`).join('');
  }

  async function crearEmpresa(datos, cargarCatalogo) {
    const rfc = datos.rfc.trim().toUpperCase();
    if (!CFDI.RFC_RE.test(rfc)) throw new Error('El RFC no tiene un formato válido (12 caracteres para personas morales, 13 para físicas).');
    if (!/^\d{5}$/.test(datos.codigo_postal || '')) throw new Error('El código postal debe tener 5 dígitos.');
    if (!datos.razon_social?.trim()) throw new Error('Escribe la razón social.');
    if (!datos.regimen_fiscal) throw new Error('Selecciona el régimen fiscal.');
    const { data, error } = await C.sb.from('empresas').insert({
      owner_id: C.usuario.id, rfc, razon_social: datos.razon_social.trim().toUpperCase(),
      nombre_comercial: datos.nombre_comercial?.trim() || null, regimen_fiscal: datos.regimen_fiscal,
      codigo_postal: datos.codigo_postal, email_contacto: C.usuario.email
    }).select().single();
    if (error) throw error;
    await C.sb.from('miembros_empresa').insert({ empresa_id: data.id, user_id: C.usuario.id, rol: 'admin', invitado_por: C.usuario.id });
    if (cargarCatalogo) await U.cargarCatalogoBase(data.id);
    return data;
  }
  U.crearEmpresa = crearEmpresa;

  U.cargarCatalogoBase = async function (empresaId) {
    const filas = SAT.catalogoBase.map(([numero, descripcion, codigo_sat, nivel, naturaleza, tipo]) => ({ empresa_id: empresaId, numero, descripcion, codigo_sat, nivel, naturaleza, tipo }));
    const { data: nuevas, error } = await C.sb.from('catalogo_cuentas').upsert(filas, { onConflict: 'empresa_id,numero', ignoreDuplicates: true }).select('id,numero');
    if (error) throw error;
    // Enlaza las cuentas recién creadas con su cuenta padre (por número)
    const { data: todas } = await C.sb.from('catalogo_cuentas').select('id,numero').eq('empresa_id', empresaId);
    const porNumero = Object.fromEntries((todas || []).map((c) => [c.numero, c.id]));
    const creadas = new Set((nuevas || []).map((c) => c.numero));
    const conPadre = filas.filter((f) => creadas.has(f.numero)).map((f) => {
      const padre = f.numero.includes('-') ? f.numero.split('-')[0] : (f.nivel === 2 ? f.numero[0] + '00' : null);
      return padre && porNumero[padre] ? { ...f, cuenta_padre: porNumero[padre] } : null;
    }).filter(Boolean);
    if (conPadre.length) {
      const r = await C.sb.from('catalogo_cuentas').upsert(conPadre, { onConflict: 'empresa_id,numero' });
      if (r.error) throw r.error;
    }
    return (nuevas || []).length;
  };

  $('#f-empresa').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target; limpiarMsg('m-onb');
    const datos = Object.fromEntries(new FormData(f));
    enviando(f, true);
    try {
      const emp = await crearEmpresa(datos, !!datos.catalogo_base);
      await cargarEmpresas();
      C.empresa = C.empresas.find((x) => x.id === emp.id) || C.empresa;
      U.guardarLocal('empresa', C.empresa?.id);
      U.aviso('Empresa registrada', 'ok');
      location.hash = '#/app/inicio';
    } catch (err) { msg('m-onb', U.errorMsg(err)); }
    enviando(f, false);
  });
  $('#onb-salir').onclick = () => C.sb.auth.signOut();

  /* ── Estructura de la app ────────────────────────────────── */
  const MENU = [
    { g: 'General', items: [['inicio', 'Panel', 'home'], ['noticias', 'Noticias', 'news']] },
    { g: 'Comprobantes', items: [['cfdis', 'CFDIs', 'file'], ['emitir', 'Crear CFDI', 'plus-file'], ['pagos', 'Pagos PPD', 'clock'], ['materialidad', 'Materialidad', 'paperclip']] },
    { g: 'Contabilidad', items: [['polizas', 'Pólizas', 'book'], ['catalogo', 'Catálogo de cuentas', 'list'], ['reportes', 'Balanza y reportes', 'scale']] },
    { g: 'Fiscal', items: [['iva', 'Cálculo de IVA', 'percent'], ['efos', 'EFOS (69-B)', 'shield'], ['conciliacion', 'Conciliación SAT', 'git'], ['sat', 'Sincronización SAT', 'sync']] },
    { g: 'Despacho', items: [['portal', 'Portal Contador', 'users'], ['coi', 'Sincronización COI', 'sync']] },
    { g: 'Cuenta', items: [['plan', 'Plan y pagos', 'card'], ['config', 'Configuración', 'gear']] }
  ];
  U.MENU = MENU;
  const SIN_BLOQUEO = ['plan', 'config', 'noticias'];

  function armarApp() {
    $('#menu-app').innerHTML = MENU.map((g) => `<div class="grupo-nav"><h6>${g.g}</h6>${g.items.map(([id, t, ic]) => `<a class="enl" href="#/app/${id}" data-mod="${id}">${U.ico(ic)}<span>${t}</span><span class="cuenta oculto" data-cuenta="${id}"></span></a>`).join('')}</div>`).join('');
    $('#menu-app').addEventListener('click', (e) => { if (e.target.closest('.enl')) $('#app').classList.remove('menu'); });

    $('#sel-mes').innerHTML = '<option value="0">Todo el año</option>' + U.MESES.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('');
    const anioAct = new Date().getFullYear();
    $('#sel-anio').innerHTML = Array.from({ length: 7 }, (_, i) => anioAct - i).map((a) => `<option>${a}</option>`).join('');
    const per = U.leerLocal('periodo'); if (per && per.anio) C.periodo = per;
    $('#sel-mes').value = C.periodo.mes; $('#sel-anio').value = C.periodo.anio;
    const cambiarPeriodo = () => { C.periodo = { anio: +$('#sel-anio').value, mes: +$('#sel-mes').value }; U.guardarLocal('periodo', C.periodo); renderModulo(); };
    $('#sel-mes').onchange = cambiarPeriodo; $('#sel-anio').onchange = cambiarPeriodo;
    $('#sel-empresa').onchange = () => { C.empresa = C.empresas.find((e) => e.id === $('#sel-empresa').value); U.guardarLocal('empresa', C.empresa?.id); renderModulo(); };

    $('#btn-lateral').onclick = () => $('#app').classList.toggle('menu');
    $('#avatar').onclick = (e) => { e.stopPropagation(); $('#menu-usuario').classList.toggle('ver'); };
    document.addEventListener('click', (e) => { if (!e.target.closest('#menu-usuario')) $('#menu-usuario').classList.remove('ver'); });
    C.appArmada = true;
  }

  function refrescarCabecera() {
    $('#sel-empresa').innerHTML = C.empresas.map((e) => `<option value="${e.id}">${U.esc(e.nombre_comercial || e.razon_social)} · ${U.esc(e.rfc)}</option>`).join('');
    if (C.empresa) $('#sel-empresa').value = C.empresa.id;
    const nombre = C.perfil?.nombre || C.usuario.email;
    $('#avatar').textContent = nombre.trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
    $('#menu-usuario').innerHTML = `<div class="yo"><b>${U.esc(nombre)}</b><small>${U.esc(C.usuario.email)}</small></div>
      <a href="#/app/config">${U.ico('gear')}Configuración</a><a href="#/app/plan">${U.ico('card')}Plan y pagos</a><a href="#/">${U.ico('home')}Ir a la portada</a><a id="salir">${U.ico('logout')}Cerrar sesión</a>`;
    $('#salir').onclick = () => C.sb.auth.signOut();
    const plan = U.planActual(), ac = U.acceso();
    const estado = ac.tipo === 'prueba' ? `Prueba: ${ac.dias} día${ac.dias === 1 ? '' : 's'} restantes` : ac.tipo === 'suscripcion' ? 'Suscripción activa' : ac.tipo === 'atraso' ? 'Pago pendiente' : 'Sin suscripción activa';
    $('#tarjeta-plan').innerHTML = `<b>Plan ${plan.nombre}</b><small>${estado}</small><a class="btn btn-vidrio btn-c" style="width:100%;margin-top:10px" href="#/app/plan">${ac.tipo === 'suscripcion' ? 'Administrar' : 'Ver planes'}</a>`;
  }
  U.refrescarCabecera = refrescarCabecera;

  async function vistaApp(mod, params) {
    mostrar('v-app');
    if (!C.appArmada) armarApp();
    refrescarCabecera();
    C.modulo = mod; C.params = params;
    renderModulo();
  }

  async function renderModulo() {
    const mod = C.modulo;
    const item = MENU.flatMap((g) => g.items).find((i) => i[0] === mod);
    $$('.enl').forEach((a) => a.classList.toggle('activo', a.dataset.mod === mod));
    $('#titulo-mod').textContent = item ? item[1] : 'Contrix';
    const cont = $('#contenido');
    U.destruirGraficas();
    const ac = U.acceso();
    let banner = '';
    if (ac.tipo === 'prueba' && ac.dias <= 7) banner = `<div class="banner aviso">${U.ico('clock')}<span>Tu prueba termina en ${ac.dias} día${ac.dias === 1 ? '' : 's'}. Elige un plan para no perder el acceso.</span><a class="btn btn-sec btn-c" href="#/app/plan">Ver planes</a></div>`;
    if (ac.tipo === 'atraso') banner = `<div class="banner error">${U.ico('alert')}<span>No pudimos cobrar tu suscripción. Actualiza tu tarjeta.</span><a class="btn btn-sec btn-c" href="#/app/plan">Actualizar</a></div>`;
    if (!ac.ok && !SIN_BLOQUEO.includes(mod)) {
      cont.innerHTML = `<div class="bloqueo">${U.ico('lock')}<h3>${ac.tipo === 'prueba_vencida' ? 'Tu periodo de prueba terminó' : 'Tu suscripción no está activa'}</h3><p>Tus datos siguen guardados. Elige un plan para seguir usando Contrix.</p><a class="btn btn-pri btn-g" href="#/app/plan">Elegir plan</a></div>`;
      return;
    }
    const fn = window.MODULOS && window.MODULOS[mod];
    if (!fn) { cont.innerHTML = U.vacio('info', 'Sección no encontrada', 'Elige una opción del menú.'); return; }
    cont.innerHTML = banner + '<div id="mod"><div class="vacio"><p>Cargando…</p></div></div>';
    try { await fn($('#mod'), C.params || new URLSearchParams()); }
    catch (e) { console.error(e); $('#mod').innerHTML = `<div class="banner error">${U.ico('alert')}<span>${U.esc(U.errorMsg(e))}</span></div>`; }
    window.scrollTo(0, 0);
  }
  U.renderModulo = renderModulo;

  /* ── Arranque ────────────────────────────────────────────── */
  async function iniciar() {
    landing();
    indicadores();
    $('#capa').addEventListener('click', (e) => { if (e.target.id === 'capa') U.cerrarModal(); });

    if (!C.sb) {
      $('#carga-pantalla').remove();
      enrutar();
      U.aviso('No se pudo conectar con el servidor de Contrix.', 'error');
      return;
    }

    C.sb.auth.onAuthStateChange(async (evento, sesion) => {
      if (evento === 'PASSWORD_RECOVERY') { if (C.cambiandoPass) return; C.recuperando = true; C.sesion = sesion; C.usuario = sesion?.user || null; location.hash = '#/nueva-contrasena'; return; }
      if (evento === 'SIGNED_IN' && sesion && (!C.usuario || C.usuario.id !== sesion.user.id)) {
        C.sesion = sesion; C.usuario = sesion.user;
        setTimeout(async () => {
          await cargarUsuario(); indicadores();
          if (C.recuperando || C.cambiandoPass) return;
          const { ruta } = parsearHash();
          if (!ruta.startsWith('#/app')) location.hash = C.empresas.length ? '#/app/inicio' : '#/onboarding';
          else enrutar();
        }, 0);
      }
      if (evento === 'SIGNED_OUT') {
        C.sesion = null; C.usuario = null; C.perfil = null; C.empresas = []; C.empresa = null;
        location.hash = '#/';
      }
    });

    const { data } = await C.sb.auth.getSession();
    if (data.session) { C.sesion = data.session; C.usuario = data.session.user; await cargarUsuario(); }
    window.addEventListener('hashchange', enrutar);
    $('#carga-pantalla').remove();
    enrutar();
  }
  U.mostrar = mostrar;
  document.addEventListener('DOMContentLoaded', iniciar);
})();
