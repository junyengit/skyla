/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as http from "../http.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_orderDraftPersistence from "../lib/orderDraftPersistence.js";
import type * as lib_stripeCheckout from "../lib/stripeCheckout.js";
import type * as lib_stripeTerminal from "../lib/stripeTerminal.js";
import type * as lib_stripeWebhook from "../lib/stripeWebhook.js";
import type * as lib_terminalReaderRegistry from "../lib/terminalReaderRegistry.js";
import type * as orderDrafts from "../orderDrafts.js";
import type * as paymentInternals from "../paymentInternals.js";
import type * as payments from "../payments.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  http: typeof http;
  "lib/auth": typeof lib_auth;
  "lib/orderDraftPersistence": typeof lib_orderDraftPersistence;
  "lib/stripeCheckout": typeof lib_stripeCheckout;
  "lib/stripeTerminal": typeof lib_stripeTerminal;
  "lib/stripeWebhook": typeof lib_stripeWebhook;
  "lib/terminalReaderRegistry": typeof lib_terminalReaderRegistry;
  orderDrafts: typeof orderDrafts;
  paymentInternals: typeof paymentInternals;
  payments: typeof payments;
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
