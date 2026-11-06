import { backendSandboxAdmissionDecision } from "./sandboxAdmission";

declare const process: { env: Record<string, string | undefined> };

/** A pasted QR URL is accepted only from production or the verified sandbox. */
export function ticketCodeFromStaffLookup(
  value: string,
  env: Record<string, string | undefined> = process.env,
  now = Date.now()
) {
  const query = value.trim();
  const canonical = query.match(/^tkt_[a-f0-9]{32}$/i)?.[0]
    ?? query.match(/^https:\/\/skydeckla\.com\/tickets\/(tkt_[a-f0-9]{32})\/?$/i)?.[1];
  if (canonical) return canonical.toLowerCase();
  if (!backendSandboxAdmissionDecision(env, now).open) return undefined;

  const prefix = `${env.SKYLA_SANDBOX_ADMISSION_ORIGIN}/tickets/`;
  if (!query.startsWith(prefix)) return undefined;
  return query.slice(prefix.length).match(/^(tkt_[a-f0-9]{32})\/?$/i)?.[1]?.toLowerCase();
}
