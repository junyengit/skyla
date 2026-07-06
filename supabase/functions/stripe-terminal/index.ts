// ============================================================
// Supabase Edge Function: stripe-terminal
// Legacy transition stub for the old browser/Supabase POS Terminal bridge.
// All Stripe Terminal bridge actions are permanently fail-closed in repo code.
//
// Native Terminal payment and future reader setup must go through Next.js +
// Convex staff-authenticated workflows.
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
      error: "Legacy Stripe Terminal bridge is permanently disabled. Use the Next.js/Convex POS saleRef payment flow."
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
