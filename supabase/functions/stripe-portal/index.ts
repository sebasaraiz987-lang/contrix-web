// POST { return_url?: string } → { url } del portal de facturación de Stripe
// (cambiar tarjeta, ver facturas, cancelar suscripción)
import { admin, cors, json, stripe, urlRetorno, usuarioDesdePeticion } from "../_shared/comun.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const user = await usuarioDesdePeticion(req);
    if (!user) return json({ error: "Inicia sesión" }, 401);
    const { return_url } = await req.json().catch(() => ({}));

    const { data: perfil } = await admin
      .from("profiles").select("stripe_customer_id").eq("id", user.id).single();
    if (!perfil?.stripe_customer_id) {
      return json({ error: "Aún no tienes una suscripción registrada" }, 400);
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: perfil.stripe_customer_id,
      return_url: `${urlRetorno(return_url)}#/app/plan`,
    });
    return json({ url: session.url });
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message }, 500);
  }
});
