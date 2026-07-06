// ============================================================
// Supabase Edge Function: kaskade-webhook   (legacy retired stub)
// This repo copy is intentionally fail-closed. Do not deploy a Kaskade webhook
// reconciliation path from this project until crypto payments are rebuilt as
// server-authoritative Convex code from stored order refs.
// ============================================================
Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok", { status: 200 });
  await req.text().catch(() => "");
  return new Response("legacy Kaskade webhook retired", { status: 410 });
});
