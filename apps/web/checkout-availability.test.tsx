// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CheckoutClient } from "./components/checkout-client";
import type { OperatingHours } from "./lib/operating-hours";

const operatingHours: OperatingHours = {
  Monday: { open: "00:00", close: "00:00", closed: true },
  Tuesday: { open: "12:00", close: "16:00", closed: false },
  Wednesday: { open: "11:00", close: "19:00", closed: false },
  Thursday: { open: "11:00", close: "19:00", closed: false },
  Friday: { open: "11:00", close: "21:00", closed: false },
  Saturday: { open: "10:00", close: "21:00", closed: false },
  Sunday: { open: "10:00", close: "18:00", closed: false }
};

function renderCheckout(hours: OperatingHours | null) {
  return render(
    <CheckoutClient
      packages={[{ key: "general", name: "General Admission", priceCents: 6000 }]}
      addons={[]}
      operatingHours={hours}
    />
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-13T12:00:00.000Z"));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("checkout operating-hour availability", () => {
  it("rejects a closed date and enables only entry times within the selected day's hours", () => {
    renderCheckout(operatingHours);

    expect(screen.getByText("Sky LA has no checkout arrival times on Monday. Choose another date.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "11:00 AM" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Review Order" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-07-14" } });

    expect(screen.getByText("Tuesday hours: 12:00 PM - 4:00 PM.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "11:00 AM" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "11:00 AM" }).getAttribute("style")).toContain("opacity: 0.38");
    expect((screen.getByRole("button", { name: "12:30 PM" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole("button", { name: "12:30 PM" }).className).toContain("isSelected");
    expect((screen.getByRole("button", { name: "5:00 PM" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps the existing checkout choices when public config is unavailable", () => {
    renderCheckout(null);

    expect(screen.queryByText(/hours:/i)).toBeNull();
    expect((screen.getByRole("button", { name: "11:00 AM" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "6:30 PM" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("uses the Los Angeles date before UTC midnight rolls back to the venue day", () => {
    vi.setSystemTime(new Date("2026-07-13T00:30:00.000Z"));

    renderCheckout(operatingHours);

    const dateInput = screen.getByLabelText("Date") as HTMLInputElement;
    expect(dateInput.value).toBe("2026-07-12");
    expect(dateInput.min).toBe("2026-07-12");
    expect(screen.getByText("Sunday hours: 10:00 AM - 6:00 PM.")).toBeTruthy();
  });
});
