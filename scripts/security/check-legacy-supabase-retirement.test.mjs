import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { evaluateLegacySupabaseRetirement, retiredSupabaseFunctions } from "./check-legacy-supabase-retirement.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const scriptPath = resolve(repoRoot, "scripts/security/check-legacy-supabase-retirement.mjs");

describe("legacy Supabase retirement guard", () => {
  it("passes for the checked-in retired function stubs", () => {
    const result = spawnSync(process.execPath, [scriptPath], {
      cwd: repoRoot,
      encoding: "utf8"
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Legacy Supabase retirement guard passed");
  });

  it("rejects a retired stub that starts active Supabase or Stripe work again", () => {
    const root = mkdtempSync(join(tmpdir(), "skyla-retired-supabase-"));

    for (const retiredFunction of retiredSupabaseFunctions) {
      const path = join(root, retiredFunction.path);
      mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true });
      writeFileSync(
        path,
        `export default { fetch: () => new Response("retired", { status: 410 }) };\n${retiredFunction.requiredMarkers.join("\n")}\n`,
        "utf8"
      );
    }

    writeFileSync(
      join(root, "supabase/functions/stripe-terminal/index.ts"),
      [
        'import { withSupabase } from "jsr:@supabase/server@^1";',
        'export default { fetch: () => withSupabase({}, () => new Response("retired", { status: 410 })) };',
        "permanently disabled",
        "Next.js/Convex POS saleRef payment flow"
      ].join("\n"),
      "utf8"
    );

    expect(evaluateLegacySupabaseRetirement(root)).toContain(
      "supabase/functions/stripe-terminal/index.ts: retired functions must return before initializing Supabase helpers"
    );
  });
});
