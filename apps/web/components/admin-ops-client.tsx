"use client";

import { useMemo, useState } from "react";
import { ArrowRight, CalendarDays, Download, ShieldCheck } from "@skyla/ui/icons";

type Readiness = {
  stripeMode: boolean;
  stripeSecret: boolean;
  stripeWebhookSecret: boolean;
  terminalReaderRegistry: boolean;
  terminalAcceptance: boolean;
  paymentReturnOrigins: boolean;
};

type BookingVoucher = {
  id: string;
  label: string;
  quantity: number;
  redeemed: number;
  remaining: number;
  source: "package" | "addon";
  packageKey?: string;
  addonKey?: string;
};

type BookingVouchers = {
  summary: {
    total: number;
    redeemed: number;
    remaining: number;
  };
  items: BookingVoucher[];
};

type AdminBooking = {
  bookingRef: string;
  orderRef?: string;
  visitDate?: string;
  status: string;
  emailLower?: string;
  firstName?: string;
  lastName?: string;
  partySize?: number;
  checkedInAt?: number;
  cancelledAt?: number;
  createdAt: number;
  updatedAt?: number;
  legacyId?: string;
  vouchers?: BookingVouchers;
};

type OperationsSnapshot = {
  staff: {
    emailLower: string;
    role: "admin" | "pos" | "viewer";
  };
  readiness: Readiness;
  counts: {
    draftOrders: { value: number; capped: boolean };
    pendingOrders: { value: number; capped: boolean };
    draftPosSales: { value: number; capped: boolean };
    pendingPosSales: { value: number; capped: boolean };
    pendingMembers: { value: number; capped: boolean };
    approvedMembers: { value: number; capped: boolean };
  };
  recent: {
    orders: Array<{
      orderRef: string;
      status: string;
      totalCents: number;
      currency: "usd";
      expectedProvider?: string;
      customerEmailLower?: string;
      visitDate?: string;
      entryTime?: string;
      createdAt: number;
      updatedAt: number;
    }>;
    posSales: Array<{
      saleRef: string;
      status: string;
      totalCents: number;
      currency: "usd";
      customerEmailLower?: string;
      readerId?: string;
      terminalLocationId?: string;
      createdAt: number;
      updatedAt: number;
    }>;
    paymentEvents: Array<{
      orderRef?: string;
      saleRef?: string;
      provider: string;
      providerPaymentId: string;
      status: string;
      amountCents: number;
      currency: "usd";
      rawEventId?: string;
      createdAt: number;
    }>;
    bookings: AdminBooking[];
    members: Array<{
      memberId: string;
      firstName?: string;
      lastName?: string;
      email?: string;
      status: string;
      emailLower?: string;
      phone?: string;
      tier?: string;
      source?: string;
      bio?: string;
      createdAt: number;
      updatedAt?: number;
      legacyId?: string;
    }>;
  };
};
type AnnouncementType = "info" | "warning" | "success";
type Weekday = "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday" | "Saturday" | "Sunday";

type AnnouncementConfig = {
  active: boolean;
  text: string;
  type: AnnouncementType;
};

type HoursDayConfig = {
  open: string;
  close: string;
  closed: boolean;
};

type HoursConfig = Record<Weekday, HoursDayConfig>;

type ConfigSnapshot = {
  staff: {
    emailLower: string;
    role: "admin" | "pos" | "viewer";
  };
  config: {
    announcement: AnnouncementConfig;
    hours: HoursConfig;
  };
  state: {
    announcement: { updatedAt?: number; updatedBy?: string; invalid: boolean };
    hours: { updatedAt?: number; updatedBy?: string; invalid: boolean };
  };
  editableKeys: Array<"announcement" | "hours">;
};

type CatalogSnapshot = {
  activeVersion: {
    version: string;
    status: "active" | "inactive";
    itemCount: number;
    activeItemCount: number;
    contentHash: string;
    editableInAdmin: boolean;
    activatedAt?: number;
  } | null;
  versions: Array<{
    version: string;
    status: "active" | "inactive";
    itemCount: number;
    activeItemCount: number;
    contentHash: string;
    editableInAdmin: boolean;
    activatedAt?: number;
  }>;
  currentProducts: CatalogItem[];
};

type BookingLookupResult = {
  staff: {
    emailLower: string;
    role: "admin" | "pos" | "viewer";
  };
  query: string;
  matchType: "bookingRef" | "email";
  matches: OperationsSnapshot["recent"]["bookings"];
};

type CatalogItem = {
  key: string;
  kind: "ticket" | "addon" | "cafe";
  name: string;
  priceCents: number;
  active: boolean;
};

type AdminOpsClientProps = {
  catalog: CatalogItem[];
  catalogState: {
    version: string;
    source: string;
    authority: string;
    editableInAdmin: boolean;
  };
};

type AdminTab = "orders" | "bookings" | "members" | "pos" | "payments";
type ExportKind = "bookings" | "members" | "inquiries" | "orders" | "posSales" | "payments";
type BookingAdminStatus = "confirmed" | "checked-in" | "cancelled";
type MemberAdminStatus = "pending" | "approved" | "waitlisted" | "rejected";

const readinessLabels: Record<keyof Readiness, string> = {
  stripeMode: "Stripe mode",
  stripeSecret: "Stripe API",
  stripeWebhookSecret: "Webhook",
  terminalReaderRegistry: "Readers",
  terminalAcceptance: "Terminal accepted",
  paymentReturnOrigins: "Return URLs"
};

const weekdays: Weekday[] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const exportActions: Array<{ kind: ExportKind; label: string }> = [
  { kind: "bookings", label: "Bookings" },
  { kind: "members", label: "Members" },
  { kind: "inquiries", label: "Inquiries" },
  { kind: "orders", label: "Orders" },
  { kind: "posSales", label: "POS" },
  { kind: "payments", label: "Payments" }
];

const defaultAnnouncement: AnnouncementConfig = {
  active: false,
  text: "",
  type: "info"
};

const defaultHours: HoursConfig = {
  Monday: { open: "09:00", close: "00:00", closed: false },
  Tuesday: { open: "09:00", close: "00:00", closed: false },
  Wednesday: { open: "09:00", close: "00:00", closed: false },
  Thursday: { open: "09:00", close: "00:00", closed: false },
  Friday: { open: "09:00", close: "00:00", closed: false },
  Saturday: { open: "09:00", close: "00:00", closed: false },
  Sunday: { open: "09:00", close: "00:00", closed: false }
};

function money(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(cents / 100);
}

function shortDate(value: number) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function totalReady(readiness: Readiness) {
  return Object.values(readiness).filter(Boolean).length;
}

function countLabel(count?: { value: number; capped: boolean }) {
  if (!count) {
    return "--";
  }
  return count.capped ? `${count.value}+` : String(count.value);
}

function exportLabel(kind: ExportKind) {
  return exportActions.find((item) => item.kind === kind)?.label ?? kind;
}

function filenameFromContentDisposition(value: string | null, kind: ExportKind) {
  const quoted = value?.match(/filename="([^"]+)"/);
  if (quoted?.[1]) {
    return quoted[1];
  }
  return `skyla-${kind}.csv`;
}

function maskedIdentifier(value?: string) {
  if (!value?.trim()) {
    return undefined;
  }
  const text = value.trim();
  if (text.length <= 8) {
    return `${text.slice(0, 2)}...`;
  }
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

export function AdminOpsClient({ catalog, catalogState }: AdminOpsClientProps) {
  const [staffToken, setStaffToken] = useState("");
  const [snapshot, setSnapshot] = useState<OperationsSnapshot | null>(null);
  const [configSnapshot, setConfigSnapshot] = useState<ConfigSnapshot | null>(null);
  const [convexCatalogSnapshot, setConvexCatalogSnapshot] = useState<CatalogSnapshot | null>(null);
  const [bookingLookup, setBookingLookup] = useState<BookingLookupResult | null>(null);
  const [bookingLookupQuery, setBookingLookupQuery] = useState("");
  const [announcementDraft, setAnnouncementDraft] = useState<AnnouncementConfig>(defaultAnnouncement);
  const [hoursDraft, setHoursDraft] = useState<HoursConfig>(defaultHours);
  const [activeTab, setActiveTab] = useState<AdminTab>("orders");
  const [isLoading, setIsLoading] = useState(false);
  const [isLookupLoading, setIsLookupLoading] = useState(false);
  const [exportKind, setExportKind] = useState<ExportKind | null>(null);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const readinessScore = useMemo(() => (snapshot ? totalReady(snapshot.readiness) : 0), [snapshot]);

  async function loadOperations() {
    const token = staffToken.trim();
    if (!token) {
      setMessage("Staff token required.");
      setSnapshot(null);
      setConfigSnapshot(null);
      setConvexCatalogSnapshot(null);
      return;
    }

    setIsLoading(true);
    setMessage(null);

    try {
      const headers = {
        Authorization: `Bearer ${token}`
      };
      const [operationsResponse, configResponse, catalogResponse] = await Promise.all([
        fetch("/api/admin/operations?limit=12", { headers }),
        fetch("/api/admin/config", { headers }),
        fetch("/api/admin/catalog", { headers })
      ]);
      const operationsData = (await operationsResponse.json()) as OperationsSnapshot | { error?: string; code?: string };
      const configData = (await configResponse.json()) as ConfigSnapshot | { error?: string; code?: string };
      const catalogData = (await catalogResponse.json()) as CatalogSnapshot | { error?: string; code?: string };
      if (!operationsResponse.ok) {
        throw new Error(
          "error" in operationsData ? operationsData.error ?? "Could not load admin operations" : "Could not load admin operations"
        );
      }
      if (!configResponse.ok) {
        throw new Error("error" in configData ? configData.error ?? "Could not load admin config" : "Could not load admin config");
      }
      if (!catalogResponse.ok) {
        throw new Error("error" in catalogData ? catalogData.error ?? "Could not load admin catalog" : "Could not load admin catalog");
      }
      setSnapshot(operationsData as OperationsSnapshot);
      setConfigSnapshot(configData as ConfigSnapshot);
      setConvexCatalogSnapshot(catalogData as CatalogSnapshot);
      setAnnouncementDraft((configData as ConfigSnapshot).config.announcement);
      setHoursDraft((configData as ConfigSnapshot).config.hours);
    } catch (error) {
      setSnapshot(null);
      setConfigSnapshot(null);
      setConvexCatalogSnapshot(null);
      setMessage(error instanceof Error ? error.message : "Could not load admin operations");
    } finally {
      setIsLoading(false);
    }
  }

  async function postAdminAction(
    endpoint: "/api/admin/bookings/status" | "/api/admin/bookings/vouchers" | "/api/admin/members/status",
    body: Record<string, string>
  ) {
    const token = staffToken.trim();
    if (!token) {
      setMessage("Staff token required.");
      return;
    }

    setActionKey(`${endpoint}:${Object.values(body).join(":")}`);
    setMessage(null);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(body)
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Admin action failed");
      }
      await loadOperations();
      if ((endpoint === "/api/admin/bookings/status" || endpoint === "/api/admin/bookings/vouchers") && bookingLookupQuery.trim()) {
        await lookupBooking({ silent: true });
      }
      setMessage("Admin action saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Admin action failed");
    } finally {
      setActionKey(null);
    }
  }

  function updateBookingStatus(bookingRef: string, status: BookingAdminStatus) {
    void postAdminAction("/api/admin/bookings/status", { bookingRef, status });
  }

  function updateBookingVoucher(bookingRef: string, voucherId: string, action: "redeem" | "undo") {
    void postAdminAction("/api/admin/bookings/vouchers", { bookingRef, voucherId, action });
  }

  function updateMemberStatus(memberId: string, status: MemberAdminStatus) {
    void postAdminAction("/api/admin/members/status", { memberId, status });
  }

  async function lookupBooking(options: { silent?: boolean } = {}) {
    const token = staffToken.trim();
    const query = bookingLookupQuery.trim();
    if (!token) {
      setMessage("Staff token required.");
      setBookingLookup(null);
      return;
    }
    if (!query) {
      setMessage("Booking reference or email required.");
      setBookingLookup(null);
      return;
    }

    setIsLookupLoading(true);
    if (!options.silent) {
      setMessage(null);
    }

    try {
      const response = await fetch(`/api/admin/bookings/lookup?q=${encodeURIComponent(query)}&limit=6`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      const data = (await response.json()) as BookingLookupResult | { error?: string };
      if (!response.ok) {
        throw new Error("error" in data ? data.error ?? "Booking lookup failed" : "Booking lookup failed");
      }
      setBookingLookup(data as BookingLookupResult);
      if (!options.silent) {
        const count = (data as BookingLookupResult).matches.length;
        setMessage(count ? `Found ${count} booking${count === 1 ? "" : "s"}.` : "No booking found.");
      }
    } catch (error) {
      setBookingLookup(null);
      setMessage(error instanceof Error ? error.message : "Booking lookup failed");
    } finally {
      setIsLookupLoading(false);
    }
  }

  function updateAnnouncementDraft(patch: Partial<AnnouncementConfig>) {
    setAnnouncementDraft((current) => ({ ...current, ...patch }));
  }

  function updateHoursDraft(day: Weekday, patch: Partial<HoursDayConfig>) {
    setHoursDraft((current) => ({
      ...current,
      [day]: {
        ...current[day],
        ...patch
      }
    }));
  }

  async function saveConfig(key: "announcement" | "hours") {
    const token = staffToken.trim();
    if (!token) {
      setMessage("Staff token required.");
      return;
    }

    setActionKey(`config:${key}`);
    setMessage(null);

    try {
      const response = await fetch("/api/admin/config", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          key,
          data: key === "announcement" ? announcementDraft : hoursDraft
        })
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Config update failed");
      }
      await loadOperations();
      setMessage("Config saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Config update failed");
    } finally {
      setActionKey(null);
    }
  }

  async function downloadExport(kind: ExportKind) {
    const token = staffToken.trim();
    if (!token) {
      setMessage("Staff token required.");
      return;
    }

    setExportKind(kind);
    setMessage(null);

    try {
      const response = await fetch(`/api/admin/export?kind=${encodeURIComponent(kind)}&limit=250`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Export failed");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filenameFromContentDisposition(response.headers.get("content-disposition"), kind);
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setMessage(`${exportLabel(kind)} export downloaded.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Export failed");
    } finally {
      setExportKind(null);
    }
  }

  return (
    <section className="adminOpsShell" aria-label="Admin operations">
      <aside className="adminOpsPanel adminOpsAccess">
        <div className="adminOpsPanelHeader">
          <ShieldCheck size={22} />
          <div>
            <p>Access</p>
            <h1>Operations</h1>
          </div>
        </div>
        <label>
          <span>Staff Token</span>
          <input
            autoComplete="off"
            placeholder="Bearer token"
            type="password"
            value={staffToken}
            onChange={(event) => setStaffToken(event.target.value)}
          />
        </label>
        <button className="primaryAction" type="button" disabled={isLoading} onClick={loadOperations}>
          {isLoading ? "Loading" : "Load Snapshot"}
          <ArrowRight size={18} />
        </button>
        {message ? <p className="adminOpsMessage">{message}</p> : null}
        {snapshot ? (
          <div className="adminOpsStaff">
            <span>{snapshot.staff.role}</span>
            <strong>{snapshot.staff.emailLower}</strong>
          </div>
        ) : null}
        {snapshot?.staff.role === "admin" ? (
          <div className="adminOpsExports" aria-label="Admin exports">
            <strong>Exports</strong>
            <div className="adminOpsExportGrid">
              {exportActions.map((item) => (
                <button
                  type="button"
                  key={item.kind}
                  disabled={Boolean(exportKind)}
                  aria-label={`Download ${item.label} CSV`}
                  onClick={() => void downloadExport(item.kind)}
                >
                  {exportKind === item.kind ? "Saving" : item.label}
                  <Download size={15} />
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </aside>

      <div className="adminOpsMain">
        <div className="adminOpsGrid" aria-label="Operations counters">
          <article>
            <span>Draft Orders</span>
            <strong>{countLabel(snapshot?.counts.draftOrders)}</strong>
          </article>
          <article>
            <span>Pending Orders</span>
            <strong>{countLabel(snapshot?.counts.pendingOrders)}</strong>
          </article>
          <article>
            <span>Draft POS</span>
            <strong>{countLabel(snapshot?.counts.draftPosSales)}</strong>
          </article>
          <article>
            <span>Pending POS</span>
            <strong>{countLabel(snapshot?.counts.pendingPosSales)}</strong>
          </article>
          <article>
            <span>Pending Members</span>
            <strong>{countLabel(snapshot?.counts.pendingMembers)}</strong>
          </article>
          <article>
            <span>Approved Members</span>
            <strong>{countLabel(snapshot?.counts.approvedMembers)}</strong>
          </article>
        </div>

        <div className="adminOpsPanel">
          <div className="adminOpsPanelHeader">
            <CalendarDays size={22} />
            <div>
              <p>Readiness</p>
              <h2>{snapshot ? `${readinessScore}/6 configured` : "Waiting"}</h2>
            </div>
          </div>
          <div className="adminOpsReadiness">
            {(Object.entries(readinessLabels) as Array<[keyof Readiness, string]>).map(([key, label]) => (
              <div className={snapshot?.readiness[key] ? "isReady" : ""} key={key}>
                <span>{label}</span>
                <strong>{snapshot ? (snapshot.readiness[key] ? "Ready" : "Missing") : "--"}</strong>
              </div>
            ))}
          </div>
        </div>

        <div className="adminOpsPanel adminOpsLookup">
          <div className="adminOpsPanelHeader">
            <CalendarDays size={22} />
            <div>
              <p>Front Desk</p>
              <h2>Booking Lookup</h2>
            </div>
          </div>
          <form
            className="adminOpsLookupForm"
            onSubmit={(event) => {
              event.preventDefault();
              void lookupBooking();
            }}
          >
            <label>
              <span>Booking Reference Or Email</span>
              <input
                autoComplete="off"
                inputMode="search"
                maxLength={120}
                placeholder="SKY2607-ABC123"
                value={bookingLookupQuery}
                onChange={(event) => setBookingLookupQuery(event.target.value)}
              />
            </label>
            <button className="secondaryAction" type="submit" disabled={isLookupLoading}>
              {isLookupLoading ? "Looking" : "Look Up"}
              <ArrowRight size={18} />
            </button>
          </form>
          <div className="adminOpsLookupResults">
            {bookingLookup?.matches.map((booking) => {
              const guestName = [booking.firstName, booking.lastName].filter(Boolean).join(" ");
              const voucherSummary = booking.vouchers?.summary;
              const canMutateBooking = bookingLookup.staff.role === "admin" || bookingLookup.staff.role === "pos";
              return (
                <div className="adminOpsLookupCard" key={booking.bookingRef}>
                  <div>
                    <strong>{booking.bookingRef}</strong>
                    <span>{[guestName, booking.emailLower, booking.visitDate].filter(Boolean).join(" / ")}</span>
                    <em>{booking.partySize ? `${booking.partySize} guests` : booking.orderRef ?? "No party size"}</em>
                  </div>
                  <span>{booking.status}</span>
                  <span>
                    {booking.checkedInAt
                      ? `Checked in ${shortDate(booking.checkedInAt)}`
                      : booking.cancelledAt
                        ? `Cancelled ${shortDate(booking.cancelledAt)}`
                        : "Ready"}
                  </span>
                  <div className="adminOpsRowActions">
                    {!canMutateBooking ? null : booking.status === "checked-in" ? (
                      <button
                        type="button"
                        disabled={Boolean(actionKey)}
                        onClick={() => updateBookingStatus(booking.bookingRef, "confirmed")}
                      >
                        Undo
                      </button>
                    ) : booking.status === "cancelled" ? null : (
                      <button
                        type="button"
                        disabled={Boolean(actionKey)}
                        onClick={() => updateBookingStatus(booking.bookingRef, "checked-in")}
                      >
                        Check In
                      </button>
                    )}
                  </div>
                  <div className="adminOpsVoucherList">
                    <div className="adminOpsVoucherHeader">
                      <strong>Vouchers</strong>
                      <span>
                        {voucherSummary && voucherSummary.total > 0
                          ? `${voucherSummary.redeemed}/${voucherSummary.total} redeemed`
                          : "No voucher entitlements"}
                      </span>
                    </div>
                    {booking.vouchers?.items.length ? (
                      booking.vouchers.items.map((voucher) => (
                        <div className={voucher.remaining === 0 ? "adminOpsVoucherRow isComplete" : "adminOpsVoucherRow"} key={voucher.id}>
                          <span>{voucher.label}</span>
                          <em>
                            {voucher.redeemed}/{voucher.quantity}
                          </em>
                          <div className="adminOpsRowActions">
                            {canMutateBooking ? (
                              <>
                                <button
                                  type="button"
                                  disabled={Boolean(actionKey) || voucher.redeemed <= 0}
                                  onClick={() => updateBookingVoucher(booking.bookingRef, voucher.id, "undo")}
                                >
                                  Undo
                                </button>
                                <button
                                  type="button"
                                  disabled={Boolean(actionKey) || voucher.remaining <= 0 || booking.status === "cancelled"}
                                  onClick={() => updateBookingVoucher(booking.bookingRef, voucher.id, "redeem")}
                                >
                                  Redeem
                                </button>
                              </>
                            ) : null}
                          </div>
                        </div>
                      ))
                    ) : (
                      <p>No cafe or package vouchers on this booking.</p>
                    )}
                  </div>
                </div>
              );
            })}
            {bookingLookup && bookingLookup.matches.length === 0 ? <p className="adminOpsEmpty">No booking found</p> : null}
            {!bookingLookup ? <p className="adminOpsEmpty">Scan or type a booking reference</p> : null}
          </div>
        </div>

        <div className="adminOpsPanel">
          <div className="adminOpsPanelHeader">
            <ShieldCheck size={22} />
            <div>
              <p>Site Config</p>
              <h2>{configSnapshot ? "Announcement & Hours" : "Locked"}</h2>
            </div>
          </div>

          {configSnapshot ? (
            <div className="adminOpsConfig">
              <div className="adminOpsConfigCard">
                <div className="adminOpsConfigTitle">
                  <strong>Announcement</strong>
                  {configSnapshot.state.announcement.invalid ? <span>Stored data needs review</span> : null}
                </div>
                <label className="adminOpsInlineToggle">
                  <input
                    type="checkbox"
                    checked={announcementDraft.active}
                    onChange={(event) => updateAnnouncementDraft({ active: event.target.checked })}
                  />
                  <span>Active</span>
                </label>
                <label>
                  <span>Text</span>
                  <input
                    maxLength={180}
                    value={announcementDraft.text}
                    onChange={(event) => updateAnnouncementDraft({ text: event.target.value })}
                  />
                </label>
                <label>
                  <span>Type</span>
                  <select
                    value={announcementDraft.type}
                    onChange={(event) => updateAnnouncementDraft({ type: event.target.value as AnnouncementType })}
                  >
                    <option value="info">Info</option>
                    <option value="warning">Warning</option>
                    <option value="success">Success</option>
                  </select>
                </label>
                <button
                  className="secondaryAction"
                  type="button"
                  disabled={Boolean(actionKey) || !configSnapshot.editableKeys.includes("announcement")}
                  onClick={() => void saveConfig("announcement")}
                >
                  Save Announcement
                </button>
              </div>

              <div className="adminOpsConfigCard adminOpsHoursCard">
                <div className="adminOpsConfigTitle">
                  <strong>Hours</strong>
                  {configSnapshot.state.hours.invalid ? <span>Stored data needs review</span> : null}
                </div>
                <div className="adminOpsHoursGrid">
                  {weekdays.map((day) => (
                    <div className="adminOpsHoursRow" key={day}>
                      <strong>{day}</strong>
                      <label>
                        <span>Open</span>
                        <input
                          type="time"
                          value={hoursDraft[day].open}
                          disabled={hoursDraft[day].closed}
                          onChange={(event) => updateHoursDraft(day, { open: event.target.value })}
                        />
                      </label>
                      <label>
                        <span>Close</span>
                        <input
                          type="time"
                          value={hoursDraft[day].close}
                          disabled={hoursDraft[day].closed}
                          onChange={(event) => updateHoursDraft(day, { close: event.target.value })}
                        />
                      </label>
                      <label className="adminOpsInlineToggle">
                        <input
                          type="checkbox"
                          checked={hoursDraft[day].closed}
                          onChange={(event) => updateHoursDraft(day, { closed: event.target.checked })}
                        />
                        <span>Closed</span>
                      </label>
                    </div>
                  ))}
                </div>
                <button
                  className="secondaryAction"
                  type="button"
                  disabled={Boolean(actionKey) || !configSnapshot.editableKeys.includes("hours")}
                  onClick={() => void saveConfig("hours")}
                >
                  Save Hours
                </button>
              </div>

              <div className="adminOpsCatalogWrap">
                <div className="adminOpsConfigTitle">
                  <strong>Catalog</strong>
                  <span>
                    {catalogState.authority} / {catalogState.editableInAdmin ? "editable" : "read-only"} / {catalogState.version}
                  </span>
                </div>
                <div className="adminOpsConfigTitle">
                  <strong>Convex</strong>
                  <span>
                    {convexCatalogSnapshot?.activeVersion
                      ? `${convexCatalogSnapshot.activeVersion.version} / ${convexCatalogSnapshot.activeVersion.itemCount} items`
                      : "not seeded"}
                  </span>
                </div>
                <div className="adminOpsCatalog" aria-label="Canonical catalog">
                  {catalog.map((item) => (
                    <div className={item.active ? "" : "isInactive"} key={`${item.kind}:${item.key}`}>
                      <span>{item.kind}</span>
                      <strong>{item.name}</strong>
                      <em>{money(item.priceCents)}</em>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <p className="adminOpsEmpty">Config locked</p>
          )}
        </div>

        <div className="adminOpsPanel">
          <div className="adminOpsTabs" role="tablist" aria-label="Recent operations">
            <button
              className={activeTab === "orders" ? "isActive" : ""}
              type="button"
              role="tab"
              aria-selected={activeTab === "orders"}
              onClick={() => setActiveTab("orders")}
            >
              Orders
            </button>
            <button
              className={activeTab === "pos" ? "isActive" : ""}
              type="button"
              role="tab"
              aria-selected={activeTab === "pos"}
              onClick={() => setActiveTab("pos")}
            >
              POS
            </button>
            <button
              className={activeTab === "bookings" ? "isActive" : ""}
              type="button"
              role="tab"
              aria-selected={activeTab === "bookings"}
              onClick={() => setActiveTab("bookings")}
            >
              Bookings
            </button>
            <button
              className={activeTab === "members" ? "isActive" : ""}
              type="button"
              role="tab"
              aria-selected={activeTab === "members"}
              onClick={() => setActiveTab("members")}
            >
              Members
            </button>
            <button
              className={activeTab === "payments" ? "isActive" : ""}
              type="button"
              role="tab"
              aria-selected={activeTab === "payments"}
              onClick={() => setActiveTab("payments")}
            >
              Payments
            </button>
          </div>

          <div className="adminOpsTable" role="tabpanel">
            {activeTab === "orders"
              ? snapshot?.recent.orders.map((order) => (
                  <div className="adminOpsRow" key={order.orderRef}>
                    <div>
                      <strong>{order.orderRef}</strong>
                      <span>{[order.visitDate, order.entryTime, order.customerEmailLower].filter(Boolean).join(" / ")}</span>
                    </div>
                    <span>{order.status}</span>
                    <span>{money(order.totalCents)}</span>
                    <time>{shortDate(order.createdAt)}</time>
                  </div>
                ))
              : null}

            {activeTab === "pos"
              ? snapshot?.recent.posSales.map((sale) => (
                  <div className="adminOpsRow" key={sale.saleRef}>
                    <div>
                      <strong>{sale.saleRef}</strong>
                      <span>{[sale.customerEmailLower, maskedIdentifier(sale.readerId)].filter(Boolean).join(" / ")}</span>
                    </div>
                    <span>{sale.status}</span>
                    <span>{money(sale.totalCents)}</span>
                    <time>{shortDate(sale.createdAt)}</time>
                  </div>
                ))
              : null}

            {activeTab === "bookings"
              ? snapshot?.recent.bookings.map((booking) => {
                  const voucherSummary = booking.vouchers?.summary;
                  const canMutateBooking = snapshot.staff.role === "admin" || snapshot.staff.role === "pos";
                  const voucherLabel =
                    voucherSummary && voucherSummary.total > 0
                      ? `${voucherSummary.redeemed}/${voucherSummary.total} vouchers`
                      : booking.checkedInAt
                        ? `In ${shortDate(booking.checkedInAt)}`
                        : booking.cancelledAt
                          ? `Cancelled ${shortDate(booking.cancelledAt)}`
                          : "Open";
                  return (
                    <div className="adminOpsRow adminOpsRowWithActions" key={booking.bookingRef}>
                      <div>
                        <strong>{booking.bookingRef}</strong>
                        <span>{[booking.visitDate, booking.emailLower].filter(Boolean).join(" / ")}</span>
                      </div>
                      <span>{booking.status}</span>
                      <span>{voucherLabel}</span>
                      <div className="adminOpsRowActions">
                        {!canMutateBooking ? null : booking.status === "checked-in" ? (
                          <button
                            type="button"
                            disabled={Boolean(actionKey)}
                            onClick={() => updateBookingStatus(booking.bookingRef, "confirmed")}
                          >
                            Undo
                          </button>
                        ) : booking.status === "cancelled" ? null : (
                          <button
                            type="button"
                            disabled={Boolean(actionKey)}
                            onClick={() => updateBookingStatus(booking.bookingRef, "checked-in")}
                          >
                            Check In
                          </button>
                        )}
                        {booking.status !== "cancelled" && snapshot?.staff.role === "admin" ? (
                          <button
                            className="isDanger"
                            type="button"
                            disabled={Boolean(actionKey)}
                            onClick={() => updateBookingStatus(booking.bookingRef, "cancelled")}
                          >
                            Cancel
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })
              : null}

            {activeTab === "members"
              ? snapshot?.recent.members.map((member) => (
                  <div className="adminOpsRow adminOpsRowWithActions" key={member.memberId}>
                    <div>
                      <strong>{[member.firstName, member.lastName].filter(Boolean).join(" ") || member.emailLower || member.memberId}</strong>
                      <span>{[member.email ?? member.emailLower, member.tier, member.source, member.legacyId].filter(Boolean).join(" / ")}</span>
                    </div>
                    <span>{member.status}</span>
                    <span>{shortDate(member.updatedAt ?? member.createdAt)}</span>
                    <div className="adminOpsRowActions">
                      {snapshot?.staff.role === "admin" && member.status !== "approved" ? (
                        <button type="button" disabled={Boolean(actionKey)} onClick={() => updateMemberStatus(member.memberId, "approved")}>
                          Approve
                        </button>
                      ) : null}
                      {snapshot?.staff.role === "admin" && member.status !== "waitlisted" ? (
                        <button type="button" disabled={Boolean(actionKey)} onClick={() => updateMemberStatus(member.memberId, "waitlisted")}>
                          Waitlist
                        </button>
                      ) : null}
                      {snapshot?.staff.role === "admin" && member.status !== "rejected" ? (
                        <button
                          className="isDanger"
                          type="button"
                          disabled={Boolean(actionKey)}
                          onClick={() => updateMemberStatus(member.memberId, "rejected")}
                        >
                          Reject
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))
              : null}

            {activeTab === "payments"
              ? snapshot?.recent.paymentEvents.map((event) => (
                  <div className="adminOpsRow" key={`${event.provider}:${event.providerPaymentId}:${event.createdAt}`}>
                    <div>
                      <strong>{maskedIdentifier(event.providerPaymentId) ?? event.provider}</strong>
                      <span>{[event.orderRef, event.saleRef, maskedIdentifier(event.rawEventId)].filter(Boolean).join(" / ")}</span>
                    </div>
                    <span>{event.provider}</span>
                    <span>{event.status}</span>
                    <time>{shortDate(event.createdAt)}</time>
                  </div>
                ))
              : null}

            {snapshot &&
            snapshot.recent[
              activeTab === "orders"
                ? "orders"
                : activeTab === "pos"
                  ? "posSales"
                  : activeTab === "bookings"
                    ? "bookings"
                    : activeTab === "members"
                      ? "members"
                      : "paymentEvents"
            ].length === 0 ? (
              <p className="adminOpsEmpty">No recent records</p>
            ) : null}

            {!snapshot ? <p className="adminOpsEmpty">Snapshot locked</p> : null}
          </div>
        </div>
      </div>
    </section>
  );
}
