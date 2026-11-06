// @vitest-environment happy-dom
// Synthetic session/fetch/Web Locks responses test UI boundaries, not real Clerk,
// Convex pagination or browser lock behavior. Root supplies those release proofs.
import { webcrypto } from "node:crypto";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calendarMutationFingerprint, type CalendarEvent, type CalendarMutationIdentity, type CalendarRangePage } from "./lib/calendar-contract";
import { calendarOperationChangeEvent, calendarOperationFor, calendarOperationStorageKey } from "./lib/calendar-recovery";

const session = vi.hoisted(() => ({ status: "signed-in", email: "synthetic@staff.invalid", staffFetch: vi.fn(), signOut: vi.fn() }));
vi.mock("@/components/staff-auth-provider", () => ({ useStaffSession: () => ({ ...session }) }));
import { AdminCalendarClient } from "./components/admin-calendar-client";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const event: CalendarEvent = { eventRef: "PEV20261003-ABC123", visitDate: "2026-10-03", status: "confirmed", label: "Synthetic reception",
  confirmationSource: "owner-confirmation", sourceRef: "Synthetic owner note", notes: "Synthetic note", createdAt: 50 };
type Requests = Array<{ url: string; body?: Record<string, unknown> }>;
let server: { role: "admin" | "viewer"; events: CalendarEvent[]; event: CalendarEvent | null; requests: Requests;
  createMode: "ok" | "lost" | "malformed" | "http400" | "conflict" | "atomic" | "wrongReceipt"; cancelMode: "ok" | "lost" | "malformed";
  operationMode: "ok" | "malformed" | "lost"; rangeResponse?: (params: URLSearchParams) => unknown };
function installLocks() {
  const held = new Set<string>();
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: async (name: string, _options: unknown, callback: (lock: unknown) => Promise<void>) => {
    if (held.has(name)) return callback(null); held.add(name);
    try { return await callback({ name }); } finally { held.delete(name); }
  } } });
}
function rangePage(params: URLSearchParams, extra: Partial<CalendarRangePage> = {}) {
  return { role: server.role, range: { from: params.get("from"), to: params.get("to") }, cutoff: 100, events: server.events,
    continueCursor: null, isDone: true, pageStatus: null, splitCursor: null, endCursor: params.get("endCursor"), segmentDone: true, ...extra };
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.parse("2026-10-02T19:00:00.000Z"));
  vi.stubGlobal("crypto", webcrypto); window.localStorage.clear(); installLocks();
  session.status = "signed-in"; session.email = "synthetic@staff.invalid"; session.signOut.mockReset().mockResolvedValue(undefined);
  server = { role: "admin", events: [], event: null, requests: [], createMode: "ok", cancelMode: "ok", operationMode: "ok" };
  session.staffFetch.mockReset().mockImplementation(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    server.requests.push({ url, body });
    const params = new URL(url, "https://skydeckla.com").searchParams;
    if (url.startsWith("/api/admin/private-events/operation?")) {
      if (server.operationMode === "lost") throw new Error("synthetic lost read");
      if (server.operationMode === "malformed") return json({ role: "admin", event: server.event });
      return json({ role: server.role, lookup: params.has("key") ? { key: params.get("key") } : { eventRef: params.get("event") }, event: server.event });
    }
    if (url.startsWith("/api/admin/private-events?")) return json(server.rangeResponse ? server.rangeResponse(params) : rangePage(params));
    if (url === "/api/admin/private-events") {
      if (server.createMode === "conflict") return json({ error: "Synthetic date conflict" }, 409);
      if (server.createMode === "atomic" || server.createMode === "wrongReceipt") {
        return json({ error: "Synthetic date conflict", code: "calendar_mutation_rejected", rejection: {
          kind: "private_event_rejected", version: 1, operation: "create", lookup: { key: server.createMode === "atomic" ? body!.idempotencyKey : "calendar:differentkey" },
          requestFingerprint: calendarMutationFingerprint({ kind: "create", request: body } as CalendarMutationIdentity), message: "Synthetic date conflict"
        } }, 409);
      }
      server.event = { ...event, visitDate: body!.visitDate as string, eventRef: `PEV${String(body!.visitDate).replaceAll("-", "")}-ABC123`,
        label: body!.label as string, notes: body!.notes as string | undefined, confirmationSource: body!.confirmationSource as CalendarEvent["confirmationSource"], sourceRef: body!.sourceRef as string };
      if (server.createMode === "lost") throw new Error("synthetic lost committed reply");
      if (server.createMode === "http400") return json({ error: "Unexpected end of JSON input" }, 400);
      if (server.createMode === "malformed") return json({ role: "admin", event: server.event });
      return json({ role: "admin", event: server.event, reused: false }, 201);
    }
    if (url === "/api/admin/private-events/cancel") {
      server.event = { ...server.event!, status: "cancelled", cancelledAt: 80, cancelReason: body!.reason as string };
      if (server.cancelMode === "lost") throw new Error("synthetic lost cancelled reply");
      if (server.cancelMode === "malformed") return json({ role: "admin", event: { ...server.event, status: "confirmed" }, reused: false });
      return json({ role: "admin", event: server.event, reused: false });
    }
    throw new Error(`Unexpected synthetic request: ${url}`);
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); delete (navigator as { locks?: unknown }).locks; });
async function mount() { const view = render(<AdminCalendarClient />); await screen.findByText("The selected range has finished loading."); return view; }
async function fillCreate() {
  fireEvent.click(screen.getByRole("button", { name: "Record confirmed event" }));
  await screen.findByLabelText("Event label");
  enterCreate();
}
function enterCreate() {
  fireEvent.change(screen.getByLabelText("Event date, Los Angeles"), { target: { value: event.visitDate } });
  fireEvent.change(screen.getByLabelText("Event label"), { target: { value: event.label } });
  fireEvent.change(screen.getByLabelText("Confirmation source reference"), { target: { value: event.sourceRef } });
  fireEvent.change(screen.getByLabelText("Notes, optional"), { target: { value: event.notes } });
}
const posts = () => server.requests.filter(request => request.body);
const pointer = () => window.localStorage.getItem(calendarOperationStorageKey);
async function lostCreate(mode: "lost" | "malformed" | "http400" = "lost") {
  server.createMode = mode; await mount(); await fillCreate(); fireEvent.click(screen.getByRole("button", { name: "Confirm full-day block" }));
  await screen.findByText(/The change could not be verified/); expect(pointer()).not.toBeNull();
}
async function selectExisting() {
  server.events = [event]; server.event = event; const view = await mount();
  fireEvent.click(screen.getByRole("button", { name: /Synthetic reception/ }));
  await screen.findByRole("button", { name: "Cancel this block" });
  return view;
}

describe("calendar staff UI and source boundaries", () => {
  it("loads genuine-provider-pattern identity, LA range and a keyboard focusable labeled confirmation form", async () => {
    await mount(); expect(screen.getByText("synthetic@staff.invalid")).toBeTruthy();
    expect((screen.getByLabelText("From, Los Angeles date") as HTMLInputElement).value).toBe("2026-10-02");
    expect((screen.getByLabelText("Through, Los Angeles date") as HTMLInputElement).value).toBe("2026-10-31");
    await fillCreate(); expect(document.activeElement?.getAttribute("aria-label")).toBe("Selected event or confirmation");
    expect(document.activeElement?.contains(screen.getByRole("heading", { name: "Record confirmed event" }))).toBe(true);
    expect(screen.getByText(/Use a confirmed source, not an inquiry/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm full-day block" }));
    await screen.findByText(/The confirmed block is recorded/);
    expect(pointer()).toBeNull(); expect(posts()).toHaveLength(1);
    expect(posts()[0]?.body).toMatchObject({ visitDate: event.visitDate, confirmationSource: event.confirmationSource, sourceRef: event.sourceRef });
    expect(screen.queryByText("The selected range has finished loading.")).toBeNull();
  });
  it("shows viewer records and source evidence with no create or cancel controls", async () => {
    server.role = "viewer"; server.events = [event]; server.event = event; await mount();
    expect(screen.queryByRole("button", { name: "Record confirmed event" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Synthetic reception/ })); await screen.findByText("Current record loaded.");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Selected event or confirmation");
    expect(document.activeElement?.contains(screen.getByRole("heading", { name: event.label }))).toBe(true);
    expect(screen.queryByRole("button", { name: "Cancel this block" })).toBeNull(); expect(screen.getAllByText(/Synthetic owner note/).length).toBeGreaterThan(0);
    expect(posts()).toEqual([]);
  });
  it.each(["unconfigured", "signed-out", "loading", "signing-out"])("offers no protected reads or edits when %s", status => {
    session.status = status; render(<AdminCalendarClient />); expect(session.staffFetch).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Event label")).toBeNull(); expect(screen.queryByRole("button", { name: "Record confirmed event" })).toBeNull();
  });
  it("denies roles outside the supported server role projection", async () => {
    server.rangeResponse = params => rangePage(params, { role: "pos" as "admin" }); render(<AdminCalendarClient />);
    await screen.findByText("Calendar response could not be verified"); expect(screen.queryByRole("button", { name: "Record confirmed event" })).toBeNull();
  });
  it("retains legacy source absence as a block and preserves cancelled first reason", async () => {
    const legacy = { ...event, confirmationSource: undefined, sourceRef: undefined };
    server.events = [legacy]; server.event = legacy; await mount();
    fireEvent.click(screen.getByRole("button", { name: /Synthetic reception/ })); await screen.findByText(/Source not recorded. This retained record/);
    server.event = { ...legacy, status: "cancelled", cancelledAt: 80, cancelReason: "First synthetic reason" };
    fireEvent.click(screen.getByRole("button", { name: /Synthetic reception/ }));
    await screen.findByText(/First cancellation reason: First synthetic reason/);
    expect(document.activeElement?.contains(screen.getByRole("heading", { name: event.label }))).toBe(true);
    expect(screen.queryByRole("button", { name: "Cancel this block" })).toBeNull();
  });
});

describe("calendar mutation uncertainty, reload and exact retry", () => {
  it.each(["lost", "malformed", "http400"] as const)("keeps a committed %s reply locked until exact lookup recovers", async mode => {
    await lostCreate(mode);
    expect((screen.getByRole("button", { name: "Record confirmed event" }) as HTMLButtonElement).disabled).toBe(true);
    const raw = pointer()!; expect(raw).not.toContain(event.label); expect(raw).not.toContain(event.notes!); expect(raw).not.toContain(event.sourceRef!); expect(raw).not.toContain(session.email);
    fireEvent.click(screen.getByRole("button", { name: "Check status" })); await screen.findByText(/The confirmed block is recorded/);
    expect(pointer()).toBeNull(); expect(posts()).toHaveLength(1);
  });
  it("retains untyped business409 because status alone is not a no-commit receipt", async () => {
    server.createMode = "conflict"; await mount(); await fillCreate(); fireEvent.click(screen.getByRole("button", { name: "Confirm full-day block" }));
    await screen.findByText(/The change could not be verified/); expect(pointer()).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Check status" })); await screen.findByText(/Its absence does not prove failure/); expect(pointer()).not.toBeNull();
  });
  it("releases a fresh operation only on an exact atomic no-commit receipt", async () => {
    server.createMode = "atomic"; await mount(); await fillCreate(); fireEvent.click(screen.getByRole("button", { name: "Confirm full-day block" }));
    await screen.findByText(/This change was rejected; no block was changed by this request/);
    expect(pointer()).toBeNull(); expect(posts()).toHaveLength(1); expect(server.event).toBeNull();
    expect((screen.getByRole("button", { name: "Record confirmed event" }) as HTMLButtonElement).disabled).toBe(false);
  });
  it("a mismatched rejection receipt remains uncertain instead of clearing the original pointer", async () => {
    server.createMode = "wrongReceipt"; await mount(); await fillCreate(); fireEvent.click(screen.getByRole("button", { name: "Confirm full-day block" }));
    await screen.findByText(/The change could not be verified/); expect(pointer()).not.toBeNull();
  });
  it("rejection cleanup cannot clear a foreign operation that arrives before its lock is reacquired", async () => {
    server.createMode = "atomic"; await mount(); await fillCreate(); let calls = 0; let foreignRaw = "";
    Object.defineProperty(navigator, "locks", { configurable: true, value: { request: async (name: string, _options: unknown, callback: (lock: unknown) => Promise<void>) => {
      calls += 1;
      if (calls === 2) {
        const old = JSON.parse(pointer()!); foreignRaw = JSON.stringify({ ...old, key: "calendar:foreign-receipt" });
        window.localStorage.setItem(calendarOperationStorageKey, foreignRaw);
        window.dispatchEvent(new StorageEvent("storage", { key: calendarOperationStorageKey }));
      }
      return callback({ name });
    } } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm full-day block" }));
    await screen.findByText(/Recovery cleanup could not be verified/); expect(pointer()).toBe(foreignRaw);
    expect(screen.queryByText(/no block was changed by this request/)).toBeNull(); expect(posts()).toHaveLength(1);
  });
  it("after reload recovers an existing exact event without posting or storing form text", async () => {
    await lostCreate(); const oldPointer = pointer(); cleanup(); await mount();
    expect(pointer()).toBe(oldPointer); fireEvent.click(screen.getByRole("button", { name: "Check status" }));
    await screen.findByText(/The confirmed block is recorded/); expect(pointer()).toBeNull(); expect(posts()).toHaveLength(1);
  });
  it("absent lookup is still uncertain; reload requires exact reentered body and checks lookup before retry", async () => {
    await lostCreate(); server.event = null; cleanup(); await mount();
    fireEvent.click(screen.getByRole("button", { name: "Check status" })); await screen.findByText(/Its absence does not prove failure/);
    const raw = pointer(); fireEvent.click(screen.getByRole("button", { name: "Retry same change" })); enterCreate();
    fireEvent.change(screen.getByLabelText("Confirmation source reference"), { target: { value: "Changed synthetic source" } });
    fireEvent.click(screen.getByRole("button", { name: "Retry original confirmation" })); await screen.findByText(/These details do not match/);
    expect(posts()).toHaveLength(1); expect(pointer()).toBe(raw);
    fireEvent.change(screen.getByLabelText("Confirmation source reference"), { target: { value: event.sourceRef } }); server.createMode = "ok";
    fireEvent.click(screen.getByRole("button", { name: "Retry original confirmation" })); await screen.findByText(/The confirmed block is recorded/);
    expect(posts()).toHaveLength(2); expect(posts()[1]?.body).toEqual(posts()[0]?.body); expect(pointer()).toBeNull();
    const replayIndex = server.requests.indexOf(posts()[1]!); expect(server.requests[replayIndex - 1]?.url).toContain("operation?key=");
  });
  it("never releases a prior unknown just because its exact retry gets a rejection", async () => {
    await lostCreate(); server.event = null; server.createMode = "conflict"; const raw = pointer();
    fireEvent.click(screen.getByRole("button", { name: "Retry same change" }));
    await waitFor(() => expect(posts()).toHaveLength(2)); await screen.findByText(/The change could not be verified/);
    expect(pointer()).toBe(raw); expect(posts()[1]?.body).toEqual(posts()[0]?.body);
  });
  it("an exact atomic receipt for retry does not disprove the prior unknown operation", async () => {
    await lostCreate(); server.event = null; server.createMode = "atomic"; const raw = pointer();
    fireEvent.click(screen.getByRole("button", { name: "Retry same change" }));
    await waitFor(() => expect(posts()).toHaveLength(2)); await screen.findByText(/The change could not be verified/);
    expect(pointer()).toBe(raw); expect(posts()[1]?.body).toEqual(posts()[0]?.body);
  });
  it.each(["malformed", "lost"] as const)("keeps malformed or failed operation %s reads locked", async mode => {
    await lostCreate(); const raw = pointer(); server.operationMode = mode;
    fireEvent.click(screen.getByRole("button", { name: "Check status" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Check status" }) as HTMLButtonElement).disabled).toBe(false));
    expect(pointer()).toBe(raw); expect(screen.queryByText(/The confirmed block is recorded/)).toBeNull();
  });
  it("keeps a wrong source returned by an exact-key lookup unresolved", async () => {
    await lostCreate(); server.event = { ...server.event!, sourceRef: "Wrong synthetic source" };
    fireEvent.click(screen.getByRole("button", { name: "Check status" })); await screen.findByText(/does not match the original confirmation/); expect(pointer()).not.toBeNull();
  });
  it("synchronous guards freeze form and prevent repeated dispatch before React renders busy", async () => {
    await mount(); await fillCreate(); let release!: (response: Response) => void;
    const original = session.staffFetch.getMockImplementation()!;
    session.staffFetch.mockImplementation((url: string, init?: RequestInit) => url === "/api/admin/private-events" ? new Promise<Response>(resolve => { server.requests.push({ url, body: JSON.parse(String(init?.body)) }); release = resolve; }) : original(url, init));
    const submit = screen.getByRole("button", { name: "Confirm full-day block" }); const input = screen.getByLabelText("Event label");
    act(() => { fireEvent.click(submit); fireEvent.click(submit); fireEvent.change(input, { target: { value: "Changed while pending" } }); });
    await waitFor(() => expect(posts()).toHaveLength(1)); expect(posts()[0]?.body?.label).toBe(event.label);
    await act(async () => { release(json({ role: "admin", event, reused: false }, 201)); });
    await screen.findByText(/The confirmed block is recorded/); expect(posts()).toHaveLength(1);
  });
  it("refuses another pending operation in this browser and preserves foreign identity on delayed success", async () => {
    await mount(); await fillCreate(); let release!: (response: Response) => void;
    session.staffFetch.mockImplementation((url: string, init?: RequestInit) => {
      server.requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Promise<Response>(resolve => { release = resolve; });
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm full-day block" })); await waitFor(() => expect(posts()).toHaveLength(1));
    const foreign = await calendarOperationFor({ kind: "create", request: { ...posts()[0]!.body, idempotencyKey: "calendar:foreignchange1" } } as CalendarMutationIdentity);
    await act(async () => { window.localStorage.setItem(calendarOperationStorageKey, JSON.stringify(foreign)); window.dispatchEvent(new StorageEvent("storage", { key: calendarOperationStorageKey })); release(json({ role: "admin", event, reused: false })); });
    expect(pointer()).toBe(JSON.stringify(foreign)); expect(screen.queryByText(/The confirmed block is recorded/)).toBeNull();
  });
  it("ignores old staff success without clearing its durable pointer", async () => {
    const view = await mount(); await fillCreate(); let release!: (response: Response) => void;
    session.staffFetch.mockImplementation((url: string, init?: RequestInit) => { server.requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined }); return new Promise<Response>(resolve => { release = resolve; }); });
    fireEvent.click(screen.getByRole("button", { name: "Confirm full-day block" })); await waitFor(() => expect(posts()).toHaveLength(1));
    const raw = pointer(); session.status = "signed-out"; view.rerender(<AdminCalendarClient />);
    await act(async () => { release(json({ role: "admin", event, reused: false })); });
    expect(pointer()).toBe(raw); expect(screen.queryByText(/The confirmed block is recorded/)).toBeNull(); expect(screen.queryByRole("button", { name: "Record confirmed event" })).toBeNull();
  });
  it("a new signed-in viewer cannot inherit the old admin role or clear its settling POST", async () => {
    const view = await mount(); await fillCreate(); let release!: (response: Response) => void;
    const original = session.staffFetch.getMockImplementation()!;
    session.staffFetch.mockImplementation((url: string, init?: RequestInit) => url === "/api/admin/private-events" ? new Promise<Response>(resolve => { server.requests.push({ url, body: JSON.parse(String(init?.body)) }); release = resolve; }) : original(url, init));
    fireEvent.click(screen.getByRole("button", { name: "Confirm full-day block" })); await waitFor(() => expect(posts()).toHaveLength(1));
    const raw = pointer(); server.role = "viewer"; session.email = "new-viewer@staff.invalid"; view.rerender(<AdminCalendarClient />);
    await screen.findByText(/This account can read recorded events/);
    await act(async () => { release(json({ role: "admin", event, reused: false })); });
    expect(pointer()).toBe(raw); expect(screen.queryByRole("button", { name: "Record confirmed event" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry same change" })).toBeNull(); expect(screen.queryByText(/The confirmed block is recorded/)).toBeNull();
  });
  it("safely refuses change without a supported lock manager", async () => {
    await mount(); await fillCreate(); delete (navigator as { locks?: unknown }).locks;
    fireEvent.click(screen.getByRole("button", { name: "Confirm full-day block" })); await screen.findByText(/cannot safely coordinate calendar tabs/);
    expect(posts()).toEqual([]); expect(pointer()).toBeNull();
  });
  it("shows truthfully verified event but keeps failed local cleanup locked", async () => {
    await lostCreate(); const raw = pointer(); const remove = vi.spyOn(window.localStorage, "removeItem").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: "Check status" })); await screen.findByText(/could not finish recovery cleanup/);
    expect(pointer()).toBe(raw); expect((screen.getByRole("button", { name: "Record confirmed event" }) as HTMLButtonElement).disabled).toBe(true);
    remove.mockRestore();
  });
});

describe("calendar cancellation and bounded coverage", () => {
  it("freshly rereads before cancellation and preserves the stored first reason after a lost reply", async () => {
    await selectExisting(); fireEvent.change(screen.getByLabelText("Cancellation reason"), { target: { value: "Original synthetic reason" } }); server.cancelMode = "lost";
    fireEvent.click(screen.getByRole("button", { name: "Cancel this block" })); await screen.findByText(/The change could not be verified/);
    const cancelIndex = server.requests.findIndex(request => request.url === "/api/admin/private-events/cancel"); expect(server.requests[cancelIndex - 1]?.url).toContain("operation?event=");
    server.event = { ...server.event!, cancelReason: "Another admin's first reason" };
    fireEvent.click(screen.getByRole("button", { name: "Check status" })); await screen.findByText(/First cancellation reason: Another admin's first reason/);
    expect(pointer()).toBeNull(); expect(posts()).toHaveLength(1); expect(screen.queryByRole("button", { name: "Cancel this block" })).toBeNull();
  });
  it("does not post if the fresh selected read already reports cancelled", async () => {
    await selectExisting(); server.event = { ...event, status: "cancelled", cancelledAt: 80, cancelReason: "First synthetic reason" };
    fireEvent.change(screen.getByLabelText("Cancellation reason"), { target: { value: "New synthetic reason" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel this block" })); await screen.findByText(/already cancelled. Its first reason/);
    expect(posts()).toEqual([]); expect(pointer()).toBeNull(); await screen.findByText(/First cancellation reason: First synthetic reason/);
  });
  it("cancel reload keeps a confirmed lookup uncertain and requires the original reason before retry", async () => {
    await selectExisting(); fireEvent.change(screen.getByLabelText("Cancellation reason"), { target: { value: "Original synthetic reason" } }); server.cancelMode = "lost";
    fireEvent.click(screen.getByRole("button", { name: "Cancel this block" })); await screen.findByText(/The change could not be verified/);
    const raw = pointer(); server.event = event; cleanup(); await mount();
    fireEvent.click(screen.getByRole("button", { name: "Check status" })); await screen.findByText(/Its absence does not prove failure/);
    expect(pointer()).toBe(raw); fireEvent.click(screen.getByRole("button", { name: "Retry same change" }));
    fireEvent.change(screen.getByLabelText("Original cancellation reason"), { target: { value: "Changed reason" } });
    fireEvent.click(screen.getByRole("button", { name: "Retry original cancellation" })); await screen.findByText(/These details do not match/); expect(posts()).toHaveLength(1);
    server.cancelMode = "ok"; fireEvent.change(screen.getByLabelText("Original cancellation reason"), { target: { value: "Original synthetic reason" } });
    fireEvent.click(screen.getByRole("button", { name: "Retry original cancellation" })); await screen.findByText(/The block is cancelled/);
    expect(pointer()).toBeNull(); expect(posts()).toHaveLength(2); expect(posts()[1]?.body).toEqual(posts()[0]?.body);
  });
  it("a fresh lookup failure cannot dispatch cancellation or claim success", async () => {
    await selectExisting(); server.operationMode = "malformed";
    fireEvent.change(screen.getByLabelText("Cancellation reason"), { target: { value: "Synthetic reason" } }); fireEvent.click(screen.getByRole("button", { name: "Cancel this block" }));
    await screen.findByText("Calendar response could not be verified"); expect(posts()).toEqual([]); expect(pointer()).toBeNull();
    expect(screen.queryByText(/The block is cancelled/)).toBeNull();
  });
  it("session changes during a fresh cancellation read prevent POST", async () => {
    const view = await selectExisting(); let release!: (response: Response) => void;
    session.staffFetch.mockImplementation(() => new Promise<Response>(resolve => { release = resolve; }));
    fireEvent.change(screen.getByLabelText("Cancellation reason"), { target: { value: "Synthetic reason" } }); fireEvent.click(screen.getByRole("button", { name: "Cancel this block" }));
    await waitFor(() => expect(typeof release).toBe("function")); session.email = "other-synthetic@staff.invalid";
    // Prevent the new identity's automatic read from replacing the delayed cancellation callback.
    session.status = "signed-out"; view?.rerender?.(<AdminCalendarClient />);
    // Actual provider remount cleanup is also exercised by unmount here.
    cleanup(); await act(async () => { release(json({ role: "admin", lookup: { eventRef: event.eventRef }, event })); });
    expect(posts()).toEqual([]); expect(pointer()).toBeNull();
  });
  it("loads only a bounded batch, advances empty pages and explicitly continues before complete coverage", async () => {
    let count = 0;
    server.rangeResponse = params => { count += 1; return rangePage(params, count < 10 ? { isDone: false, segmentDone: false, continueCursor: `cursor-${count}`, events: [] } : { events: [event] }); };
    render(<AdminCalendarClient />); await screen.findByText("More records remain to be loaded."); expect(count).toBe(8);
    expect(screen.getByText(/only partly loaded/)).toBeTruthy(); fireEvent.click(screen.getByRole("button", { name: "Load more records" }));
    await screen.findByText("The selected range has finished loading."); expect(count).toBe(10); expect(screen.getByRole("button", { name: /Synthetic reception/ })).toBeTruthy();
  });
  it("discards a split page, traverses both bounded halves and verifies outer completion", async () => {
    const seen: Array<[string | null, string | null]> = [];
    server.rangeResponse = params => {
      const cursor = params.get("cursor"), end = params.get("endCursor"); seen.push([cursor, end]);
      if (!cursor && !end) return rangePage(params, { isDone: false, segmentDone: false, pageStatus: "SplitRequired", splitCursor: "M", continueCursor: "E", events: [{ ...event, label: "Discard this synthetic split" }] });
      if (end) return rangePage(params, { isDone: false, events: cursor ? [] : [event] });
      return rangePage(params, { events: [] });
    };
    await mount(); expect(seen).toEqual([[null, null], [null, "M"], ["M", "E"], ["E", null]]);
    expect(screen.queryByText("Discard this synthetic split")).toBeNull(); expect(screen.getByRole("button", { name: /Synthetic reception/ })).toBeTruthy();
  });
  it("rejects duplicate records across pages rather than claiming complete coverage", async () => {
    server.rangeResponse = params => rangePage(params, params.has("cursor") ? { events: [event] } : { events: [event], isDone: false, segmentDone: false, continueCursor: "next" });
    render(<AdminCalendarClient />); await screen.findByText(/returned conflicting records/); expect(screen.queryByText("The selected range has finished loading.")).toBeNull();
    expect(screen.getByText(/range is not verified/)).toBeTruthy(); expect((screen.getByRole("button", { name: /Synthetic reception/ }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("previous30days uses an inclusive historical LA range without conflating history and availability", async () => {
    await mount(); fireEvent.click(screen.getByRole("button", { name: "Previous 30 days" })); await screen.findByText("The selected range has finished loading.");
    await waitFor(() => expect(server.requests.at(-1)?.url).toContain("from=2026-09-02&to=2026-10-01"));
    expect(screen.getByText(/External reservations and normal-visit capacity still need checking/)).toBeTruthy();
  });
  it("does not overwrite a verified mutation outcome when the subsequent manual refresh fails", async () => {
    await mount(); await fillCreate(); fireEvent.click(screen.getByRole("button", { name: "Confirm full-day block" })); await screen.findByText(/The confirmed block is recorded/);
    server.rangeResponse = () => ({ malformed: true }); fireEvent.click(screen.getByRole("button", { name: "Refresh range" }));
    await screen.findByText("Calendar response could not be verified"); expect(server.event?.status).toBe("confirmed"); expect(posts()).toHaveLength(1);
    // Its detail remains factual; refresh error does not say the original confirmation failed.
    expect(screen.getByText(/The confirmed block is recorded/)).toBeTruthy(); expect(pointer()).toBeNull();
  });
  it("storage corruption blocks mutations without erasing browser evidence", async () => {
    await mount(); await act(async () => { window.localStorage.setItem(calendarOperationStorageKey, "corrupt synthetic evidence"); window.dispatchEvent(new Event(calendarOperationChangeEvent)); });
    await screen.findByText(/cannot read its pending calendar change safely/); expect((screen.getByRole("button", { name: "Record confirmed event" }) as HTMLButtonElement).disabled).toBe(true);
    expect(pointer()).toBe("corrupt synthetic evidence"); expect(posts()).toEqual([]);
  });
});
