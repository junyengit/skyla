// ============================================================
// Supabase Edge Function: kaskade-payment   (legacy retired stub)
// This repo copy is intentionally fail-closed. Do not deploy a browser-
// authoritative Kaskade payment creator from this project; future crypto
// payments must be rebuilt through stored server-side refs and Convex actions.
// ============================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

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
  await req.text().catch(() => "");
  return json(
    {
      error:
        "Legacy browser-authoritative Kaskade payment creation is permanently disabled. Use the Next.js/Convex payment flow."
    },
    410
  );
}

export default {
  fetch: (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    return handle(req);
  },
};
