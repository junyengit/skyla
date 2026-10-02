import { cronJobs, makeFunctionReference } from "convex/server";

// Scheduled actions run at most once, so a lost run would strand an attempt or
// a ticket email. These small bounded sweeps re-schedule due work; leases and
// version checks make a duplicate run harmless. They never call a provider.
const sweepCheckoutAttempts = makeFunctionReference<"mutation", Record<string, never>, { scheduled: number }>(
  "checkoutReconciliation:sweepCheckoutAttempts"
);
const sweepTicketDeliveries = makeFunctionReference<
  "mutation",
  Record<string, never>,
  { scheduled: number; recovered: number }
>("ticketDelivery:sweepTicketDeliveries");

const crons = cronJobs();

crons.interval("reconcile due checkout attempts", { minutes: 5 }, sweepCheckoutAttempts, {});
crons.interval("reconcile due terminal attempts", { minutes: 5 }, makeFunctionReference<
  "mutation",
  Record<string, never>,
  { scheduled: number }
>("terminalReconciliation:sweepTerminalAttempts"), {});
crons.interval("repair ticket delivery", { minutes: 5 }, sweepTicketDeliveries, {});
crons.interval("track accepted ticket emails", { minutes: 5 }, makeFunctionReference<"mutation", Record<string, never>, { scheduled: number }>(
  "ticketDeliveryTracking:sweepTicketDeliveryTracking"
), {});

export default crons;
