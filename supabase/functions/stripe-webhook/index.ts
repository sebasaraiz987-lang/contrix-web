// Webhook de Stripe → actualiza plan y estado de suscripción en profiles.
// Desplegar SIN verificación JWT:  supabase functions deploy stripe-webhook --no-verify-jwt
import Stripe from "npm:stripe@17";
import { admin, planDesdePrecio, stripe } from "../_shared/comun.ts";

const cryptoProvider = Stripe.createSubtleCryptoProvider();

async function guardarSuscripcion(sub: Stripe.Subscription) {
  const item = sub.items?.data?.[0];
  const priceId = item?.price?.id;
  const plan = planDesdePrecio(priceId) ?? (sub.metadata?.plan as string | undefined) ?? null;
  // En versiones recientes de la API el periodo vive en el item
  // deno-lint-ignore no-explicit-any
  const fin = (sub as any).current_period_end ?? (item as any)?.current_period_end ?? null;

  const cambios: Record<string, unknown> = {
    stripe_subscription_id: sub.id,
    subscription_status: sub.status,
    current_period_end: fin ? new Date(fin * 1000).toISOString() : null,
  };
  if (plan && ["active", "trialing", "past_due"].includes(sub.status)) cambios.plan = plan;

  const customer = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const userId = sub.metadata?.user_id;
  const q = admin.from("profiles").update(cambios);
  const { error } = userId ? await q.eq("id", userId) : await q.eq("stripe_customer_id", customer);
  if (error) console.error("Error al actualizar profile:", error);
}

Deno.serve(async (req) => {
  const firma = req.headers.get("Stripe-Signature");
  const cuerpo = await req.text();
  let evento: Stripe.Event;
  try {
    evento = await stripe.webhooks.constructEventAsync(
      cuerpo, firma!, Deno.env.get("STRIPE_WEBHOOK_SECRET")!, undefined, cryptoProvider,
    );
  } catch (e) {
    return new Response(`Firma inválida: ${(e as Error).message}`, { status: 400 });
  }

  try {
    switch (evento.type) {
      case "checkout.session.completed": {
        const s = evento.data.object as Stripe.Checkout.Session;
        if (s.subscription) {
          const sub = await stripe.subscriptions.retrieve(s.subscription as string);
          await guardarSuscripcion(sub);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await guardarSuscripcion(evento.data.object as Stripe.Subscription);
        break;
    }
  } catch (e) {
    console.error(e);
    return new Response("Error interno", { status: 500 });
  }
  return new Response(JSON.stringify({ recibido: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
