// Legacy Supabase Stripe Checkout function is retired.
//
// The active payment path is Next.js -> Convex -> Stripe, using stored
// orderRef records and server-owned totals. Keep this stub deployed or disable
// the function in Supabase so old browser callers cannot create or verify
// Stripe checkout state from the Supabase-era endpoint.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 410) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

export default {
  fetch: (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    return json({
      error: "Legacy Stripe checkout function is permanently disabled. Use the Next.js/Convex checkout flow."
    });
  },
};
