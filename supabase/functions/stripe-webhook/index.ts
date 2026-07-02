// Legacy Supabase Stripe webhook is retired.
//
// The active Stripe webhook target is the Convex HTTP action at:
//   https://<convex-site-url>/stripe-webhook
//
// Keep this function fail-closed if it is redeployed during the migration so
// old Stripe metadata cannot recreate or mutate Supabase bookings.
Deno.serve(() => {
  return new Response(
    JSON.stringify({
      error: "legacy_stripe_webhook_retired",
      message: "Stripe webhook reconciliation has moved to Convex."
    }),
    {
      status: 410,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store"
      }
    }
  );
});
