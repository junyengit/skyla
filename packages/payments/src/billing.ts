/** Read-only Billing transport vocabulary. No settlement, admission or retry policy. */

type BillingReadonly<T> = T extends readonly (infer Item)[]
  ? readonly BillingReadonly<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: BillingReadonly<T[Key]> }
    : T;

export const billingRoles = Object.freeze([
  "admin",
  "viewer",
] as const);

export type BillingRole = (typeof billingRoles)[number];

export const billingExceptionStatuses = Object.freeze([
  "open",
  "resolved",
] as const);

export type BillingExceptionStatus = (typeof billingExceptionStatuses)[number];

export const billingCategories = Object.freeze([
  "billing",
  "checkout_attempt",
  "terminal_attempt",
  "ticket_delivery",
] as const);

export type BillingCategory = (typeof billingCategories)[number];

export const billingOwnerStates = Object.freeze([
  "draft",
  "payment_pending",
  "paid",
  "canceled",
  "expired",
] as const);

export type BillingOwnerState = (typeof billingOwnerStates)[number];

export const billingPaymentProviders = Object.freeze([
  "stripe",
  "terminal",
  "kaskade",
] as const);

export type BillingPaymentProvider = (typeof billingPaymentProviders)[number];

export const billingPaymentStates = Object.freeze([
  "created",
  "requires_payment",
  "processing",
  "paid",
  "failed",
  "refunded",
  "canceled",
] as const);

export type BillingPaymentState = (typeof billingPaymentStates)[number];

export const billingRefundStates = Object.freeze([
  "pending",
  "requires_action",
  "succeeded",
  "failed",
  "canceled",
] as const);

export type BillingRefundState = (typeof billingRefundStates)[number];

export const billingCheckoutAttemptStates = Object.freeze([
  "creating",
  "creation_unknown",
  "open",
  "paid",
  "expired",
  "rejected",
  "exception",
] as const);

export type BillingCheckoutAttemptState = (typeof billingCheckoutAttemptStates)[number];

export const billingTerminalAttemptStates = Object.freeze([
  "creating",
  "creation_unknown",
  "open",
  "paid",
  "canceled",
  "rejected",
  "exception",
] as const);

export type BillingTerminalAttemptState = (typeof billingTerminalAttemptStates)[number];

export const billingDeliveryStates = Object.freeze([
  "queued",
  "sending",
  "sent",
  "failed",
  "suppressed",
] as const);

export type BillingDeliveryState = (typeof billingDeliveryStates)[number];

export const billingBookingStates = Object.freeze([
  "confirmed",
  "checked-in",
  "cancelled",
] as const);

export type BillingBookingState = (typeof billingBookingStates)[number];

export const billingEmailProviderStates = Object.freeze([
  "accepted",
  "bounced",
  "canceled",
  "clicked",
  "complained",
  "delivered",
  "delivery_delayed",
  "failed",
  "opened",
  "queued",
  "scheduled",
  "sent",
  "suppressed",
] as const);

export type BillingEmailProviderState = (typeof billingEmailProviderStates)[number];

export const billingCheckoutProviderStates = Object.freeze([
  "open",
  "complete_unpaid",
  "expired",
  "paid",
  "unknown",
  "config_missing",
  "async_payment_failed",
] as const);

export type BillingCheckoutProviderState = (typeof billingCheckoutProviderStates)[number];

export const billingTerminalProviderStates = Object.freeze([
  "requires_payment_method",
  "requires_confirmation",
  "requires_action",
  "processing",
  "succeeded",
  "canceled",
  "payment_failed",
  "unknown",
  "config_missing",
] as const);

export type BillingTerminalProviderState = (typeof billingTerminalProviderStates)[number];

export const billingModes = Object.freeze([
  "test",
  "live",
] as const);

export type BillingMode = (typeof billingModes)[number];

export const billingApiVersions = Object.freeze([
  "2026-02-25.clover",
] as const);

export type BillingApiVersion = (typeof billingApiVersions)[number];

export const billingEvidenceSources = Object.freeze([
  "webhook",
  "reconciliation",
] as const);

export type BillingEvidenceSource = (typeof billingEvidenceSources)[number];

export const billingResolutionCodes = Object.freeze([
  "configuration_restored",
  "sent_after_configuration",
  "provider_delivery_confirmed",
] as const);

export type BillingResolutionCode = (typeof billingResolutionCodes)[number];

export const billingCoverages = Object.freeze([
  "complete",
  "capped",
  "unverified",
  "not_applicable",
] as const);

export type BillingCoverage = (typeof billingCoverages)[number];

export const billingProofs = Object.freeze([
  "proven",
  "none_recorded",
  "unverified",
  "conflict",
] as const);

export type BillingProof = (typeof billingProofs)[number];

export const billingRelations = Object.freeze([
  "correlated",
  "missing",
  "ambiguous",
  "unverified",
] as const);

export type BillingRelation = (typeof billingRelations)[number];

export const billingSchedules = Object.freeze([
  "scheduled",
  "active_lease",
  "none_recorded",
  "stopped",
  "unverified",
] as const);

export type BillingSchedule = (typeof billingSchedules)[number];

export const billingPageStatuses = Object.freeze([
  "SplitRecommended",
  "SplitRequired",
] as const);

export type BillingPageStatus = (typeof billingPageStatuses)[number] | null;

export const billingPaneOrders = Object.freeze([
  "native_creation_desc",
  "recorded_updatedAt_desc",
] as const);

export type BillingPaneOrder = (typeof billingPaneOrders)[number];

export const billingLineKinds = Object.freeze([
  "ticket",
  "addon",
  "cafe",
  "custom",
] as const);

export type BillingLineKind = (typeof billingLineKinds)[number];

export const billingAdmissionCategories = Object.freeze([
  "adult",
  "youth",
  "child",
] as const);

export type BillingAdmissionCategory = (typeof billingAdmissionCategories)[number];

export const billingAttendanceProofs = Object.freeze([
  "proven",
  "unverified",
  "not_applicable",
] as const);

export type BillingAttendanceProof = (typeof billingAttendanceProofs)[number];

export const billingBookingProofs = Object.freeze([
  "proven",
  "blocked",
  "unverified",
] as const);

export type BillingBookingProof = (typeof billingBookingProofs)[number];

export const billingIssuances = Object.freeze([
  "issued",
  "not_found",
  "unverified",
  "not_applicable",
] as const);

export type BillingIssuance = (typeof billingIssuances)[number];

export const billingRecordedEvidence = Object.freeze([
  "recorded",
  "none_recorded",
  "unverified",
] as const);

export type BillingRecordedEvidence = (typeof billingRecordedEvidence)[number];

export const billingRefundDispositions = Object.freeze([
  "none_succeeded_recorded",
  "partial",
  "full",
  "unknown",
] as const);

export type BillingRefundDisposition = (typeof billingRefundDispositions)[number];

export const billingRecoveryKinds = Object.freeze([
  "checkout",
  "terminal",
  "email_send",
  "email_tracking",
] as const);

export type BillingRecoveryKind = (typeof billingRecoveryKinds)[number];

export const billingAuditScopes = Object.freeze([
  "owner",
  "exception_series",
] as const);

export type BillingAuditScope = (typeof billingAuditScopes)[number];

export const billingOwnerKinds = Object.freeze([
  "order",
  "sale",
] as const);

export type BillingOwnerKind = (typeof billingOwnerKinds)[number];

export const billingChannels = Object.freeze([
  "online",
  "pos",
] as const);

export type BillingChannel = (typeof billingChannels)[number];

export const billingReadFailureCodes = Object.freeze([
  "billing_access_denied",
  "billing_record_not_found",
  "billing_cursor_invalid",
  "billing_read_unverified",
] as const);

export type BillingReadFailureCode = (typeof billingReadFailureCodes)[number];

export const billingHttpErrorCodes = Object.freeze([
  "billing_request_rejected",
  "billing_auth_required",
  "billing_access_denied",
  "billing_record_not_found",
  "billing_cursor_invalid",
  "billing_read_unverified",
] as const);

export type BillingHttpErrorCode = (typeof billingHttpErrorCodes)[number];

export const billingProviderStates = Object.freeze([
  "open",
  "complete_unpaid",
  "expired",
  "paid",
  "unknown",
  "config_missing",
  "async_payment_failed",
  "requires_payment_method",
  "requires_confirmation",
  "requires_action",
  "processing",
  "succeeded",
  "canceled",
  "payment_failed",
  "accepted",
  "bounced",
  "clicked",
  "complained",
  "delivered",
  "delivery_delayed",
  "failed",
  "opened",
  "queued",
  "scheduled",
  "sent",
  "suppressed",
] as const);

export type BillingProviderState = (typeof billingProviderStates)[number];

export const billingEventTypes = Object.freeze([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "payment_intent.canceled",
  "refund.created",
  "refund.updated",
  "refund.failed",
] as const);

export type BillingEventType = (typeof billingEventTypes)[number];

export const billingExceptionCodes = Object.freeze([
  "order_duplicate",
  "order_not_found",
  "payment_session_not_created_by_convex",
  "pos_sale_duplicate",
  "pos_sale_not_found",
  "terminal_intent_not_created_by_convex",
  "session_order_mismatch",
  "attempt_session_mismatch",
  "session_creation_unverified",
  "intent_sale_mismatch",
  "attempt_intent_mismatch",
  "attempt_nonce_missing",
  "attempt_nonce_mismatch",
  "paid_session_mode_invalid",
  "paid_session_livemode_mismatch",
  "paid_session_facts_invalid",
  "amount_or_currency_mismatch",
  "order_expected_provider_mismatch",
  "missing_checkout_payment_intent",
  "paid_intent_source_invalid",
  "paid_intent_livemode_mismatch",
  "paid_intent_facts_invalid",
  "paid_intent_amount_received_mismatch",
  "paid_payment_identity_reused",
  "paid_payment_identity_unverified",
  "paid_payment_ledger_duplicate",
  "paid_payment_identity_conflict",
  "paid_payment_record_mismatch",
  "duplicate_payment_for_order",
  "duplicate_payment_for_sale",
  "paid_booking_duplicate",
  "paid_owner_payment_ambiguous",
  "paid_booking_proof_invalid",
  "paid_ticket_delivery_invalid",
  "paid_order_without_booking",
  "paid_order_snapshot_invalid",
  "paid_owner_history_unverified",
  "paid_sale_snapshot_invalid",
  "paid_sale_without_booking",
  "paid_sale_state_unexpected",
  "paid_after_sale_closed",
  "paid_capacity_reservation_inconsistent",
  "paid_venue_hours_unverified",
  "paid_after_visit_window",
  "paid_fulfillment_after_visit_window",
  "paid_booking_mismatch",
  "paid_capacity_reservation_mismatch",
  "paid_order_capacity_exception",
  "paid_pos_visit_unknown",
  "paid_sale_capacity_exception",
  "checkout_session_creation_outcome_unknown",
  "checkout_attempt_two_sessions",
  "checkout_session_creation_rejected",
  "checkout_session_creation_conflict",
  "checkout_session_creation_mismatch",
  "legacy_payment_pending_without_session",
  "checkout_reconciliation_expiry_rejected",
  "checkout_session_provider_mismatch",
  "checkout_reconciliation_unconfigured",
  "checkout_reconciliation_exhausted_config_missing",
  "checkout_reconciliation_exhausted_open",
  "checkout_reconciliation_exhausted_complete_unpaid",
  "checkout_reconciliation_exhausted_unknown",
  "terminal_intent_creation_outcome_unknown",
  "terminal_attempt_two_intents",
  "terminal_intent_creation_rejected",
  "terminal_intent_creation_conflict",
  "terminal_intent_creation_mismatch",
  "terminal_reconciliation_cancel_rejected",
  "terminal_intent_provider_mismatch",
  "terminal_reconciliation_unconfigured",
  "terminal_reconciliation_exhausted_config_missing",
  "terminal_reconciliation_exhausted_open",
  "terminal_reconciliation_exhausted_unknown",
  "refund_paid_identity_duplicate",
  "refund_payment_identity_unverified",
  "refund_fulfillment_history_unverified",
  "refund_owner_records_duplicate",
  "refund_record_duplicate",
  "refund_history_unverified",
  "refund_history_invalid",
  "email_delivery_unknown_after_idempotency_window",
  "email_provider_configuration_changed",
  "email_provider_unconfigured",
  "email_delivery_outcome_unknown",
  "email_provider_400",
  "email_provider_401",
  "email_provider_403",
  "email_provider_404",
  "email_provider_408",
  "email_provider_422",
  "email_provider_429",
  "email_delivery_tracking_unconfirmed",
  "email_tracking_unconfigured",
  "email_tracking_unavailable",
  "email_tracking_response_invalid",
  "email_bounced",
  "email_complained",
  "email_failed",
  "email_suppressed",
  "email_canceled",
] as const);

export type BillingExceptionCode = (typeof billingExceptionCodes)[number];

export const billingSafeReasonCodes = Object.freeze([
  "order_duplicate",
  "order_not_found",
  "payment_session_not_created_by_convex",
  "pos_sale_duplicate",
  "pos_sale_not_found",
  "terminal_intent_not_created_by_convex",
  "session_order_mismatch",
  "attempt_session_mismatch",
  "session_creation_unverified",
  "intent_sale_mismatch",
  "attempt_intent_mismatch",
  "attempt_nonce_missing",
  "attempt_nonce_mismatch",
  "paid_session_mode_invalid",
  "paid_session_livemode_mismatch",
  "paid_session_facts_invalid",
  "amount_or_currency_mismatch",
  "order_expected_provider_mismatch",
  "missing_checkout_payment_intent",
  "paid_intent_source_invalid",
  "paid_intent_livemode_mismatch",
  "paid_intent_facts_invalid",
  "paid_intent_amount_received_mismatch",
  "paid_payment_identity_reused",
  "paid_payment_identity_unverified",
  "paid_payment_ledger_duplicate",
  "paid_payment_identity_conflict",
  "paid_payment_record_mismatch",
  "duplicate_payment_for_order",
  "duplicate_payment_for_sale",
  "paid_booking_duplicate",
  "paid_owner_payment_ambiguous",
  "paid_booking_proof_invalid",
  "paid_ticket_delivery_invalid",
  "paid_order_without_booking",
  "paid_order_snapshot_invalid",
  "paid_owner_history_unverified",
  "paid_sale_snapshot_invalid",
  "paid_sale_without_booking",
  "paid_sale_state_unexpected",
  "paid_after_sale_closed",
  "paid_capacity_reservation_inconsistent",
  "paid_venue_hours_unverified",
  "paid_after_visit_window",
  "paid_fulfillment_after_visit_window",
  "paid_booking_mismatch",
  "paid_capacity_reservation_mismatch",
  "paid_order_capacity_exception",
  "paid_pos_visit_unknown",
  "paid_sale_capacity_exception",
  "checkout_session_creation_outcome_unknown",
  "checkout_attempt_two_sessions",
  "checkout_session_creation_rejected",
  "checkout_session_creation_conflict",
  "checkout_session_creation_mismatch",
  "legacy_payment_pending_without_session",
  "checkout_reconciliation_expiry_rejected",
  "checkout_session_provider_mismatch",
  "checkout_reconciliation_unconfigured",
  "checkout_reconciliation_exhausted_config_missing",
  "checkout_reconciliation_exhausted_open",
  "checkout_reconciliation_exhausted_complete_unpaid",
  "checkout_reconciliation_exhausted_unknown",
  "terminal_intent_creation_outcome_unknown",
  "terminal_attempt_two_intents",
  "terminal_intent_creation_rejected",
  "terminal_intent_creation_conflict",
  "terminal_intent_creation_mismatch",
  "terminal_reconciliation_cancel_rejected",
  "terminal_intent_provider_mismatch",
  "terminal_reconciliation_unconfigured",
  "terminal_reconciliation_exhausted_config_missing",
  "terminal_reconciliation_exhausted_open",
  "terminal_reconciliation_exhausted_unknown",
  "refund_paid_identity_duplicate",
  "refund_payment_identity_unverified",
  "refund_fulfillment_history_unverified",
  "refund_owner_records_duplicate",
  "refund_record_duplicate",
  "refund_history_unverified",
  "refund_history_invalid",
  "email_delivery_unknown_after_idempotency_window",
  "email_provider_configuration_changed",
  "email_provider_unconfigured",
  "email_delivery_outcome_unknown",
  "email_provider_400",
  "email_provider_401",
  "email_provider_403",
  "email_provider_404",
  "email_provider_408",
  "email_provider_422",
  "email_provider_429",
  "email_delivery_tracking_unconfirmed",
  "email_tracking_unconfigured",
  "email_tracking_unavailable",
  "email_tracking_response_invalid",
  "email_bounced",
  "email_complained",
  "email_failed",
  "email_suppressed",
  "email_canceled",
  "network_error",
  "provider_configuration_changed",
  "stripe_idempotency_conflict",
  "session_not_found_for_configured_account",
  "intent_not_found_for_configured_account",
  "session_missing",
  "session_object_invalid",
  "session_id_invalid",
  "session_id_mismatch",
  "session_livemode_missing",
  "session_livemode_mismatch",
  "session_mode_missing",
  "session_mode_invalid",
  "session_attempt_nonce_mismatch",
  "session_amount_missing",
  "session_amount_mismatch",
  "session_currency_missing",
  "session_currency_mismatch",
  "session_expiry_mismatch",
  "session_not_open_at_creation",
  "session_url_missing",
  "paid_session_without_payment_intent",
  "session_payment_status_unsupported",
  "session_status_unsupported",
  "intent_missing",
  "intent_object_invalid",
  "intent_id_invalid",
  "intent_id_mismatch",
  "intent_livemode_missing",
  "intent_livemode_mismatch",
  "intent_source_mismatch",
  "intent_attempt_nonce_mismatch",
  "intent_amount_missing",
  "intent_amount_mismatch",
  "intent_currency_mismatch",
  "intent_capture_method_mismatch",
  "intent_payment_method_mismatch",
  "intent_not_new_at_creation",
  "intent_amount_received_mismatch",
  "intent_requires_capture",
  "intent_status_unsupported",
  "customer_email_missing",
  "booking_ambiguous",
  "booking_missing",
  "booking_cancelled",
  "booking_not_confirmed",
  "payment_reference_missing",
  "billing_exception_unresolved",
  "order_not_paid",
  "sale_not_paid",
  "delivery_owner_mismatch",
  "payment_proof_invalid",
  "session_open_paid",
  "session_open_no_payment_required",
  "session_complete_paid",
  "session_complete_no_payment_required",
  "session_expired_paid",
  "session_expired_no_payment_required",
  "session_unknown_paid",
  "session_unknown_no_payment_required",
] as const);

export type BillingSafeReasonCode = (typeof billingSafeReasonCodes)[number];

export const billingAuditActions = Object.freeze([
  "checkout.capacityException",
  "pos.capacityException",
  "pos.terminalPayment.paid",
  "pos.terminalPayment.canceled",
  "pos.terminalAttempt.open",
  "pos.terminalIntent.create",
  "pos.terminalReader.process",
  "pos.saleDraft.create",
  "pos.saleDraft.release",
  "payment.refund.reconciled",
  "payment.refund.fulfillmentInvalidated",
  "payment.refund.fulfillmentRestored",
  "pos.terminalWebhook.paid",
  "pos.terminalWebhook.failed",
  "pos.terminalWebhook.canceled",
  "operations.exceptionOpened",
  "operations.exceptionResolved",
] as const);

export type BillingAuditAction = (typeof billingAuditActions)[number];

export const billingIssueCodes = Object.freeze([
  "unrecognized_code",
  "unrecognized_state",
  "unrecognized_action",
  "unrecognized_event_type",
  "unrecognized_api_version",
  "unsafe_reason_withheld",
  "invalid_timestamp",
  "invalid_counter",
  "invalid_amount",
  "invalid_currency",
  "invalid_quantity",
  "invalid_line_total",
  "invalid_owner_total",
  "invalid_party_size",
  "invalid_visit_date",
  "invalid_entry_time",
  "invalid_ref",
  "owner_missing",
  "owner_ambiguous",
  "owner_ref_conflict",
  "booking_missing",
  "booking_ambiguous",
  "booking_ref_conflict",
  "booking_state_unknown",
  "delivery_missing",
  "delivery_ambiguous",
  "delivery_owner_conflict",
  "delivery_acceptance_unverified",
  "delivery_tracking_unverified",
  "attempt_missing",
  "attempt_ambiguous",
  "recovery_identity_conflict",
  "webhook_missing",
  "webhook_ambiguous",
  "webhook_identity_conflict",
  "paid_none_recorded",
  "paid_history_capped",
  "paid_identity_missing",
  "paid_identity_duplicate",
  "paid_identity_conflict",
  "intent_ownership_conflict",
  "intent_ownership_capped",
  "refund_history_capped",
  "refund_identity_duplicate",
  "refund_owner_conflict",
  "refund_amount_invalid",
  "refund_sum_overflow",
  "refund_exceeds_payment",
  "refund_proof_unverified",
  "admission_missing",
  "admission_duplicate",
  "admission_counts_invalid",
  "legacy_use_recorded",
  "admission_relation_unverified",
  "line_history_capped",
  "source_unverified",
  "read_budget_exceeded",
  "booking_payment_provenance_unverified",
  "booking_payment_not_confirmed",
  "booking_stored_money_unverified",
  "booking_payment_evidence_unverified",
  "booking_billing_blocked",
  "booking_line_provenance_unverified",
  "booking_party_unverified",
  "booking_total_unverified",
  "booking_settlement_unverified",
  "booking_identity_unverified",
  "booking_refund_unverified",
  "booking_fully_refunded",
  "booking_visit_unverified",
  "booking_entry_unverified",
] as const);

export type BillingIssueCode = (typeof billingIssueCodes)[number];

export const billingVocabularies = Object.freeze({
  roles: billingRoles,
  exceptionStatuses: billingExceptionStatuses,
  categories: billingCategories,
  ownerStates: billingOwnerStates,
  paymentProviders: billingPaymentProviders,
  paymentStates: billingPaymentStates,
  refundStates: billingRefundStates,
  checkoutAttemptStates: billingCheckoutAttemptStates,
  terminalAttemptStates: billingTerminalAttemptStates,
  deliveryStates: billingDeliveryStates,
  bookingStates: billingBookingStates,
  emailProviderStates: billingEmailProviderStates,
  checkoutProviderStates: billingCheckoutProviderStates,
  terminalProviderStates: billingTerminalProviderStates,
  modes: billingModes,
  apiVersions: billingApiVersions,
  evidenceSources: billingEvidenceSources,
  resolutionCodes: billingResolutionCodes,
  coverages: billingCoverages,
  proofs: billingProofs,
  relations: billingRelations,
  schedules: billingSchedules,
  pageStatuses: billingPageStatuses,
  paneOrders: billingPaneOrders,
  lineKinds: billingLineKinds,
  admissionCategories: billingAdmissionCategories,
  attendanceProofs: billingAttendanceProofs,
  bookingProofs: billingBookingProofs,
  issuances: billingIssuances,
  recordedEvidence: billingRecordedEvidence,
  refundDispositions: billingRefundDispositions,
  recoveryKinds: billingRecoveryKinds,
  auditScopes: billingAuditScopes,
  ownerKinds: billingOwnerKinds,
  channels: billingChannels,
  readFailureCodes: billingReadFailureCodes,
  httpErrorCodes: billingHttpErrorCodes,
  providerStates: billingProviderStates,
  eventTypes: billingEventTypes,
  exceptionCodes: billingExceptionCodes,
  safeReasonCodes: billingSafeReasonCodes,
  auditActions: billingAuditActions,
  issueCodes: billingIssueCodes,
});


/** Exact membership; never coerce a freeform provider/error value into a code. */
export function isBillingVocabularyValue<Key extends keyof typeof billingVocabularies>(
  key: Key,
  value: unknown
): value is (typeof billingVocabularies)[Key][number] {
  return typeof value === "string" && billingVocabularies[key].some((candidate) => candidate === value);
}

/** Generated public business references only; arbitrary legacy refs stay internal. */
export const billingDisplayRefPattern = /^(?:SKY\d{4}-[A-Z0-9]{6}|SALE\d{6}-[A-Z0-9]{6}|LEGACY-[A-F0-9]{16})$/;

export function isBillingDisplayRef(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = billingDisplayRefPattern.exec(value);
  // Keep display references bound to the complete original value.
  return match !== null && match[0].length === value.length;
}

export type BillingOwner = BillingReadonly<{ kind: "order" | "sale"; ref: string | null }>;

export type BillingPageRequest = BillingReadonly<{
  status: BillingExceptionStatus; limit: number;
  cursor: string | null; endCursor: string | null;
}>;

export type BillingRefs = BillingReadonly<{ orderRef: string | null; saleRef: string | null; bookingRef: string | null }>;

export type BillingMaskedIds = BillingReadonly<{
  session: string | null; paymentIntent: string | null;
  providerEvent: string | null; providerRefund: string | null;
}>;

export type BillingEvidence = BillingReadonly<{
  source: "webhook" | "reconciliation" | null;
  eventType: BillingEventType | null; providerState: BillingProviderState | null; mode: "test" | "live" | null;
  moneyRecorded: boolean | null; paidAt: number | null;
  attemptStatus: BillingCheckoutAttemptState | BillingTerminalAttemptState | null; providerRequestCount: number | null; reconcileCount: number | null;
  sendVersion: number | null; attemptCount: number | null; autoRetryCount: number | null;
  providerTrackingCount: number | null; providerDeliveryStatus: BillingEmailProviderState | null;
  refundStatus: "pending" | "requires_action" | "succeeded" | "failed" | "canceled" | null;
  providerEventCreatedAt: number | null; safeReasonCode: BillingSafeReasonCode | null;
}>;

export type BillingException = BillingReadonly<{
  exceptionId: string; category: BillingCategory; status: BillingExceptionStatus;
  code: BillingExceptionCode | null; // labels generated locally from safe code; unknown has fixed label
  refs: BillingRefs; idsMasked: BillingMaskedIds;
  moneyReceived: boolean; // this row's affirmative received-money fact, never an unpaid proof
  amountCents: number | null; currency: "usd" | null;
  amountMeaning: "recorded_exception_amount";
  occurrenceCount: number; firstSeenAt: number; lastSeenAt: number;
  resolvedAt: number | null; resolutionCode: BillingResolutionCode | null; resolutionRecorded: boolean;
  recordedAt: number; // native _creationTime, immutable page order/membership fact
  dataIssues: BillingIssueCode[]; // queue has no large evidence object
}>;

export type BillingExceptionPage = BillingReadonly<{
  version: 1; role: BillingRole; query: { status: BillingExceptionStatus; limit: number };
  retrievedAt: number; cutoff: number; startCursor: string | null; endCursor: string | null;
  page: BillingException[]; continueCursor: string | null; splitCursor: string | null;
  pageStatus: null | "SplitRecommended" | "SplitRequired";
  isDone: boolean; segmentDone: boolean; capped: boolean;
}>;

export type BillingOwnerRecord = BillingReadonly<BillingOwner & {
  status: BillingOwnerState | null;
  channel: "online" | "pos";
  subtotalCents: number | null; feeCents: number | null; totalCents: number | null;
  currency: "usd" | null; visitDate: string | null; entryTime: string | null;
  createdAt: number; updatedAt: number; dataIssues: BillingIssueCode[];
}>;

export type BillingLine = BillingReadonly<{
  rowId: string; kind: "ticket" | "addon" | "cafe" | "custom" | null;
  admissionCategory: "adult" | "youth" | "child" | null;
  quantity: number | null; unitAmountCents: number | null; lineTotalCents: number | null;
  // Staff text is generated from kind/category, not arbitrary stored names/metadata.
  dataIssues: BillingIssueCode[];
}>;

export type BillingPaymentRow = BillingReadonly<{
  rowId: string; refs: BillingRefs; provider: BillingPaymentProvider | null;
  paymentIdMasked: string; intentIdMasked: string | null; eventIdMasked: string | null;
  status: BillingPaymentState | null;
  amountCents: number | null; currency: "usd" | null; recordedAt: number; createdAt: number;
  dataIssues: BillingIssueCode[];
}>;

export type BillingRefundRow = BillingReadonly<{
  rowId: string; refs: BillingRefs; provider: "stripe" | "terminal" | null;
  refundIdMasked: string; intentIdMasked: string; eventIdMasked: string;
  status: BillingRefundState | null;
  amountCents: number | null; currency: "usd" | null;
  providerEventCreatedAt: number; createdAt: number; updatedAt: number;
  reasonRecorded: boolean; failureReasonRecorded: boolean; dataIssues: BillingIssueCode[];
}>;

export type BillingAuditRow = BillingReadonly<{
  rowId: string; action: BillingAuditAction | null; entityType: "order" | "posSale" | "operationsException";
  createdAt: number; recordedAt: number;
  facts: { amountCents: number | null; moneyReceived: boolean | null; sendVersion: number | null;
    attemptCount: number | null; safeReasonCode: BillingSafeReasonCode | null };
  dataIssues: BillingIssueCode[];
}>;

export type BillingPane<T> = BillingReadonly<{
  coverage: BillingCoverage; limit: number;
  order: "native_creation_desc" | "recorded_updatedAt_desc";
  rows: T[];
}>;

export type BillingBooking = BillingReadonly<{
  bookingRef: string | null; refs: BillingRefs; status: BillingBookingState | null; visitDate: string | null;
  entryTime: string | null; partySize: number | null; cancelledAt: number | null;
  paidProof: "proven" | "blocked" | "unverified"; reasons: BillingIssueCode[];
}>;

export type BillingDelivery = BillingReadonly<{
  issuance: "issued" | "not_found" | "unverified" | "not_applicable";
  status: "queued" | "sending" | "sent" | "failed" | "suppressed" | null;
  acceptance: "recorded" | "none_recorded" | "unverified";
  deliveryEvidence: "recorded" | "none_recorded" | "unverified";
  sentAt: number | null; deliveredAt: number | null;
  providerDeliveryStatus: BillingEmailProviderState | null; providerStatusAt: number | null;
  sendVersion: number | null; attemptCount: number | null; safeFailureReasonCode: BillingSafeReasonCode | null;
}>;

export type BillingRecovery = BillingReadonly<{
  kind: "checkout" | "terminal" | "email_send" | "email_tracking";
  state: BillingCheckoutAttemptState | BillingTerminalAttemptState | BillingDeliveryState | null;
  correlation: "correlated" | "unverified"; reasons: BillingIssueCode[];
  mode: "test" | "live" | null; apiVersion: "2026-02-25.clover" | null;
  providerState: BillingProviderState | null; safeStopReasonCode: BillingSafeReasonCode | null;
  lastErrorRecorded: boolean; safeLastErrorCode: BillingSafeReasonCode | null;
  providerRequestCount: number | null; reconcileCount: number | null;
  readerProcessCount: number | null; autoRetryCount: number | null; trackingCount: number | null;
  firstProviderRequestAt: number | null; lastProviderRequestAt: number | null;
  lastReconciliationAttemptAt: number | null; lastReaderProcessAt: number | null;
  lastEmailAttemptAt: number | null; settledAt: number | null;
  nextDueAt: number | null; leaseExpiresAt: number | null; readerLeaseExpiresAt: number | null;
  schedule: "scheduled" | "active_lease" | "none_recorded" | "stopped" | "unverified";
  // No worker-healthy or last-verified-provider-read field exists.
}>;

export type BillingDetail = BillingReadonly<{
  version: 1; role: BillingRole; lookup: { exceptionId: string }; retrievedAt: number;
  exception: BillingException; evidence: BillingEvidence;
  relation: { state: "correlated" | "missing" | "ambiguous" | "unverified"; reasons: BillingIssueCode[] };
  owner: BillingOwnerRecord | null;
  lines: { coverage: BillingCoverage; rows: BillingLine[] };
  money: { paidFactRecorded: boolean; proof: BillingProof; reasons: BillingIssueCode[];
    provenPaidCents: number | null; currency: "usd" | null };
  refunds: { proof: BillingProof; reasons: BillingIssueCode[]; succeededRefundCents: number | null;
    disposition: "none_succeeded_recorded" | "partial" | "full" | "unknown" };
  booking: BillingBooking | null;
  attendance: { used: boolean | null; admitted: number | null; departed: number | null;
    inside: number | null; proof: "proven" | "unverified" | "not_applicable"; reasons: BillingIssueCode[] };
  delivery: BillingDelivery; recovery: BillingRecovery[];
  recent: { payments: BillingPane<BillingPaymentRow>; refunds: BillingPane<BillingRefundRow>;
    audit: BillingPane<BillingAuditRow> & { scope: "owner" | "exception_series" } };
  coverage: { owner: BillingCoverage; lines: BillingCoverage; paid: BillingCoverage;
    intentOwnership: BillingCoverage; refunds: BillingCoverage; booking: BillingCoverage;
    admission: BillingCoverage; delivery: BillingCoverage; attempt: BillingCoverage;
    webhook: BillingCoverage };
}>;


/** A read failure receipt, not a mutation/no-commit receipt or a provider result. */
export type BillingBackendReadError = BillingReadonly<
  | {
      kind: "billing_read_error";
      version: 1;
      code: "billing_access_denied" | "billing_cursor_invalid" | "billing_read_unverified";
    }
  | {
      kind: "billing_read_error";
      version: 1;
      code: "billing_record_not_found";
      lookup: { exceptionId: string };
    }
>;

export type BillingHttpError = BillingReadonly<{ error: string; code: BillingHttpErrorCode }>;
