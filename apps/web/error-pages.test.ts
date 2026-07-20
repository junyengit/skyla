import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const webDir = __dirname;

describe("error boundaries", () => {
  it("keeps route and root error boundaries in place with crash reporting", () => {
    for (const file of ["app/error.tsx", "app/global-error.tsx"]) {
      const contents = readFileSync(join(webDir, file), "utf8");
      expect(contents, `${file} must be a client boundary`).toContain('"use client"');
      expect(contents, `${file} must report crashes`).toContain("reportClientError(error");
      expect(contents, `${file} must offer recovery`).toContain("onClick={reset}");
    }
  });

  it("never renders internal error detail to visitors", () => {
    for (const file of ["app/error.tsx", "app/global-error.tsx"]) {
      const contents = readFileSync(join(webDir, file), "utf8");
      expect(contents, `${file} must not render error.message`).not.toContain("{error.message}");
      expect(contents, `${file} must not render the digest`).not.toContain("{error.digest}");
      expect(contents, `${file} must not stringify the error`).not.toContain("String(error)");
    }
  });
});
