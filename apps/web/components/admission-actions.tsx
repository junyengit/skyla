"use client";

export type AdmissionBooking = {
  bookingRef: string;
  status: string;
  partySize?: number;
  checkedInAt?: number;
  admittedPartySize?: number;
  departedPartySize?: number;
  departedAt?: number;
};

export function AdmissionActions({ booking, canMutate, canAdmit = canMutate, busy, onAdmit, onDepart }: {
  booking: AdmissionBooking;
  canMutate: boolean;
  canAdmit?: boolean;
  busy: boolean;
  onAdmit: () => void;
  onDepart: (departedCount: number) => void;
}) {
  const used = booking.checkedInAt !== undefined || booking.status === "checked-in" || booking.admittedPartySize !== undefined;
  const admitted = booking.admittedPartySize;
  const departed = booking.departedPartySize ?? 0;
  const known = used && Number.isSafeInteger(admitted) && admitted! > 0 && Number.isSafeInteger(departed) && departed >= 0 && departed <= admitted!;
  const inside = known ? admitted! - departed : 0;
  return (
    <div className="adminOpsRowActions admissionActions">
      {used ? <span>{known ? `${inside} of ${admitted} still inside. No re-entry.` : "Used ticket. Occupancy needs reconciliation."}</span> : null}
      {canMutate && known && inside > 0 ? <>
        <button type="button" disabled={busy} onClick={() => onDepart(departed + 1)}>1 person left</button>
        <button type="button" disabled={busy} onClick={() => onDepart(admitted!)}>Everyone left</button>
      </> : null}
      {canMutate && !used && booking.status === "confirmed" ?
        <button type="button" disabled={busy || !canAdmit} onClick={onAdmit}>Admit party</button> : null}
    </div>
  );
}
