"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { AdmissionActions, type AdmissionBooking } from "./admission-actions";
import { useStaffSession } from "./staff-auth-provider";

type Booking = AdmissionBooking & { visitDate?: string; entryTime?: string };
type Occupancy = { staff: { role: "admin" | "pos" | "viewer" }; insideCount: number; capacity: number; verified: boolean; reason?: string; parties: Array<{ bookingRef: string; partySize: number; departedCount: number }> };

export function AdmissionClient() {
  const session = useStaffSession();
  const [query, setQuery] = useState("");
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [role, setRole] = useState<Occupancy["staff"]["role"]>();
  const [occupancy, setOccupancy] = useState<Occupancy>();
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const signedIn = session.status === "signed-in";
  const canMutate = signedIn && (role === "admin" || role === "pos");

  async function readOccupancy() {
    try {
      const response = await session.staffFetch("/api/admin/admission/occupancy");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Occupancy could not be verified");
      setOccupancy(data as Occupancy);
      setRole((data as Occupancy).staff.role);
    } catch (error) {
      setOccupancy(undefined);
      throw error;
    }
  }
  async function lookup() {
    const response = await session.staffFetch(`/api/admin/bookings/lookup?q=${encodeURIComponent(query.trim())}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Ticket could not be verified");
    setBookings(data.matches as Booking[]);
    setRole(data.staff.role);
    return data.matches as Booking[];
  }
  async function run(task: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setMessage(undefined);
    try { await task(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Admission could not be verified. Try again."); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function change(booking: Booking, departedCount?: number) {
    const endpoint = departedCount === undefined ? "/api/admin/bookings/status" : "/api/admin/admission/departure";
    setBookings([]); setOccupancy(undefined);
    let response: Response;
    let data: { error?: string; outcome?: string; booking?: { admissionOutcome?: string } };
    try {
      response = await session.staffFetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(departedCount === undefined ? { bookingRef: booking.bookingRef, status: "checked-in" } : { bookingRef: booking.bookingRef, departedCount })
      });
      data = await response.json();
    } catch {
      throw new Error("The result could not be verified. Refresh occupancy and find this ticket before acting again.");
    }
    if (!response.ok) throw new Error(data.error ?? "Admission action could not be verified");
    const outcome = departedCount === undefined ? data.booking?.admissionOutcome : data.outcome;
    const expected = departedCount === undefined ? ["admitted", "already_admitted"] : ["recorded", "already_recorded"];
    if (!outcome || !expected.includes(outcome)) throw new Error("The result could not be verified. Refresh occupancy and find this ticket before acting again.");
    // Clear stale controls before refresh. An unsuccessful refresh never
    // presents an old confirmed ticket as another admission opportunity.
    setBookings([]); setOccupancy(undefined);
    // Wait for both reads before releasing the busy guard. A late response
    // cannot repopulate controls while a newer action is starting.
    const refreshed = await Promise.allSettled([readOccupancy(), query.trim() ? lookup() : Promise.resolve([])]);
    const failure = refreshed.find(result => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
    setMessage(departedCount !== undefined ? outcome === "already_recorded" ? "Departure already recorded. No re-entry." : "Departure recorded. No re-entry." : outcome === "already_admitted" ? "Ticket already used. Do not admit again." : "Party admitted. Record departures when people leave.");
  }

  return <section className="admissionDesk" aria-labelledby="admission-title">
    <h1 id="admission-title">Admission</h1>
    <p>One admission per party on the selected Los Angeles date, from entry time until closing. No re-entry. All ages count toward 30 inside.</p>
    {signedIn || session.status === "signing-out" ? <div className="adminOpsStaff">
      <span>{role ? `${role} staff` : "Identity verified"}</span>
      <strong>{session.email ?? "Staff account"}</strong>
      <button type="button" className="secondaryAction" disabled={busy || session.status === "signing-out"} onClick={() => void run(session.signOut)}>{session.status === "signing-out" ? "Signing out" : "Sign out"}</button>
    </div> : null}
    {!signedIn ? <p>{session.status === "unconfigured" ? "Staff sign-in needs to be linked before admission can be used." : session.status === "loading" ? "Checking staff sign-in…" : <Link href="/staff-sign-in?returnTo=/admission">Staff sign in</Link>}</p> : null}
    <button type="button" className="secondaryAction" disabled={!signedIn || busy} onClick={() => void run(readOccupancy)}>Refresh occupancy</button>
    <p role="status">{occupancy ? occupancy.verified ? `${occupancy.insideCount} of ${occupancy.capacity} inside` : "Occupancy needs reconciliation. Admission stays blocked." : "Occupancy has not been verified."}</p>
    <form onSubmit={event => { event.preventDefault(); setBookings([]); void run(async () => { const matches = await lookup(); await readOccupancy(); if (!matches.length) setMessage("No matching ticket. Check the booking reference."); }); }}>
      <label htmlFor="admission-lookup">Ticket QR link, booking reference or email</label>
      <input id="admission-lookup" value={query} onChange={event => { setQuery(event.target.value); setBookings([]); }} autoComplete="off" maxLength={200} disabled={!signedIn || busy} />
      <button type="submit" className="primaryAction" disabled={!signedIn || busy || !query.trim()}>Find ticket</button>
    </form>
    {message ? <p role="status">{message}</p> : null}
    {bookings.map(booking => {
      const remaining = occupancy?.verified ? Math.max(0, occupancy.capacity - occupancy.insideCount) : 0;
      const partyKnown = Number.isSafeInteger(booking.partySize) && booking.partySize! > 0;
      const canAdmit = canMutate && occupancy?.verified === true && partyKnown && booking.partySize! <= remaining;
      const unused = booking.status === "confirmed" && booking.checkedInAt === undefined && booking.admittedPartySize === undefined;
      return <article className="admissionBooking" key={booking.bookingRef}>
      <strong>{booking.bookingRef}</strong>
      <p>{booking.partySize ?? "Unknown"} visitors · {booking.visitDate ?? "Unknown date"} · {booking.entryTime ?? "Unknown time"} PT · {booking.status}</p>
      {canMutate && unused && !canAdmit ? <p>{!occupancy ? "Verify occupancy before admission." : !occupancy.verified ? "Admission is blocked until occupancy is reconciled." : !partyKnown ? "The party count needs reconciliation before admission." : `Only ${remaining} places are available inside for this party of ${booking.partySize}.`}</p> : null}
      <AdmissionActions booking={booking} canMutate={canMutate} canAdmit={canAdmit} busy={busy} onAdmit={() => void run(() => change(booking))} onDepart={count => void run(() => change(booking, count))} />
    </article>;
    })}
    {occupancy?.parties.length ? <div aria-label="Parties still inside">
      {occupancy.parties.map(party => <article className="admissionBooking" key={party.bookingRef}>
        <strong>{party.bookingRef}</strong>
        <AdmissionActions booking={{ bookingRef: party.bookingRef, status: "checked-in", admittedPartySize: party.partySize, departedPartySize: party.departedCount }} canMutate={canMutate} canAdmit={false} busy={busy} onAdmit={() => {}} onDepart={count => void run(() => change({ bookingRef: party.bookingRef, status: "checked-in" }, count))} />
      </article>)}
    </div> : null}
  </section>;
}
