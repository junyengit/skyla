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
Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok", { status: 200 });
  await req.text().catch(() => "");
  return new Response("legacy Kaskade webhook retired", { status: 410 });
});
