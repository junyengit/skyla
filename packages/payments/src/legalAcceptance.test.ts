import { describe, expect, it } from "vitest";

import {
  assertCurrentCheckoutLegalAcceptance,
  currentCheckoutLegalAcceptanceInput,
  currentLiabilityWaiverAcceptanceText,
  currentLiabilityWaiverVersion,
  currentTermsAcceptanceText,
  currentTermsVersion
} from "./legalAcceptance";

describe("checkout legal acceptance", () => {
  it("returns the canonical versions and acceptance language", () => {
    expect(assertCurrentCheckoutLegalAcceptance(currentCheckoutLegalAcceptanceInput)).toEqual({
      termsVersion: currentTermsVersion,
      termsAcceptanceText: currentTermsAcceptanceText,
      liabilityWaiverVersion: currentLiabilityWaiverVersion,
      liabilityWaiverAcceptanceText: currentLiabilityWaiverAcceptanceText
    });
  });

  it.each([
    [{ termsAccepted: false }, "Terms acceptance is required"],
    [{ liabilityWaiverAccepted: false }, "Liability waiver acceptance is required"],
    [{ termsVersion: "old" }, "Terms acceptance is out of date"],
    [{ liabilityWaiverVersion: "old" }, "Liability waiver acceptance is out of date"]
  ])("rejects invalid acceptance %#", (override, message) => {
    expect(() =>
      assertCurrentCheckoutLegalAcceptance({
        ...currentCheckoutLegalAcceptanceInput,
        ...override
      })
    ).toThrow(message);
  });
});
