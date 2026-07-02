// ============================================================
// Supabase Edge Function: stripe-terminal
// Powers the in-person POS (BBPOS WisePOS E / Stripe Reader S700).
//   • action: "setup-reader"     → admin-token-gated reader registration
//
// Uses the same Stripe secret as checkout (STRIPE_SECRET_KEY in Supabase
// Edge Function secrets). Reuses withSupabase so the website can call it with
// the publishable key.
// ============================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

const STRIPE_SECRET = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const TERMINAL_SETUP_TOKEN = Deno.env.get("SKYLA_TERMINAL_SETUP_TOKEN") ?? "";
const STRIPE_API = "https://api.stripe.com/v1";
const DISABLED_BRIDGE_ACTIONS = new Set(["connection-token", "list-locations", "list-readers", "create-intent"]);
const DEFAULT_LOCATION_NAME = "Skyla Los Angeles";
const DEFAULT_ADDRESS = {
  line1: "6100 Wilshire Blvd",
  city: "Los Angeles",
  state: "CA",
  postal_code: "90048",
  country: "US",
};

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

async function skylaTerminalLocation() {
  const locs = await stripe("/terminal/locations", "GET");
  const existing = (locs.data || []).find((loc: Record<string, unknown>) =>
    String(loc.display_name || "").toLowerCase() === DEFAULT_LOCATION_NAME.toLowerCase()
  );
  if (existing) return existing;

  const fields: Record<string, string> = {
    display_name: DEFAULT_LOCATION_NAME,
    "address[line1]": DEFAULT_ADDRESS.line1,
    "address[city]": DEFAULT_ADDRESS.city,
    "address[state]": DEFAULT_ADDRESS.state,
    "address[postal_code]": DEFAULT_ADDRESS.postal_code,
    "address[country]": DEFAULT_ADDRESS.country,
  };
  return await stripe("/terminal/locations", "POST", new URLSearchParams(fields).toString());
}

function isAuthorizedSetupToken(value: unknown) {
  const token = String(value || "");
  return Boolean(TERMINAL_SETUP_TOKEN) && token.length === TERMINAL_SETUP_TOKEN.length && token === TERMINAL_SETUP_TOKEN;
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

    // One-time setup for a physical reader. The pairing code is shown on the
    // reader after it has been updated and connected to WiFi.
    if (payload.action === "setup-reader") {
      if (!STRIPE_SECRET) return json({ error: "STRIPE_SECRET_KEY not set" }, 500);
      if (!TERMINAL_SETUP_TOKEN) return json({ error: "SKYLA_TERMINAL_SETUP_TOKEN not set" }, 500);
      if (!isAuthorizedSetupToken(payload.setupToken)) return json({ error: "Reader setup not authorized" }, 403);

      const registrationCode = String(payload.registrationCode || "").trim();
      const label = String(payload.label || "Skyla reader").trim().slice(0, 80);
      if (!registrationCode) return json({ error: "Missing pairing code" }, 400);

      const location = await skylaTerminalLocation();
      const fields: Record<string, string> = {
        registration_code: registrationCode,
        label,
        location: location.id,
      };
      const reader = await stripe("/terminal/readers", "POST", new URLSearchParams(fields).toString());
      return json({ reader, location });
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
