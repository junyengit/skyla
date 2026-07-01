// ============================================================
// Supabase Edge Function: stripe-terminal
// Powers the in-person POS (BBPOS WisePOS E / Stripe Reader S700).
//   • action: "connection-token" → short-lived token the Terminal SDK uses to
//                                   talk to readers (never exposes the secret key)
//   • action: "create-intent"    → a card-present PaymentIntent for a sale
//   • action: "setup-reader"     → admin-token-gated reader registration
//   • action: "list-readers"     → registered readers for a location (optional)
//
// Uses the same Stripe secret as checkout (STRIPE_SECRET_KEY in Supabase
// Edge Function secrets). Reuses withSupabase so the website can call it with
// the publishable key.
// ============================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server@^1";

const STRIPE_SECRET = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const TERMINAL_SETUP_TOKEN = Deno.env.get("SKYLA_TERMINAL_SETUP_TOKEN") ?? "";
const LEGACY_TERMINAL_BRIDGE_ENABLED = Deno.env.get("SKYLA_ENABLE_LEGACY_TERMINAL_BRIDGE") === "true";
const STRIPE_API = "https://api.stripe.com/v1";
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
    if (!STRIPE_SECRET) return json({ error: "STRIPE_SECRET_KEY not set" }, 500);
    const payload = await req.json();
    const disabledBridgeActions = new Set(["connection-token", "list-locations", "list-readers", "create-intent"]);
    if (disabledBridgeActions.has(payload.action) && !LEGACY_TERMINAL_BRIDGE_ENABLED) {
      return json(
        {
          error:
            "Legacy Stripe Terminal bridge is disabled. Use the Next.js/Convex POS saleRef payment flow."
        },
        410
      );
    }

    // Token the Terminal JS SDK exchanges to connect to readers.
    // Passing a location scopes the token to readers at that venue (best practice).
    if (payload.action === "connection-token") {
      const body = payload.location
        ? new URLSearchParams({ location: payload.location }).toString()
        : "";
      const tok = await stripe("/terminal/connection_tokens", "POST", body);
      return json({ secret: tok.secret });
    }

    // List Terminal locations (so the POS can pick a venue)
    if (payload.action === "list-locations") {
      const locs = await stripe("/terminal/locations", "GET");
      return json({ locations: locs.data || [] });
    }

    // One-time setup for a physical reader. The pairing code is shown on the
    // reader after it has been updated and connected to WiFi.
    if (payload.action === "setup-reader") {
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

    // A card-present PaymentIntent for an in-person sale
    if (payload.action === "create-intent") {
      const { amountCents, currency = "usd", description, metadata = {}, receiptEmail } = payload;
      if (!amountCents || amountCents < 50) return json({ error: "Invalid amount" }, 400);
      const fields: Record<string, string> = {
        "amount": String(Math.round(amountCents)),
        "currency": currency,
        "payment_method_types[]": "card_present",
        "capture_method": "automatic",
      };
      if (description) fields["description"] = description;
      if (receiptEmail) fields["receipt_email"] = receiptEmail;   // Stripe emails a receipt
      for (const [k, v] of Object.entries(metadata)) {
        fields[`metadata[${k}]`] = String(v ?? "").slice(0, 480);
      }
      const pi = await stripe("/payment_intents", "POST", new URLSearchParams(fields).toString());
      return json({ clientSecret: pi.client_secret, id: pi.id });
    }

    // Readers registered to a location (handy for picking a real reader)
    if (payload.action === "list-readers") {
      const q = payload.locationId ? `?location=${encodeURIComponent(payload.locationId)}` : "";
      const readers = await stripe(`/terminal/readers${q}`, "GET");
      return json({ readers: readers.data || [] });
    }

    return json({ error: "Unknown action" }, 400);
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
