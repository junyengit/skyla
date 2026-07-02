// ============================================================
// Supabase Edge Function: stripe-checkout
// Holds the Stripe SECRET key (never exposed to the browser).
//   • action: "verify"  → confirms a session was actually paid
//
// Uses withSupabase({ auth: ["publishable","secret"] }) so the website can
// call it with the public publishable key. Secret goes in Edge Function
// secrets:  STRIPE_SECRET_KEY = sk_test_...
// ============================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

const STRIPE_SECRET = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const STRIPE_API = "https://api.stripe.com/v1";
const DISABLED_PAYMENT_ACTIONS = new Set(["create", "payment-intent", "update-intent"]);

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

async function stripe(path: string, method = "GET", body?: string) {
  const res = await fetch(`${STRIPE_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || "Stripe request failed");
  return data;
}

async function handle(req: Request) {
  try {
    const payload = await req.json();
    if (DISABLED_PAYMENT_ACTIONS.has(payload.action)) {
      return json(
        {
          error: "Legacy browser-authoritative Stripe payment creation is permanently disabled. Use the Next.js/Convex checkout flow."
        },
        410
      );
    }

    if (payload.action === "verify") {
      if (!STRIPE_SECRET) return json({ error: "STRIPE_SECRET_KEY not set" }, 500);
      const { sessionId } = payload;
      if (!sessionId) return json({ error: "Missing sessionId" }, 400);
      const session = await stripe(`/checkout/sessions/${sessionId}`, "GET");
      return json({
        paid: session.payment_status === "paid",
        bookingRef: session.metadata?.booking_ref || session.client_reference_id || "",
        amountTotal: session.amount_total,
        email: session.customer_details?.email || session.customer_email || "",
      });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 400);
  }
}

export default {
  // Answer CORS preflight before auth; everything else goes through withSupabase
  fetch: (req: Request, ctx: unknown) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    return withSupabase({ auth: ["publishable", "secret"] }, handle)(req, ctx);
  },
};
