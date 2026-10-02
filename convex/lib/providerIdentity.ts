/** Server-only identity for the exact provider configuration used by a request.
 * A changed key may belong to a different merchant whose idempotency history
 * is unrelated. Store only this irreversible digest, never the credential.
 */
export async function providerConfigurationFingerprint(parts: readonly string[]) {
  const bytes = new TextEncoder().encode(JSON.stringify(parts));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
