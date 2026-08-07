export const currentTermsVersion = "prelaunch-2026-08-06-v1";
export const currentTermsPath = "/terms";
export const currentTermsAgeRepresentationText = "I am 18 or older";
export const currentTermsDocumentLabel = "Terms of Use and Ticket Purchase Terms";
export const currentRefundAndVisitPolicyLabel = "Refund & Visit Policy";
export const currentTermsAcceptanceText =
  `${currentTermsAgeRepresentationText} and agree to the ${currentTermsDocumentLabel} and the ${currentRefundAndVisitPolicyLabel}.`;

export const currentLiabilityWaiverVersion = "prelaunch-2026-08-06-v1";
export const currentLiabilityWaiverPath = "/liability-waiver";
export const currentLiabilityWaiverAcceptanceText =
  "I have read and voluntarily agree to the Sky LA Liability Waiver and Assumption of Risk.";

export type CheckoutLegalAcceptanceInput = {
  termsAccepted: boolean;
  termsVersion: string;
  liabilityWaiverAccepted: boolean;
  liabilityWaiverVersion: string;
};

export type CanonicalCheckoutLegalAcceptance = {
  termsVersion: typeof currentTermsVersion;
  termsAcceptanceText: typeof currentTermsAcceptanceText;
  liabilityWaiverVersion: typeof currentLiabilityWaiverVersion;
  liabilityWaiverAcceptanceText: typeof currentLiabilityWaiverAcceptanceText;
};

export const currentCheckoutLegalAcceptanceInput: CheckoutLegalAcceptanceInput = {
  termsAccepted: true,
  termsVersion: currentTermsVersion,
  liabilityWaiverAccepted: true,
  liabilityWaiverVersion: currentLiabilityWaiverVersion
};

export function assertCurrentCheckoutLegalAcceptance(
  input: CheckoutLegalAcceptanceInput
): CanonicalCheckoutLegalAcceptance {
  if (input.termsAccepted !== true) {
    throw new Error("Terms acceptance is required before payment");
  }
  if (input.liabilityWaiverAccepted !== true) {
    throw new Error("Liability waiver acceptance is required before payment");
  }
  if (input.termsVersion !== currentTermsVersion) {
    throw new Error("Terms acceptance is out of date; please review the current terms");
  }
  if (input.liabilityWaiverVersion !== currentLiabilityWaiverVersion) {
    throw new Error("Liability waiver acceptance is out of date; please review the current waiver");
  }

  return {
    termsVersion: currentTermsVersion,
    termsAcceptanceText: currentTermsAcceptanceText,
    liabilityWaiverVersion: currentLiabilityWaiverVersion,
    liabilityWaiverAcceptanceText: currentLiabilityWaiverAcceptanceText
  };
}
