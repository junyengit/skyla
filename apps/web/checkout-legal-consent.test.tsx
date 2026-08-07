// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  currentLiabilityWaiverVersion,
  currentTermsAcceptanceText,
  currentTermsVersion
} from "@skyla/payments";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CheckoutClient } from "./components/checkout-client";

const orderRef = "SKY2608-CONSENT";
const draftResponse = {
  draft: {
    status: "draft" as const,
    currency: "usd" as const,
    subtotalCents: 4000,
    feeCents: 0,
    totalCents: 4000,
    orderRef,
    lines: [
      {
        kind: "ticket",
        productKey: "general",
        name: "The View",
        quantity: 2,
        unitAmountCents: 2000,
        lineTotalCents: 4000
      }
    ]
  },
  orderRef,
  persisted: true
};

function renderCheckout() {
  return render(
    <CheckoutClient
      packages={[{ key: "general", name: "The View", priceCents: 2000 }]}
      addons={[]}
    />
  );
}

async function persistOrder(fetchMock: ReturnType<typeof vi.fn>) {
  fetchMock.mockResolvedValueOnce(Response.json(draftResponse));
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "guest@example.com" }
  });
  fireEvent.click(screen.getByRole("button", { name: "Review Order" }));
  await screen.findByText(`Stored as ${orderRef}`);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("checkout legal consent", () => {
  it("keeps card payment locked until both separate agreements are checked", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderCheckout();

    await persistOrder(fetchMock);

    const terms = screen.getByRole("checkbox", { name: /Terms of Use and Ticket Purchase Terms/i });
    const waiver = screen.getByRole("checkbox", { name: /Acknowledgment of Risk and Release of Liability/i });
    const payment = screen.getByRole("button", { name: "Continue to Card Payment" }) as HTMLButtonElement;

    expect((terms as HTMLInputElement).checked).toBe(false);
    expect((waiver as HTMLInputElement).checked).toBe(false);
    expect(payment.disabled).toBe(true);
    expect(
      terms
        .closest("label")
        ?.textContent?.replace(" (opens in a new tab)", "")
        .replace(/\s+/g, " ")
        .trim()
    ).toBe(currentTermsAcceptanceText);
    expect(screen.getByRole("link", { name: /Terms of Use and Ticket Purchase Terms/i }).getAttribute("target")).toBe("_blank");
    expect(screen.getByRole("link", { name: /Acknowledgment of Risk and Release of Liability/i }).getAttribute("target")).toBe("_blank");

    fireEvent.click(terms);
    expect(payment.disabled).toBe(true);
    fireEvent.click(waiver);
    expect(payment.disabled).toBe(false);
  });

  it("sends the accepted document versions and resets consent when the order changes", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderCheckout();

    await persistOrder(fetchMock);
    fireEvent.click(screen.getByRole("checkbox", { name: /Terms of Use and Ticket Purchase Terms/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Acknowledgment of Risk and Release of Liability/i }));

    fetchMock.mockResolvedValueOnce(
      Response.json({ url: "https://checkout.stripe.com/c/pay/cs_test_consent" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue to Card Payment" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      orderRef,
      idempotencyKey: expect.stringMatching(/^checkout_/),
      legalAcceptance: {
        termsAccepted: true,
        termsVersion: currentTermsVersion,
        liabilityWaiverAccepted: true,
        liabilityWaiverVersion: currentLiabilityWaiverVersion
      }
    });

    fireEvent.click(screen.getByRole("button", { name: "More adults" }));
    expect(screen.queryByRole("group", { name: "Before you pay" })).toBeNull();
    expect((screen.getByRole("button", { name: "Continue to Card Payment" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
