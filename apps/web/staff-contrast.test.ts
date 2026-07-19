import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const staffCss = ["app/styles/admin.css", "app/styles/pos.css"]
  .map((file) => readFileSync(join(import.meta.dirname, file), "utf8"))
  .join("\n");

function ruleBlock(selector: string) {
  const start = staffCss.indexOf(`${selector} {`);
  expect(start, `${selector} rule exists`).toBeGreaterThanOrEqual(0);
  const end = staffCss.indexOf("\n}", start);
  expect(end, `${selector} rule closes`).toBeGreaterThan(start);
  return staffCss.slice(start, end + 2);
}

describe("staff page contrast", () => {
  it("keeps admin and POS shells white-on-black for readability", () => {
    expect(ruleBlock(".adminOpsPage")).toContain("color: #fff;");
    expect(ruleBlock(".posNextPage")).toContain("color: #fff;");

    expect(staffCss).toContain(".adminOpsPage input,\n.adminOpsPage textarea,\n.adminOpsPage select,\n.adminOpsPage button");
    expect(staffCss).toContain(".posNextPage input,\n.posNextPage textarea,\n.posNextPage select,\n.posNextPage button");
    expect(staffCss).toContain(".adminOpsPage .brand,\n.adminOpsPage h1");
    expect(staffCss).toContain(".posNextPage .brand,\n.posNextPage h1");
    expect(staffCss).toContain(".posNextPage h3,\n.posNextPage h4");
  });
});
