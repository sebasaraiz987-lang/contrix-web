# Contrix Web Final: guía de puesta en marcha

## Qué hay en esta carpeta

| Archivo | Para qué sirve |
|---|---|
| `index.html` | La web completa: portada, inicio de sesión, alta de empresa y la aplicación |
| `assets/css/contrix.css` | Diseño (azul rey, escalas de azul y blanco) |
| `assets/js/config.js` | Conexión a Supabase y definición de los 3 planes |
| `assets/js/datos-publicos.js` | Indicadores y noticias con fuente (consultados el 03/10/2026) |
| `assets/js/catalogos-sat.js` | Catálogos del SAT y catálogo de cuentas base (Anexo 24) |
| `assets/js/cfdi.js` | Lectura y validación de XML CFDI, y XML borrador 4.0 |
| `assets/js/nucleo.js` | Login, registro, alta de empresa, menú y navegación |
| `assets/js/modulos.js`, `modulos2.js` | Todos los módulos de la aplicación |
| `supabase/migracion-final.sql` | Ajustes a tu base de datos (correr una vez) |
| `supabase/functions/` | Funciones del servidor para cobrar con Stripe |

## 1. Base de datos (5 minutos)

1. Entra a tu proyecto en supabase.com → **SQL Editor** → **New query**.
2. Pega todo `supabase/migracion-final.sql` y presiona **Run**.
   - Borra las semillas de ejemplo del esquema anterior. Esas semillas marcaban el RFC genérico XAXX010101AAA como EFOS e incluían indicadores de 2025.
   - Corrige la política que impedía a los colaboradores invitados ver la empresa.
   - Agrega los campos de suscripción e impide que un usuario se cambie el plan a sí mismo.
   - Aplica el límite de empresas por plan.
   - Agrega la tabla de complementos de pago y las funciones del Portal Contador.
3. **Authentication → URL Configuration**: en *Site URL* pon la dirección donde vas a publicar la web (ver paso 3). Para pruebas locales usa `http://localhost:8080`.
4. Regístrate en la web y después hazte administrador. Esto te permite cargar la lista 69-B:
   ```sql
   update public.profiles set is_admin = true where email = 'TU_CORREO';
   ```

## 2. Cobro con tarjeta: Stripe

1. Crea tu cuenta en stripe.com. Empieza en **modo prueba**.
2. En **Productos**, crea 3 productos con precio **mensual recurrente** en MXN: PYMES $299, Empresarial $799 y Corporativo $1,999. Decide si el precio en Stripe lleva el IVA incluido; en la web se muestra "+ IVA". Copia el ID de precio de cada uno (empieza con `price_`).
3. Instala la CLI de Supabase y despliega las funciones desde esta carpeta:
   ```bash
   supabase login
   supabase link --project-ref betceyztokryvbsrrnev
   supabase secrets set STRIPE_SECRET_KEY=sk_test_... \
     STRIPE_PRICE_PYMES=price_... STRIPE_PRICE_EMPRESARIAL=price_... STRIPE_PRICE_CORPORATIVO=price_... \
     SITE_URL=https://tu-dominio
   supabase functions deploy stripe-checkout
   supabase functions deploy stripe-portal
   supabase functions deploy stripe-webhook --no-verify-jwt
   ```
4. En Stripe → **Developers → Webhooks**, agrega este endpoint: `https://betceyztokryvbsrrnev.supabase.co/functions/v1/stripe-webhook`
   - Eventos: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated` y `customer.subscription.deleted`.
   - Copia el *Signing secret* y ejecuta: `supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...`
5. En Stripe → **Settings → Billing → Customer portal**, activa el portal para que tus clientes puedan cambiar su tarjeta o cancelar.
6. Prueba con la tarjeta `4242 4242 4242 4242` (cualquier fecha futura y cualquier CVC).

> La llave secreta de Stripe (`sk_...`) solo va en los *secrets* de Supabase. Nunca la pongas en `config.js`.

## 3. Ver la web

- **Rápido, en tu computadora:** abre una terminal en esta carpeta y ejecuta `npx serve -l 8080` (o usa "Live Server" de VS Code). Luego abre `http://localhost:8080`.
- **Publicarla:** sube la carpeta tal cual a Netlify, Vercel o GitHub Pages, y pon esa URL en *Site URL* de Supabase y en `SITE_URL` de Stripe.
- Si abres `index.html` con doble clic, la portada funciona, pero los correos de confirmación y el pago no, porque necesitan una dirección http.

## 4. Lista 69-B (EFOS)

Descarga el "Listado completo" del artículo 69-B (CSV) desde el portal de datos abiertos del SAT. Con tu cuenta de administrador, súbelo en **EFOS (69-B)**. Desde ese momento, cada XML que se cargue se cruza contra esa lista.

## Qué funciona hoy y qué falta conectar

| Función | Estado |
|---|---|
| Login, registro, recuperar contraseña, alta de empresa | ✅ Supabase Auth real |
| Análisis de facturas e identificación de errores | ✅ XML 3.3/4.0, nómina y pagos 2.0; también .zip |
| Registro de movimientos y asientos (pólizas) | ✅ Con cuadre obligatorio y póliza sugerida desde un CFDI |
| Catálogo de cuentas | ✅ Base Anexo 24, importación desde Excel y captura |
| Balanza, libro diario y auxiliar | ✅ |
| Cálculo de IVA | ✅ Preliminar, por flujo de efectivo |
| CFDIs de pago pendientes por emitir o recibir | ✅ |
| CFDIs cancelados | ✅ Liga de verificación oficial del SAT y detección desde el archivo del SAT |
| Consulta de EFOS | ✅ Requiere cargar la lista 69-B |
| Conciliación con visores de ingresos y nómina | ✅ Con el archivo que exportas del SAT |
| Materialidad | ✅ Archivos guardados en tu almacenamiento privado |
| Dashboard de indicadores | ✅ |
| Portal Contador | ✅ Multiempresa, invitaciones y roles (Empresarial y Corporativo) |
| Exportación a Excel | ✅ En todos los módulos |
| 3 planes y pago con tarjeta | ✅ Código listo; falta configurar Stripe (paso 2) |
| Noticias con referencias e indicadores en la esquina | ✅ Datos del 03/10/2026, cada uno con fuente |
| Crear CFDI | ⚠️ Captura y XML borrador; el timbrado requiere contratar un PAC |
| Sincronización diaria con el SAT | ⏳ Requiere e.firma y un servicio de descarga masiva en servidor |
| Sincronización con COI | ⏳ Requiere el layout de importación de tu versión de Aspel COI |

## Revisa antes de publicar

- **Catálogo base (`catalogos-sat.js`)**: son 77 cuentas con código agrupador del Anexo 24. Revisa que los códigos sean los que usas.
- **Indicadores y noticias (`datos-publicos.js`)**: tienen fecha de consulta. Actualízalos cuando publiques. También puedes cargarlos en las tablas `indicadores_economicos` y `noticias`; la web usa la versión más reciente.
- **Planes**: tomé precios y límites de `ARQUITECTURA.md`. La 2.0 tenía además precios anuales ($239 y $639) y límites distintos en el módulo de pagos, y esos no los usé.
