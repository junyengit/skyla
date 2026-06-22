// ============================================================
// Supabase Edge Function: stripe-webhook
// Stripe calls this directly when a card payment succeeds, so the booking is
// recorded even if the customer closed their tab before their browser could
// save it. Verifies Stripe's signature, then CREATES the booking only if the
// browser didn't already (matched by bookingRef) — so there are never dupes.
//
// DEPLOY: Edge Functions → Create function → name it "stripe-webhook" →
//   paste this code → Deploy → then turn OFF "Verify JWT" for this function
//   (Stripe authenticates with its signature, not a Supabase token).
//
// SECRET needed: STRIPE_WEBHOOK_SECRET = whsec_...
//   (the "Signing secret" shown after you add the endpoint in
//    Stripe → Developers → Webhooks. SUPABASE_URL and
//    SUPABASE_SERVICE_ROLE_KEY are provided automatically.)
//
// In Stripe → Developers → Webhooks → Add endpoint:
//   URL:    https://<your-project>.supabase.co/functions/v1/stripe-webhook
//   Events: payment_intent.succeeded
// ============================================================
import { createClient } from "jsr:@supabase/supabase-js@2";

const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
const SUPABASE_URL   = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const enc = (s: string) => new TextEncoder().encode(s);

// Verify Stripe's signature: header is "t=<ts>,v1=<hmac>"; the signed payload
// is `${t}.${rawBody}` HMAC-SHA256'd with the signing secret.
async function validSignature(rawBody: string, sigHeader: string): Promise<boolean> {
  if (!WEBHOOK_SECRET || !sigHeader) return false;
  const parts: Record<string, string> = {};
  for (const kv of sigHeader.split(",")) {
    const i = kv.indexOf("=");
    if (i > 0) parts[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
  }
  const t = parts["t"];
  const v1 = parts["v1"];
  if (!t || !v1) return false;

  const key = await crypto.subtle.importKey(
    "raw", enc(WEBHOOK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc(`${t}.${rawBody}`));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");

  if (hex.length !== v1.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ v1.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok", { status: 200 });

  const raw = await req.text();
  const sig = req.headers.get("stripe-signature") || "";
  if (!(await validSignature(raw, sig))) {
    return new Response("invalid signature", { status: 401 });
  }

  let event: any = {};
  try { event = JSON.parse(raw); } catch { /* ignore */ }

  // Only act on a successful card payment with our booking metadata
  if (event?.type === "payment_intent.succeeded" && SUPABASE_URL && SERVICE_ROLE) {
    const pi = event.data?.object ?? {};
    const m  = pi.metadata ?? {};
    const ref = m.booking_ref;

    if (ref && ref !== "PENDING") {
      try {
        const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

        // Did the customer's browser already save this booking?
        const { data: rows } = await sb
          .from("bookings")
          .select("id, data")
          .eq("data->>bookingRef", ref)
          .limit(1);

        if (rows && rows.length) {
          // Already there — just make sure it's marked paid (idempotent).
          const row = rows[0] as { id: string; data: Record<string, unknown> };
          if (!row.data.paid) {
            await sb.from("bookings")
              .update({ data: { ...row.data, paid: true, status: "confirmed", stripePaymentId: pi.id } })
              .eq("id", row.id);
          }
        } else if (m.pkg_name || m.email) {
          // Browser dropped off before saving — recreate the booking from metadata.
          const booking = {
            id:            crypto.randomUUID(),
            bookingRef:    ref,
            packageKey:    m.pkg_key || "",
            packageName:   m.pkg_name || "Booking",
            date:          m.date || "",
            visitDate:     m.date || "",
            time:          m.time || "",
            adults:        Number(m.adults || 0),
            children:      Number(m.children || 0),
            infants:       0,
            firstName:     m.first || "",
            lastName:      m.last || "",
            email:         m.email || "",
            total:         Number(m.total || 0),
            subtotal:      Number(m.total || 0),
            fee:           0,
            addons:        {},
            paid:          true,
            status:        "confirmed",
            paymentMethod: "card",
            stripePaymentId: pi.id,
            createdAt:     new Date().toISOString(),
            source:        "stripe-webhook",
          };
          await sb.from("bookings").insert({ id: booking.id, data: booking });
        }
      } catch (e) {
        console.error("stripe-webhook save failed:", (e as Error)?.message || e);
      }
    }
  }

  return new Response("ok", { status: 200 });
});
