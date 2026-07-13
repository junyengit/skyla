// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sessionMocks = vi.hoisted(() => ({
  signOut: vi.fn(),
  staffFetch: vi.fn()
}));

vi.mock("@/components/staff-auth-provider", () => ({
  useStaffSession: () => ({
    status: "signed-in",
    email: "admin@example.com",
    staffFetch: sessionMocks.staffFetch,
    signOut: sessionMocks.signOut
  })
}));

import { AdminOpsClient } from "./components/admin-ops-client";

const adminClient = readFileSync(join(import.meta.dirname, "components/admin-ops-client.tsx"), "utf8");
const scrollIntoView = vi.fn();

const hours = {
  Monday: { open: "09:00", close: "00:00", closed: false },
  Tuesday: { open: "09:00", close: "00:00", closed: false },
  Wednesday: { open: "09:00", close: "00:00", closed: false },
  Thursday: { open: "09:00", close: "00:00", closed: false },
  Friday: { open: "09:00", close: "00:00", closed: false },
  Saturday: { open: "09:00", close: "00:00", closed: false },
  Sunday: { open: "09:00", close: "00:00", closed: false }
};

const inquiry = {
  inquiryId: "inq_100",
  firstName: "Avery",
  lastName: "Stone",
  email: "avery@example.com",
  status: "pending",
  experience: "private-events",
  eventDate: "2026-08-20",
  guestCount: "24",
  notes: "Needs a sunset seating plan.",
  source: "website",
  createdAt: 1_782_000_000_000,
  updatedAt: 1_782_000_100_000
};

const operationsSnapshot = {
  staff: { emailLower: "admin@example.com", role: "admin" },
  readiness: {
    stripeMode: true,
    stripeSecret: true,
    stripeWebhookSecret: true,
    terminalReaderRegistry: false,
    terminalAcceptance: false,
    paymentReturnOrigins: true
  },
  counts: {
    draftOrders: { value: 7, capped: false },
    pendingOrders: { value: 2, capped: false },
    draftPosSales: { value: 1, capped: false },
    pendingPosSales: { value: 0, capped: false },
    pendingMembers: { value: 3, capped: false },
    approvedMembers: { value: 9, capped: false }
  },
  recent: {
    orders: [
      {
        orderRef: "ORDER-100",
        status: "payment_pending",
        totalCents: 6090,
        currency: "usd",
        createdAt: 1_782_000_000_000,
        updatedAt: 1_782_000_100_000
      }
    ],
    posSales: [],
    paymentEvents: [],
    refunds: [],
    bookings: [],
    members: []
  }
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function configureStaffFetch(inquiryListStatus = 200) {
  sessionMocks.staffFetch.mockImplementation(async (input: string, init?: RequestInit) => {
    if (input === "/api/admin/operations?limit=12") return json(operationsSnapshot);
    if (input === "/api/admin/config") {
      return json({
        staff: operationsSnapshot.staff,
        config: { announcement: { active: false, text: "", type: "info" }, hours },
        state: { announcement: { invalid: false }, hours: { invalid: false } },
        editableKeys: ["announcement", "hours"]
      });
    }
    if (input === "/api/admin/catalog") {
      return json({ activeVersion: null, versions: [], currentProducts: [] });
    }
    if (input === "/api/admin/inquiries?limit=25") {
      return inquiryListStatus === 200
        ? json({
            staff: operationsSnapshot.staff,
            inquiries: [
              {
                inquiryId: inquiry.inquiryId,
                status: inquiry.status,
                contactMasked: "a***@example.com",
                experience: inquiry.experience,
                eventDate: inquiry.eventDate,
                guestCount: inquiry.guestCount,
                source: inquiry.source,
                createdAt: inquiry.createdAt,
                updatedAt: inquiry.updatedAt
              }
            ]
          })
        : json({ error: "Experience inquiry service is temporarily unavailable" }, inquiryListStatus);
    }
    if (input.startsWith("/api/admin/inquiries/detail?inquiryId=")) {
      return json({ staff: operationsSnapshot.staff, inquiry });
    }
    if (input === "/api/admin/inquiries/update" && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as { status?: string; notes?: string };
      return json({ inquiry: { ...inquiry, ...body, updatedAt: inquiry.updatedAt + 1 } });
    }
    throw new Error(`Unexpected staff request: ${input}`);
  });
}

function renderAdmin() {
  return render(
    createElement(AdminOpsClient, {
      catalog: [{ key: "general", kind: "ticket", name: "General Admission", priceCents: 6090, active: true }],
      catalogState: {
        version: "v1",
        source: "code",
        authority: "server",
        editableInAdmin: false
      }
    })
  );
}

async function loadSnapshot() {
  fireEvent.click(screen.getByRole("button", { name: "Load Snapshot" }));
  await screen.findByText("ORDER-100");
}

beforeEach(() => {
  sessionMocks.staffFetch.mockReset();
  sessionMocks.signOut.mockReset();
  scrollIntoView.mockReset();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: scrollIntoView
  });
});

afterEach(() => {
  cleanup();
});

describe("admin inquiry triage UI", () => {
  it("keeps sensitive detail fields out of the masked inquiry summary", () => {
    const summaryStart = adminClient.indexOf('{activeTab === "inquiries"\n              ? inquiries.map');
    const detailStart = adminClient.indexOf('{activeTab === "inquiries" && selectedInquiry ?');
    const summaryMarkup = adminClient.slice(summaryStart, detailStart);

    expect(summaryStart).toBeGreaterThan(-1);
    expect(detailStart).toBeGreaterThan(summaryStart);
    expect(summaryMarkup).toContain("inquiry.contactMasked");
    expect(summaryMarkup).not.toContain("inquiry.email");
    expect(summaryMarkup).not.toContain("inquiry.firstName");
    expect(summaryMarkup).not.toContain("inquiry.lastName");
    expect(summaryMarkup).not.toContain("inquiry.notes");
  });

  it("preserves the successful operations snapshot when the inquiry list fails", async () => {
    configureStaffFetch(503);
    renderAdmin();

    await loadSnapshot();

    expect(screen.getByText("Staff authorized")).toBeTruthy();
    expect(screen.getByText("7")).toBeTruthy();
    expect(screen.queryByText("Snapshot locked")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Inquiries" }));

    expect(screen.getByRole("status").textContent).toContain("temporarily unavailable");
    expect(screen.queryByText("No recent records")).toBeNull();
  });

  it("uses an accessible pressed-button group to switch operation sections", async () => {
    configureStaffFetch();
    renderAdmin();
    await loadSnapshot();

    const ordersButton = screen.getByRole("button", { name: "Orders" });
    const inquiriesButton = screen.getByRole("button", { name: "Inquiries" });

    expect(screen.getByRole("group", { name: "Recent operations" })).toBeTruthy();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(ordersButton.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(inquiriesButton);

    expect(ordersButton.getAttribute("aria-pressed")).toBe("false");
    expect(inquiriesButton.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Private Events")).toBeTruthy();
  });

  it("scrolls to and focuses the inquiry editor before saving changes", async () => {
    configureStaffFetch();
    renderAdmin();
    await loadSnapshot();
    fireEvent.click(screen.getByRole("button", { name: "Inquiries" }));
    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    const status = await screen.findByRole("combobox", { name: "Status" });
    await waitFor(() => expect(document.activeElement).toBe(status));
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "nearest" });

    fireEvent.change(status, { target: { value: "qualified" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Notes" }), {
      target: { value: "Send the private event package." }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Inquiry" }));

    await waitFor(() => {
      const updateCall = sessionMocks.staffFetch.mock.calls.find(([input]) => input === "/api/admin/inquiries/update");
      expect(updateCall).toBeTruthy();
      expect(JSON.parse(String(updateCall?.[1]?.body))).toEqual({
        inquiryId: inquiry.inquiryId,
        status: "qualified",
        notes: "Send the private event package."
      });
    });
  });
});
