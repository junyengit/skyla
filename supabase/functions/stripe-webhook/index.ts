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

const WEBHOOK_SECRET = (Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "").trim();
const SUPABASE_URL   = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const enc = (s: string) => new TextEncoder().encode(s);

async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", enc(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc(payload));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Verify Stripe's signature: header is "t=<ts>,v1=<hmac>[,v1=<hmac>...]";
// the signed payload is `${t}.${rawBody}` HMAC-SHA256'd with the signing secret.
// Returns { ok, diag } where diag is a NON-sensitive hint for debugging.
async function validSignature(rawBody: string, sigHeader: string): Promise<{ ok: boolean; diag: string }> {
  if (!WEBHOOK_SECRET) return { ok: false, diag: "no_secret_configured" };
  if (!sigHeader)      return { ok: false, diag: "no_signature_header" };

  let t: string | undefined;
  const v1s: string[] = [];
  for (const kv of sigHeader.split(",")) {
    const i = kv.indexOf("=");
    if (i < 0) continue;
    const k = kv.slice(0, i).trim();
    const v = kv.slice(i + 1).trim();
    if (k === "t") t = v;
    else if (k === "v1") v1s.push(v);
  }
  if (!t || v1s.length === 0) return { ok: false, diag: "malformed_header" };

  const expected = await hmacHex(WEBHOOK_SECRET, `${t}.${rawBody}`);
  for (const sig of v1s) {
    if (sig.length !== expected.length) continue;
    let diff = 0;
    for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
    if (diff === 0) return { ok: true, diag: "ok" };
  }
  // Non-sensitive hint: length + "whsec_" prefix only (never the secret itself)
  return { ok: false, diag: `mismatch secret_len=${WEBHOOK_SECRET.length} prefix=${WEBHOOK_SECRET.slice(0, 6)}` };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok", { status: 200 });

  const raw = await req.text();
  const sig = req.headers.get("stripe-signature") || "";
  const check = await validSignature(raw, sig);
  if (!check.ok) {
    return new Response(`invalid signature: ${check.diag}`, { status: 401 });
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
