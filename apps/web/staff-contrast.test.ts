import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const globalsCss = readFileSync(join(import.meta.dirname, "app/globals.css"), "utf8");

function ruleBlock(selector: string) {
  const start = globalsCss.indexOf(`${selector} {`);
  expect(start, `${selector} rule exists`).toBeGreaterThanOrEqual(0);
  const end = globalsCss.indexOf("\n}", start);
  expect(end, `${selector} rule closes`).toBeGreaterThan(start);
  return globalsCss.slice(start, end + 2);
}

describe("staff page contrast", () => {
  it("keeps admin and POS shells white-on-black for readability", () => {
    expect(ruleBlock(".adminOpsPage")).toContain("color: #fff;");
    expect(ruleBlock(".posNextPage")).toContain("color: #fff;");

    expect(globalsCss).toContain(".adminOpsPage input,\n.adminOpsPage textarea,\n.adminOpsPage select,\n.adminOpsPage button");
    expect(globalsCss).toContain(".posNextPage input,\n.posNextPage textarea,\n.posNextPage select,\n.posNextPage button");
    expect(globalsCss).toContain(".adminOpsPage .brand,\n.adminOpsPage h1");
    expect(globalsCss).toContain(".posNextPage .brand,\n.posNextPage h1");
    expect(globalsCss).toContain(".posNextPage h3,\n.posNextPage h4");
  });
});
