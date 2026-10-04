/* ════════════════════════════════════════════════════════════
   CONTRIX — Configuración
   La llave "publishable" de Supabase es pública por diseño
   (la seguridad la dan las políticas RLS). NUNCA pongas aquí la
   service_role key ni la llave secreta de Stripe.
   ════════════════════════════════════════════════════════════ */
window.CONTRIX_CONFIG = {
  SUPABASE_URL: 'https://betceyztokryvbsrrnev.supabase.co',
  SUPABASE_KEY: 'sb_publishable_gIdGgCYrXKvDfeqJ8cIy9g_YpYRjmcp',

  // Planes (fuente: ARQUITECTURA.md de Contrix Web 2.0)
  PLANES: [
    {
      id: 'pymes', nombre: 'PYMES', precio: 299,
      desc: 'Para pequeños negocios y personas físicas con actividad empresarial.',
      limites: { empresas: 1, cfdis: 500, usuarios: 2 },
      filas: { empresas: '1', cfdis: '500', usuarios: '2', sync: 'Diaria', coi: false, portal: false, soporte: 'Email' }
    },
    {
      id: 'empresarial', nombre: 'Empresarial', precio: 799, popular: true,
      desc: 'Para empresas medianas y despachos con varias razones sociales.',
      limites: { empresas: 3, cfdis: 2000, usuarios: 10 },
      filas: { empresas: '3', cfdis: '2,000', usuarios: '10', sync: 'Tiempo real', coi: true, portal: true, soporte: 'Prioritario' }
    },
    {
      id: 'corporativo', nombre: 'Corporativo', precio: 1999,
      desc: 'Para grupos corporativos y despachos con operación a gran escala.',
      limites: { empresas: null, cfdis: null, usuarios: null },
      filas: { empresas: 'Ilimitadas', cfdis: 'Ilimitados', usuarios: 'Ilimitados', sync: 'Tiempo real', coi: true, portal: true, soporte: 'Dedicado' }
    }
  ],
  DIAS_PRUEBA: 30
};
