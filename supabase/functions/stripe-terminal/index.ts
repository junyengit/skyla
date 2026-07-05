// ============================================================
// Supabase Edge Function: stripe-terminal
// Legacy transition stub for the old browser/Supabase POS Terminal bridge.
// All Stripe Terminal bridge actions are permanently fail-closed in repo code.
//
// Native Terminal payment and future reader setup must go through Next.js +
// Convex staff-authenticated workflows.
// ============================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

const DISABLED_BRIDGE_ACTIONS = new Set([
  "connection-token",
  "list-locations",
  "list-readers",
  "create-intent",
  "setup-reader",
]);

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
    const payload = await req.json();
    if (DISABLED_BRIDGE_ACTIONS.has(payload.action)) {
      return json(
        {
          error: "Legacy Stripe Terminal bridge is permanently disabled. Use the Next.js/Convex POS saleRef payment flow."
        },
        410
      );
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("Legacy Stripe Terminal function failed", e);
    return json({ error: "Legacy Stripe Terminal request failed" }, 400);
  }
}

export default {
  fetch: (req: Request, ctx: unknown) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    return withSupabase({ auth: ["publishable", "secret"] }, handle)(req, ctx);
  },
};
