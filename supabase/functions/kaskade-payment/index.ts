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
  await req.text().catch(() => "");
  return json(
    {
      error:
        "Legacy browser-authoritative Kaskade payment creation is permanently disabled. Use the Next.js/Convex payment flow."
    },
    410
  );
}

export default {
  fetch: (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    return handle(req);
  },
};
