/* ════════════════════════════════════════════════════════════
   CONTRIX — Indicadores y noticias
   Consultados el 3 de octubre de 2026. Cada dato lleva su fuente.
   Para actualizar: cambia los valores y la fecha de consulta, o
   carga filas en las tablas "indicadores_economicos" y "noticias"
   de Supabase (si existen, la web usa las más recientes).

   Aviso de derechos de autor: los resúmenes de noticias son
   redacción propia de Contrix; no reproducen el texto original.
   Siempre se enlaza a la fuente.
   ════════════════════════════════════════════════════════════ */
window.CONTRIX_DATOS = {
  consultado: '2026-10-03',

  indicadores: [
    { id: 'usd',  etiqueta: 'Dólar FIX', valor: '$18.1903', unidad: 'MXN por USD',
      fecha: '02/10/2026', fuente: 'Banxico',
      url: 'https://www.banxico.org.mx/apps/dao-web/4/52/Fix48.html' },
    { id: 'inpc', etiqueta: 'INPC agosto 2026', valor: '145.462', unidad: 'Índice mensual',
      fecha: 'Publicado 09/09/2026', fuente: 'INEGI',
      url: 'https://www.razon.com.mx/negocios/2026/09/09/inflacion-en-agosto-de-2026-se-ubica-en-326-inegi/' },
    { id: 'inpcq', etiqueta: 'INPC 1ª quincena sep.', valor: '146.010', unidad: 'Índice quincenal',
      fecha: 'Publicado 24/09/2026', fuente: 'INEGI',
      url: 'https://www.inegi.org.mx/contenidos/saladeprensa/boletines/2026/inpc/inpc_1q2026_09.pdf' },
    { id: 'infl', etiqueta: 'Inflación anual', valor: '3.42%', unidad: '1ª quincena sep. 2026',
      fecha: 'Publicado 24/09/2026', fuente: 'INEGI',
      url: 'https://www.inegi.org.mx/contenidos/saladeprensa/boletines/2026/inpc/inpc_1q2026_09.pdf' },
    { id: 'tasa', etiqueta: 'Tasa objetivo', valor: '6.50%', unidad: 'Banxico',
      fecha: 'Decisión 24/09/2026', fuente: 'El Financiero',
      url: 'https://www.elfinanciero.com.mx/economia/2026/09/24/tasa-del-banxico-hoy-24-de-septiembre-2026-en-cuanto-quedo/' },
    { id: 'udi',  etiqueta: 'UDI', valor: '8.839901', unidad: 'Pesos por UDI',
      fecha: '03/10/2026', fuente: 'DOF',
      url: 'https://dof.gob.mx/indicadores.php' }
  ],

  noticias: [
    { fecha: '2026-10-01', categoria: 'SAT', titulo: 'Sigue vigente el Programa de Regularización Fiscal 2026',
      resumen: 'El SAT y la ANAM mantienen la condonación de hasta el 100% de multas, recargos y gastos de ejecución para adeudos de 2024 o anteriores. Aplica a contribuyentes que reportaron ingresos de hasta 300 millones de pesos en 2024 y que no han recibido condonaciones previas.',
      fuente: 'El Imparcial', url: 'https://www.elimparcial.com/dinero/2026/10/01/el-sat-condona-hasta-100-de-multas-y-recargos-a-contribuyentes-con-deudas-de-2024-o-anteriores-que-ganaron-menos-de-300-millones-de-pesos/' },
    { fecha: '2026-09-24', categoria: 'Banxico', titulo: 'Banxico mantiene su tasa objetivo en 6.50%',
      resumen: 'La Junta de Gobierno decidió por unanimidad dejar la tasa sin cambios. Señaló que la inflación de servicios baja lentamente y que su política no tiene que reaccionar de forma mecánica a las decisiones de la Reserva Federal.',
      fuente: 'El Financiero', url: 'https://www.elfinanciero.com.mx/economia/2026/09/24/tasa-del-banxico-hoy-24-de-septiembre-2026-en-cuanto-quedo/' },
    { fecha: '2026-09-24', categoria: 'INEGI', titulo: 'Inflación anual sube a 3.42% en la 1ª quincena de septiembre',
      resumen: 'El INPC se ubicó en 146.010 puntos, 0.33% más que la quincena previa. La inflación subyacente anual fue de 3.79%. Entre los productos con mayores alzas estuvieron jitomate, cebolla y pollo.',
      fuente: 'INEGI', url: 'https://www.inegi.org.mx/contenidos/saladeprensa/boletines/2026/inpc/inpc_1q2026_09.pdf' },
    { fecha: '2026-09-11', categoria: 'Hacienda', titulo: 'Paquete Económico 2027: principales propuestas fiscales',
      resumen: 'Hacienda lo presentó el 8 de septiembre. Propone bajar la retención anual sobre intereses de 0.90% a 0.68%, limitar la amortización de pérdidas al 50% de la utilidad fiscal, bajar el tope de intereses netos deducibles de 30% a 20% y subir los límites del RESICO (personas físicas de 3.5 a 5 mdp; morales de 35 a 50 mdp). Es una iniciativa: aún no está aprobada.',
      fuente: 'BDO México', url: 'https://www.bdomexico.com/es-mx/publicaciones/boletines-fiscales/boletin-fiscal-informativo-2026/paquete-economico-2027' },
    { fecha: '2026-09-09', categoria: 'INEGI', titulo: 'INPC de agosto 2026: inflación anual de 3.26%',
      resumen: 'El índice mensual de agosto se ubicó en 145.462 puntos, un alza de 0.20% respecto a julio. La inflación subyacente anual fue de 3.88%.',
      fuente: 'La Razón', url: 'https://www.razon.com.mx/negocios/2026/09/09/inflacion-en-agosto-de-2026-se-ubica-en-326-inegi/' },
    { fecha: '2026-09-08', categoria: 'CFF', titulo: 'Miscelánea 2027 propone más fiscalización con análisis de datos',
      resumen: 'Según el análisis del despacho, la iniciativa daría al SAT base legal expresa para usar análisis masivo de datos e inteligencia artificial en revisiones electrónicas, y ampliaría las revisiones a quienes hayan tenido proveedores en la lista 69-B. Pendiente de aprobación del Congreso.',
      fuente: 'Carbajal Contadores', url: 'https://carbajalcontadores.com/2026/09/08/miscelanea-fiscal-2027-cambios-cff-hacienda-sat-ia-efos-fiscalizacion' }
  ]
};
