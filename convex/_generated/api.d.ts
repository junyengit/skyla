/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as admissions from "../admissions.js";
import type * as availability from "../availability.js";
import type * as catalog from "../catalog.js";
import type * as checkoutReconciliation from "../checkoutReconciliation.js";
import type * as checkoutStatus from "../checkoutStatus.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as inquiries from "../inquiries.js";
import type * as legacyMigration from "../legacyMigration.js";
import type * as lib_adminConfig from "../lib/adminConfig.js";
import type * as lib_adminOperations from "../lib/adminOperations.js";
import type * as lib_adminVouchers from "../lib/adminVouchers.js";
import type * as lib_admission from "../lib/admission.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_capacity from "../lib/capacity.js";
import type * as lib_catalogVersioning from "../lib/catalogVersioning.js";
import type * as lib_checkoutAttempts from "../lib/checkoutAttempts.js";
import type * as lib_checkoutDraftExpiry from "../lib/checkoutDraftExpiry.js";
import type * as lib_checkoutFulfillment from "../lib/checkoutFulfillment.js";
import type * as lib_checkoutReturnStatus from "../lib/checkoutReturnStatus.js";
import type * as lib_checkoutSettlement from "../lib/checkoutSettlement.js";
import type * as lib_inquiries from "../lib/inquiries.js";
import type * as lib_legacyMigration from "../lib/legacyMigration.js";
import type * as lib_memberApplications from "../lib/memberApplications.js";
import type * as lib_occupancy from "../lib/occupancy.js";
import type * as lib_operatingHours from "../lib/operatingHours.js";
import type * as lib_operationsExceptions from "../lib/operationsExceptions.js";
import type * as lib_orderDraftPersistence from "../lib/orderDraftPersistence.js";
import type * as lib_posFulfillment from "../lib/posFulfillment.js";
import type * as lib_privateEvents from "../lib/privateEvents.js";
import type * as lib_providerIdentity from "../lib/providerIdentity.js";
import type * as lib_publicGateway from "../lib/publicGateway.js";
import type * as lib_staffBootstrap from "../lib/staffBootstrap.js";
import type * as lib_stripeCheckout from "../lib/stripeCheckout.js";
import type * as lib_stripeHttp from "../lib/stripeHttp.js";
import type * as lib_stripeMode from "../lib/stripeMode.js";
import type * as lib_stripeTerminal from "../lib/stripeTerminal.js";
import type * as lib_stripeWebhook from "../lib/stripeWebhook.js";
import type * as lib_terminalReaderRegistry from "../lib/terminalReaderRegistry.js";
import type * as lib_ticketDelivery from "../lib/ticketDelivery.js";
import type * as lib_ticketDeliveryQueue from "../lib/ticketDeliveryQueue.js";
import type * as lib_ticketDeliveryTracking from "../lib/ticketDeliveryTracking.js";
import type * as memberApplications from "../memberApplications.js";
import type * as operationsExceptions from "../operationsExceptions.js";
import type * as orderDrafts from "../orderDrafts.js";
import type * as paymentInternals from "../paymentInternals.js";
import type * as payments from "../payments.js";
import type * as posStatus from "../posStatus.js";
import type * as privateEvents from "../privateEvents.js";
import type * as publicConfig from "../publicConfig.js";
import type * as staffBootstrap from "../staffBootstrap.js";
import type * as ticketDelivery from "../ticketDelivery.js";
import type * as ticketDeliveryTracking from "../ticketDeliveryTracking.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  admissions: typeof admissions;
  availability: typeof availability;
  catalog: typeof catalog;
  checkoutReconciliation: typeof checkoutReconciliation;
  checkoutStatus: typeof checkoutStatus;
  crons: typeof crons;
  http: typeof http;
  inquiries: typeof inquiries;
  legacyMigration: typeof legacyMigration;
  "lib/adminConfig": typeof lib_adminConfig;
  "lib/adminOperations": typeof lib_adminOperations;
  "lib/adminVouchers": typeof lib_adminVouchers;
  "lib/admission": typeof lib_admission;
  "lib/auth": typeof lib_auth;
  "lib/capacity": typeof lib_capacity;
  "lib/catalogVersioning": typeof lib_catalogVersioning;
  "lib/checkoutAttempts": typeof lib_checkoutAttempts;
  "lib/checkoutDraftExpiry": typeof lib_checkoutDraftExpiry;
  "lib/checkoutFulfillment": typeof lib_checkoutFulfillment;
  "lib/checkoutReturnStatus": typeof lib_checkoutReturnStatus;
  "lib/checkoutSettlement": typeof lib_checkoutSettlement;
  "lib/inquiries": typeof lib_inquiries;
  "lib/legacyMigration": typeof lib_legacyMigration;
  "lib/memberApplications": typeof lib_memberApplications;
  "lib/occupancy": typeof lib_occupancy;
  "lib/operatingHours": typeof lib_operatingHours;
  "lib/operationsExceptions": typeof lib_operationsExceptions;
  "lib/orderDraftPersistence": typeof lib_orderDraftPersistence;
  "lib/posFulfillment": typeof lib_posFulfillment;
  "lib/privateEvents": typeof lib_privateEvents;
  "lib/providerIdentity": typeof lib_providerIdentity;
  "lib/publicGateway": typeof lib_publicGateway;
  "lib/staffBootstrap": typeof lib_staffBootstrap;
  "lib/stripeCheckout": typeof lib_stripeCheckout;
  "lib/stripeHttp": typeof lib_stripeHttp;
  "lib/stripeMode": typeof lib_stripeMode;
  "lib/stripeTerminal": typeof lib_stripeTerminal;
  "lib/stripeWebhook": typeof lib_stripeWebhook;
  "lib/terminalReaderRegistry": typeof lib_terminalReaderRegistry;
  "lib/ticketDelivery": typeof lib_ticketDelivery;
  "lib/ticketDeliveryQueue": typeof lib_ticketDeliveryQueue;
  "lib/ticketDeliveryTracking": typeof lib_ticketDeliveryTracking;
  memberApplications: typeof memberApplications;
  operationsExceptions: typeof operationsExceptions;
  orderDrafts: typeof orderDrafts;
  paymentInternals: typeof paymentInternals;
  payments: typeof payments;
  posStatus: typeof posStatus;
  privateEvents: typeof privateEvents;
  publicConfig: typeof publicConfig;
  staffBootstrap: typeof staffBootstrap;
  ticketDelivery: typeof ticketDelivery;
  ticketDeliveryTracking: typeof ticketDeliveryTracking;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
