import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const adminClient = readFileSync(join(import.meta.dirname, "components/admin-ops-client.tsx"), "utf8");

describe("admin catalog UI", () => {
  it("exposes catalog seed and activation actions without browser price editing", () => {
    expect(adminClient).toContain('"seedCodeOwnedCatalog"');
    expect(adminClient).toContain('"activateVersion"');
    expect(adminClient).toContain('staffSession.staffFetch("/api/admin/catalog"');
    expect(adminClient).toContain("Seed Code Catalog");
    expect(adminClient).toContain("Activate");

    expect(adminClient).not.toContain('name="price');
    expect(adminClient).not.toContain("setPrice");
    expect(adminClient).not.toContain("products:");
    expect(adminClient).not.toContain("prices:");
  });
});
