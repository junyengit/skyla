import { describe, expect, it } from "vitest";

import {
  CalendarResponseError, calendarMutationFingerprint, normalizeCalendarCreateRequest, normalizeCalendarRange,
  parseCalendarAtomicRejection, parseCalendarEvent, parseCalendarMutationRejection, parseCalendarMutationResult, parseCalendarOperationResult, parseCalendarRangePage
} from "./lib/calendar-contract";

const request = { visitDate: "2026-10-10", label: "Buyout", confirmationSource: "booking-record" as const, sourceRef: "Reservation 123", idempotencyKey: "calendar_contract_01" };
const event = { eventRef: "PEV20261010-ABC123", visitDate: request.visitDate, label: request.label, status: "confirmed" as const, createdAt: 10, confirmationSource: request.confirmationSource, sourceRef: request.sourceRef };
const range = { from: "2026-10-01", to: "2026-10-30" };
const page = { role: "admin", range, cutoff: 100, events: [event], continueCursor: null, isDone: true, pageStatus: null, splitCursor: null, endCursor: null, segmentDone: true };

describe("calendar contract trust boundaries", () => {
  it("normalizes one unchanged request identity independently of midnight", () => {
    expect(normalizeCalendarCreateRequest({ ...request, visitDate: "2020-02-29", label: " Buyout ", notes: " ", sourceRef: " Reservation 123 " }))
      .toEqual({ ...request, visitDate: "2020-02-29" });
    const legacy = { visitDate: "2020-02-29", label: "Legacy", idempotencyKey: request.idempotencyKey };
    expect(normalizeCalendarCreateRequest(legacy)).toEqual(legacy);
    expect(() => normalizeCalendarCreateRequest({ ...legacy, confirmationSource: "owner-confirmation" })).toThrow("supplied together");
  });

  it("accepts exactly 366 real inclusive dates across leap day and DST", () => {
    expect(normalizeCalendarRange({ from: "2024-01-01", to: "2024-12-31" })).toEqual({ from: "2024-01-01", to: "2024-12-31" });
    expect(() => normalizeCalendarRange({ from: "2024-01-01", to: "2025-01-01" })).toThrow("366 dates");
    expect(normalizeCalendarRange({ from: "2026-11-01", to: "2026-11-01" })).toEqual({ from: "2026-11-01", to: "2026-11-01" });
  });

  it("preserves a legacy unknown source without inventing one", () => {
    const { confirmationSource: _source, sourceRef: _ref, ...legacy } = event;
    expect(parseCalendarEvent(legacy)).toEqual(legacy);
    expect(() => parseCalendarEvent({ ...legacy, sourceRef: "Unpaired" })).toThrow(CalendarResponseError);
    expect(() => parseCalendarEvent({ ...legacy, requestFingerprint: "private" })).toThrow(CalendarResponseError);
  });

  it.each([
    { ...event, status: "pending" }, { ...event, eventRef: "PEV20261011-ABC123" },
    { ...event, createdAt: Number.NaN }, { ...event, status: "cancelled", cancelledAt: 9, cancelReason: "Reason" },
    { ...event, status: "cancelled", cancelledAt: 11 }, { ...event, cancelReason: "Stale" }
  ])("fails closed for malformed record %j", value => {
    expect(() => parseCalendarEvent(value)).toThrow(CalendarResponseError);
  });

  it("binds continuation to the existing range cutoff and exact segment", () => {
    expect(parseCalendarRangePage(page, { ...range, cutoff: 100 })).toEqual(page);
    expect(() => parseCalendarRangePage(page, { ...range, cutoff: 101 })).toThrow(CalendarResponseError);
    expect(() => parseCalendarRangePage(page, { ...range, endCursor: "segment-end" })).toThrow(CalendarResponseError);
    const emptyAdvance = { ...page, events: [], continueCursor: "next", isDone: false, segmentDone: false };
    expect(parseCalendarRangePage(emptyAdvance, { ...range, cursor: "previous", cutoff: 100 })).toEqual(emptyAdvance);
    const completedSegment = { ...page, events: [], endCursor: "same", isDone: false };
    expect(parseCalendarRangePage(completedSegment, { ...range, cursor: "same", endCursor: "same", cutoff: 100 })).toEqual(completedSegment);
  });

  it.each(["SplitRecommended", "SplitRequired"])("keeps %s incomplete even when it contains fewer than 25 records", pageStatus => {
    const split = { ...page, pageStatus, continueCursor: "end", splitCursor: "middle", isDone: false, segmentDone: false };
    expect(parseCalendarRangePage(split, range).isDone).toBe(false);
    expect(() => parseCalendarRangePage({ ...split, isDone: true }, range)).toThrow(CalendarResponseError);
    expect(() => parseCalendarRangePage({ ...split, splitCursor: null }, range)).toThrow(CalendarResponseError);
  });

  it.each([
    { ...page, events: [event, event] },
    { ...page, events: [{ ...event, createdAt: 101 }] },
    { ...page, events: [event, { ...event, eventRef: "PEV20261009-XYZ789", visitDate: "2026-10-09" }] },
    { ...page, events: [{ ...event, eventRef: "PEV20261101-XYZ789", visitDate: "2026-11-01" }] },
    { ...page, isDone: false, segmentDone: false, continueCursor: null }
  ])("does not trust malformed coverage %j", value => {
    expect(() => parseCalendarRangePage(value, range)).toThrow(CalendarResponseError);
  });

  it("binds recovery to the exact key or event and keeps null unresolved", () => {
    const value = { role: "viewer", lookup: { key: request.idempotencyKey }, event: null };
    expect(parseCalendarOperationResult(value, { key: request.idempotencyKey })).toEqual(value);
    expect(() => parseCalendarOperationResult(value, { key: "different_contract_key" })).toThrow(CalendarResponseError);
    expect(() => parseCalendarOperationResult({ ...value, lookup: { eventRef: event.eventRef }, event }, { eventRef: "PEV20261010-XYZ789" })).toThrow(CalendarResponseError);
  });

  it("accepts a cancelled create replay and preserves the original cancellation reason", () => {
    const cancelled = { ...event, status: "cancelled", cancelledAt: 11, cancelReason: "First reason" };
    const result = { role: "admin", event: cancelled, reused: true };
    expect(parseCalendarMutationResult(result, { kind: "create", request })).toEqual(result);
    expect(parseCalendarMutationResult(result, { kind: "cancel", request: { eventRef: event.eventRef, reason: "New reason" } })).toEqual(result);
    expect(() => parseCalendarMutationResult({ ...result, reused: false }, { kind: "cancel", request: { eventRef: event.eventRef, reason: "New reason" } })).toThrow(CalendarResponseError);
  });
});

describe("identity-bound atomic rejection receipt", () => {
  const identity = { kind: "create" as const, request };
  const rejection = { kind: "private_event_rejected", version: 1, operation: "create", lookup: { key: request.idempotencyKey },
    requestFingerprint: calendarMutationFingerprint(identity), message: "Private event conflicts with a confirmed block" };
  const response = { error: rejection.message, code: "calendar_mutation_rejected", rejection };

  it("accepts the exact canonical request attestation without persisting plaintext", () => {
    expect(parseCalendarMutationRejection(response, identity)).toEqual(rejection);
    expect(calendarMutationFingerprint(identity)).toBe('v2:["2026-10-10","Buyout",null,"booking-record","Reservation 123"]');
    const legacy = { kind: "create" as const, request: { visitDate: request.visitDate, label: request.label, idempotencyKey: request.idempotencyKey } };
    expect(calendarMutationFingerprint(legacy)).toBe('v1:["2026-10-10","Buyout",null]');
    expect(calendarMutationFingerprint({ kind: "cancel", request: { eventRef: event.eventRef, reason: " Original reason " } }))
      .toBe('cancel-v1:["PEV20261010-ABC123","Original reason"]');
  });

  it.each([
    { ...request, label: "Different" }, { ...request, notes: "Different" },
    { ...request, sourceRef: "Different" }, { ...request, idempotencyKey: "different_contract_key" }
  ])("does not prove rejection of changed request %j", changed => {
    expect(() => parseCalendarMutationRejection(response, { kind: "create", request: changed })).toThrow(CalendarResponseError);
  });

  it.each([
    { ...response, code: "calendar_request_rejected" }, { ...response, error: "Different" },
    { ...response, debug: "extra" }, { error: response.error, code: response.code },
    { ...response, rejection: { ...rejection, operation: "cancel" } },
    { ...response, rejection: { ...rejection, lookup: { key: request.idempotencyKey, eventRef: event.eventRef } } },
    { ...response, rejection: { ...rejection, message: "x".repeat(501) } }
  ])("does not use status or a discriminator alone as proof %j", value => {
    expect(() => parseCalendarMutationRejection(value, identity)).toThrow(CalendarResponseError);
  });

  it("requires a canonical bounded receipt and exact cancellation reason", () => {
    expect(() => parseCalendarAtomicRejection({ ...rejection, requestFingerprint: "x".repeat(8193) }, identity)).toThrow(CalendarResponseError);
    const cancel = { kind: "cancel" as const, request: { eventRef: event.eventRef, reason: "First reason" } };
    const receipt = { ...rejection, operation: "cancel", lookup: { eventRef: event.eventRef }, requestFingerprint: calendarMutationFingerprint(cancel) };
    expect(parseCalendarAtomicRejection(receipt, cancel)).toEqual(receipt);
    expect(() => parseCalendarAtomicRejection(receipt, { kind: "cancel", request: { ...cancel.request, reason: "Different reason" } })).toThrow(CalendarResponseError);
  });
});
