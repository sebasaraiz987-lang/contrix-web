// Utilidades compartidas por las funciones de Stripe de Contrix
import Stripe from "npm:stripe@17";
import { createClient } from "npm:@supabase/supabase-js@2";

export const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  httpClient: Stripe.createFetchHttpClient(),
});

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

// Cliente con permisos de servidor (nunca se expone al navegador)
export const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// Devuelve el usuario que hace la petición (a partir de su sesión)
export async function usuarioDesdePeticion(req: Request) {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace("Bearer ", "");
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error) return null;
  return data.user;
}

// Relación plan ↔ precio de Stripe (los IDs se configuran como secretos)
export const PRECIOS: Record<string, string | undefined> = {
  pymes: Deno.env.get("STRIPE_PRICE_PYMES"),
  empresarial: Deno.env.get("STRIPE_PRICE_EMPRESARIAL"),
  corporativo: Deno.env.get("STRIPE_PRICE_CORPORATIVO"),
};

export function planDesdePrecio(priceId?: string | null): string | null {
  if (!priceId) return null;
  for (const [plan, id] of Object.entries(PRECIOS)) if (id === priceId) return plan;
  return null;
}

// Solo se permite regresar a URLs http(s); si no, se usa SITE_URL
export function urlRetorno(candidata?: string) {
  const site = Deno.env.get("SITE_URL") ?? "";
  if (candidata && /^https?:\/\//.test(candidata)) return candidata;
  return site;
}
