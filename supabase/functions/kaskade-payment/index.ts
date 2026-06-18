// ============================================================
// Supabase Edge Function: kaskade-payment   (crypto, experimental)
// Holds the Kaskade SECRET key (never exposed to the browser).
// Creates a payment and returns { payment: { id, payAddress, payAmount, ... } }.
//
// DEPLOY (dashboard): Edge Functions → Create function → name it
//   "kaskade-payment" → paste this code → Deploy.
// SECRET: Edge Functions → Secrets → add  KASKADE_SECRET_KEY = ks_live_...
// ============================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

const KASKADE_SECRET = Deno.env.get("KASKADE_SECRET_KEY") ?? "";
const KASKADE_API = "https://kaskade.com/api/v1";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

async function handle(req: Request) {
  try {
    if (!KASKADE_SECRET) return json({ error: "KASKADE_SECRET_KEY not set" }, 500);

    const { priceUsd, payCurrency = "btc", orderId, orderDescription } = await req.json();
    if (!priceUsd || priceUsd < 1) return json({ error: "Invalid amount" }, 400);

    const res = await fetch(`${KASKADE_API}/payments`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${KASKADE_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ priceUsd, payCurrency, orderId, orderDescription }),
    });
    const data = await res.json();
    if (!res.ok) return json({ error: data?.message || "Kaskade request failed" }, 400);

    return json({ payment: data.payment ?? data });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 400);
  }
}

export default {
  fetch: (req: Request, ctx: unknown) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    return withSupabase({ auth: ["publishable", "secret"] }, handle)(req, ctx);
  },
};
