// POST { plan: 'pymes'|'empresarial'|'corporativo', return_url?: string }
// Crea una sesión de Stripe Checkout (suscripción mensual) y devuelve { url }
import { admin, cors, json, PRECIOS, stripe, urlRetorno, usuarioDesdePeticion } from "../_shared/comun.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const user = await usuarioDesdePeticion(req);
    if (!user) return json({ error: "Inicia sesión para suscribirte" }, 401);

    const { plan, return_url } = await req.json();
    const price = PRECIOS[plan];
    if (!price) return json({ error: "Plan no válido o precio no configurado en Stripe" }, 400);

    const { data: perfil } = await admin
      .from("profiles").select("stripe_customer_id, email, nombre").eq("id", user.id).single();

    let customer = perfil?.stripe_customer_id as string | undefined;
    if (!customer) {
      const c = await stripe.customers.create({
        email: user.email,
        name: perfil?.nombre ?? undefined,
        metadata: { user_id: user.id },
      });
      customer = c.id;
      await admin.from("profiles").update({ stripe_customer_id: customer }).eq("id", user.id);
    }

    const base = urlRetorno(return_url);
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer,
      client_reference_id: user.id,
      line_items: [{ price, quantity: 1 }],
      locale: "es",
      allow_promotion_codes: true,
      metadata: { user_id: user.id, plan },
      subscription_data: { metadata: { user_id: user.id, plan } },
      success_url: `${base}#/app/plan?pago=ok`,
      cancel_url: `${base}#/app/plan?pago=cancelado`,
    });

    return json({ url: session.url });
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, 500);
  }
});
