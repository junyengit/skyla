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
import type * as http from "../http.js";
import type * as lib_adminConfig from "../lib/adminConfig.js";
import type * as lib_adminOperations from "../lib/adminOperations.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_memberApplications from "../lib/memberApplications.js";
import type * as lib_orderDraftPersistence from "../lib/orderDraftPersistence.js";
import type * as lib_staffBootstrap from "../lib/staffBootstrap.js";
import type * as lib_stripeCheckout from "../lib/stripeCheckout.js";
import type * as lib_stripeTerminal from "../lib/stripeTerminal.js";
import type * as lib_stripeWebhook from "../lib/stripeWebhook.js";
import type * as lib_terminalReaderRegistry from "../lib/terminalReaderRegistry.js";
import type * as memberApplications from "../memberApplications.js";
import type * as orderDrafts from "../orderDrafts.js";
import type * as paymentInternals from "../paymentInternals.js";
import type * as payments from "../payments.js";
import type * as staffBootstrap from "../staffBootstrap.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  http: typeof http;
  "lib/adminConfig": typeof lib_adminConfig;
  "lib/adminOperations": typeof lib_adminOperations;
  "lib/auth": typeof lib_auth;
  "lib/memberApplications": typeof lib_memberApplications;
  "lib/orderDraftPersistence": typeof lib_orderDraftPersistence;
  "lib/staffBootstrap": typeof lib_staffBootstrap;
  "lib/stripeCheckout": typeof lib_stripeCheckout;
  "lib/stripeTerminal": typeof lib_stripeTerminal;
  "lib/stripeWebhook": typeof lib_stripeWebhook;
  "lib/terminalReaderRegistry": typeof lib_terminalReaderRegistry;
  memberApplications: typeof memberApplications;
  orderDrafts: typeof orderDrafts;
  paymentInternals: typeof paymentInternals;
  payments: typeof payments;
  staffBootstrap: typeof staffBootstrap;
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
