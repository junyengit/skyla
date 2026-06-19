// ============================================================
// Supabase Edge Function: kaskade-webhook   (PharosGate)
// Receives payment.updated events, verifies the signature, and marks the
// matching booking as paid — even if the customer closed the tab.
//
// DEPLOY: Edge Functions → Create function → name it "kaskade-webhook" →
//   paste this code → Deploy → then turn OFF "Verify JWT" for this function
//   (PharosGate doesn't send a Supabase token; it authenticates with the
//   signature instead).
// SECRET needed: KASKADE_WEBHOOK_SECRET = whsec_...
//   (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.)
//
// In PharosGate → Developers → Webhooks, set the URL to this function:
//   https://<your-project>.supabase.co/functions/v1/kaskade-webhook
// ============================================================
import { createClient } from "jsr:@supabase/supabase-js@2";

const WEBHOOK_SECRET = Deno.env.get("KASKADE_WEBHOOK_SECRET") ?? "";
const SUPABASE_URL   = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const PAID_STATUSES = ["confirmed", "finished", "sending"];

const enc = (s: string) => new TextEncoder().encode(s);

async function validSignature(rawBody: string, signature: string): Promise<boolean> {
  if (!WEBHOOK_SECRET || !signature) return false;
  const key = await crypto.subtle.importKey(
    "raw", enc(WEBHOOK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, enc(rawBody));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const got = signature.toLowerCase().replace(/^sha256=/, "").trim();
  // length-safe compare
  if (hex.length !== got.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok", { status: 200 });

  const raw = await req.text();
  const sig = req.headers.get("x-pharosgate-signature") || "";
  if (!(await validSignature(raw, sig))) {
    return new Response("invalid signature", { status: 401 });
  }

  let body: any = {};
  try { body = JSON.parse(raw); } catch { /* ignore */ }
  const payment = body.payment ?? body.data ?? body;
  const orderId = payment?.orderId;
  const status  = String(payment?.status || "").toLowerCase();

  // Acknowledge everything; only act on paid + known order
  if (orderId && PAID_STATUSES.includes(status) && SUPABASE_URL && SERVICE_ROLE) {
    try {
      const sb = createClient(SUPABASE_URL, SERVICE_ROLE);
      const { data: rows } = await sb
        .from("bookings")
        .select("id, data")
        .eq("data->>bookingRef", orderId)
        .limit(1);
      if (rows && rows.length) {
        const row = rows[0] as { id: string; data: Record<string, unknown> };
        const updated = { ...row.data, paid: true, status: "confirmed", cryptoStatus: status };
        await sb.from("bookings").update({ data: updated }).eq("id", row.id);
      }
    } catch (e) {
      console.error("webhook update failed:", (e as Error)?.message || e);
    }
  }

  return new Response("ok", { status: 200 });
});
