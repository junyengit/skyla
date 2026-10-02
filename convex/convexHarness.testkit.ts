// Test-only in-memory stand-in for Convex. The file name has two dots, so the
// Convex bundler skips it and it is never deployed.
import { getFunctionName, type FunctionReference } from "convex/server";

type Row = Record<string, unknown> & { _id: string; _creationTime: number };
type Filter = (row: Row) => boolean;
type Registered = { _handler: (ctx: unknown, args: unknown) => Promise<unknown>; isAction?: boolean };

export type ScheduledJob = { runAt: number; name: string; args: Record<string, unknown> };

// Registered Convex functions are callable objects carrying `_handler`.
function isRegistered(value: unknown): value is Registered {
  return (
    (typeof value === "function" || (typeof value === "object" && value !== null)) &&
    typeof (value as { _handler?: unknown })._handler === "function"
  );
}

/**
 * Mutations and queries run one at a time and roll back on error, which is
 * the serializable, atomic behavior Convex gives conflicting mutations.
 * Actions run outside that lock and reach the database only through
 * runQuery/runMutation, as in Convex.
 */
export function createConvexHarness(modules: Record<string, Record<string, unknown>>) {
  const tables = new Map<string, Row[]>();
  const scheduled: ScheduledJob[] = [];
  const registry = new Map<string, Registered>();
  let nextId = 1;
  let identity: { subject: string } | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  for (const [moduleName, exports] of Object.entries(modules)) {
    for (const [exportName, value] of Object.entries(exports)) {
      if (isRegistered(value)) {
        registry.set(`${moduleName}:${exportName}`, value as Registered);
      }
    }
  }

  const rows = (table: string) => {
    if (!tables.has(table)) tables.set(table, []);
    return tables.get(table)!;
  };
  const find = (id: string) => [...tables.values()].flat().find((row) => row._id === id);

  // Synthetic native pagination only. Actual Convex cursor/split behavior
  // still requires linked-backend proof before release.
  function results(table: string, filters: Filter[], sortFields: string[], descending: boolean, signature = "", postFilters: Filter[] = []) {
    const run = () => {
      const matched = rows(table).filter((row) => filters.every((filter) => filter(row)));
      const sorted = matched.toSorted((left, right) => {
        for (const field of sortFields) {
          const a = left[field];
          const b = right[field];
          if (a === b) continue;
          if (a === undefined) return -1;
          if (b === undefined) return 1;
          return (a as number | string) < (b as number | string) ? -1 : 1;
        }
        return left._creationTime - right._creationTime || (left._id === right._id ? 0 : left._id < right._id ? -1 : 1);
      });
      return descending ? sorted.reverse() : sorted;
    };
    const visible = () => run().filter(row => postFilters.every(filter => filter(row)));
    const queryIdentity = `${table}:${signature}:${descending}`;
    const key = (row: Row) => [...sortFields.map(field => row[field]), row._creationTime, row._id];
    const compare = (a: unknown[], b: unknown[]) => {
      for (let index = 0; index < a.length; index++) {
        if (a[index] === b[index]) continue;
        const result = (a[index] as number | string) < (b[index] as number | string) ? -1 : 1;
        return descending ? -result : result;
      }
      return 0;
    };
    type Position = { query: string; key: unknown[] | null; end: boolean };
    const encode = (row?: Row): string => JSON.stringify({ query: queryIdentity, key: row ? key(row) : null, end: !row });
    const decode = (cursor: string): Position => {
      const position = JSON.parse(cursor) as Position;
      if (position.query !== queryIdentity || (position.key === null ? !position.end : !Array.isArray(position.key))) {
        throw new Error("InvalidCursor: query changed");
      }
      return position;
    };
    const api = {
      order(direction: "asc" | "desc") {
        return results(table, filters, sortFields, direction === "desc", signature, postFilters);
      },
      filter(build: (query: unknown) => unknown) {
        let predicate: Filter = () => true;
        let detail = "";
        const builder = {
          field: (field: string) => ({ field }),
          lte(left: { field: string }, right: number) {
            detail = JSON.stringify([left.field, "lte", right]);
            predicate = row => (row[left.field] as number) <= right;
            return predicate;
          }
        };
        build(builder);
        return results(table, filters, sortFields, descending, `${signature}:filter:${detail}`, [...postFilters, predicate]);
      },
      async paginate(options: { numItems: number; cursor: string | null; endCursor?: string | null; maximumRowsRead?: number; maximumBytesRead?: number }) {
        const start = options.cursor ? decode(options.cursor) : null;
        const end = options.endCursor ? decode(options.endCursor) : null;
        const candidates = start?.end ? [] : run().filter(row =>
          (!start?.key || compare(key(row), start.key) > 0) &&
          (!end?.key || compare(key(row), end.key) <= 0)
        );
        const page: Row[] = [];
        const scanned: Row[] = [];
        let bytes = 0;
        let truncated = false;
        for (const row of candidates) {
          const size = new TextEncoder().encode(JSON.stringify(row)).length;
          if (scanned.length >= (options.maximumRowsRead ?? Infinity) || bytes + size > (options.maximumBytesRead ?? Infinity)) {
            truncated = true; break;
          }
          scanned.push(row); bytes += size;
          if (postFilters.every(filter => filter(row))) page.push(row);
          if (!end && page.length >= options.numItems) break;
        }
        const scannedAll = scanned.length === candidates.length;
        const continueCursor = end && (scannedAll || truncated)
          ? options.endCursor!
          : scannedAll ? encode() : encode(scanned.at(-1));
        const splitRow = scanned.length > 1 ? scanned[Math.floor(scanned.length / 2) - 1] : undefined;
        return {
          page, continueCursor,
          isDone: !end && scannedAll,
          pageStatus: truncated ? "SplitRequired" as const : null,
          splitCursor: truncated && splitRow ? encode(splitRow) : null
        };
      },
      first: async () => visible()[0] ?? null,
      unique: async () => {
        const matched = visible();
        if (matched.length > 1) throw new Error(`Expected unique ${table} row`);
        return matched[0] ?? null;
      },
      collect: async () => visible(),
      take: async (count: number) => visible().slice(0, count)
    };
    return api;
  }

  const db = {
    query(table: string) {
      return {
        withIndex(_index: string, build?: (query: unknown) => unknown) {
          const filters: Filter[] = [];
          const fields: string[] = [];
          const terms: Array<[string, string, unknown]> = [];
          const note = (field: string) => {
            if (!fields.includes(field)) fields.push(field);
          };
          const builder = {
            eq(field: string, value: unknown) {
              terms.push([field, "eq", value]);
              filters.push((row) => row[field] === value);
              note(field);
              return builder;
            },
            gt(field: string, value: number | string) {
              terms.push([field, "gt", value]);
              filters.push((row) => row[field] !== undefined && (row[field] as number) > (value as number));
              note(field);
              return builder;
            },
            gte(field: string, value: number | string) {
              terms.push([field, "gte", value]);
              filters.push((row) => row[field] !== undefined && (row[field] as number) >= (value as number));
              note(field);
              return builder;
            },
            lt(field: string, value: number | string) {
              terms.push([field, "lt", value]);
              filters.push((row) => row[field] !== undefined && (row[field] as number) < (value as number));
              note(field);
              return builder;
            },
            lte(field: string, value: number | string) {
              terms.push([field, "lte", value]);
              filters.push((row) => row[field] !== undefined && (row[field] as number) <= (value as number));
              note(field);
              return builder;
            }
          };
          build?.(builder);
          return results(table, filters, fields, false, JSON.stringify([_index, terms]));
        },
        ...results(table, [], [], false)
      };
    },
    async insert(table: string, doc: Record<string, unknown>) {
      const _id = `${table}|${String(nextId++).padStart(6, "0")}`;
      const row: Row = { _id, _creationTime: Date.now() };
      for (const [key, value] of Object.entries(doc)) {
        if (value !== undefined) row[key] = structuredClone(value);
      }
      rows(table).push(row);
      return _id;
    },
    async patch(id: string, update: Record<string, unknown>) {
      const row = find(id);
      if (!row) throw new Error(`Missing ${id}`);
      for (const [key, value] of Object.entries(update)) {
        if (value === undefined) delete row[key];
        else row[key] = structuredClone(value);
      }
    },
    async get(id: string) {
      const row = find(id);
      return row ? structuredClone(row) : null;
    },
    async delete(id: string) {
      for (const list of tables.values()) {
        const index = list.findIndex((row) => row._id === id);
        if (index >= 0) list.splice(index, 1);
      }
    }
  };

  const scheduler = {
    async runAt(runAt: number, reference: FunctionReference<"mutation" | "action">, args: Record<string, unknown>) {
      scheduled.push({ runAt, name: getFunctionName(reference), args });
      return `scheduled|${scheduled.length}`;
    },
    async runAfter(delay: number, reference: FunctionReference<"mutation" | "action">, args: Record<string, unknown>) {
      scheduled.push({ runAt: Date.now() + delay, name: getFunctionName(reference), args });
      return `scheduled|${scheduled.length}`;
    }
  };

  const ctx = { db, scheduler, auth: { getUserIdentity: async () => identity } };

  function resolve(reference: FunctionReference<"query" | "mutation" | "action"> | Registered): Registered {
    if (isRegistered(reference)) return reference;
    const name = getFunctionName(reference as FunctionReference<"query">);
    const registered = registry.get(name);
    if (!registered) throw new Error(`Harness has no function ${name}`);
    return registered;
  }

  /** Runs a query or mutation atomically; documents are copies, as in Convex. */
  function call<Result = unknown>(
    reference: FunctionReference<"query" | "mutation"> | unknown,
    args: Record<string, unknown>,
    as?: string
  ): Promise<Result> {
    const registered = resolve(reference as Registered);
    const run = async () => {
      identity = as ? { subject: as } : null;
      const snapshot = structuredClone([...tables.entries()]);
      const scheduledBefore = scheduled.length;
      try {
        return (await registered._handler(ctx, structuredClone(args))) as Result;
      } catch (error) {
        tables.clear();
        for (const [table, list] of snapshot) tables.set(table, list);
        scheduled.length = scheduledBefore;
        throw error;
      }
    };
    const result = queue.then(run, run);
    queue = result.catch(() => undefined);
    return result;
  }

  // As in Convex, an action's caller identity flows into its runQuery and
  // runMutation calls; scheduled actions run without one.
  const makeActionCtx = (as?: string) => ({
    runQuery: (reference: FunctionReference<"query">, args: Record<string, unknown>) => call(reference, args, as),
    runMutation: (reference: FunctionReference<"mutation">, args: Record<string, unknown>) => call(reference, args, as),
    runAction: (reference: FunctionReference<"action">, args: Record<string, unknown>) => runAction(reference, args, as),
    scheduler,
    auth: { getUserIdentity: async () => (as ? { subject: as } : null) }
  });
  const actionCtx = makeActionCtx();

  function runAction<Result = unknown>(
    reference: FunctionReference<"action"> | unknown,
    args: Record<string, unknown>,
    as?: string
  ) {
    return resolve(reference as Registered)._handler(makeActionCtx(as), structuredClone(args)) as Promise<Result>;
  }

  /** Runs due scheduled jobs (optionally only those whose name matches). */
  async function runDueJobs(match?: (job: ScheduledJob) => boolean) {
    const now = Date.now();
    const due = scheduled.filter((job) => job.runAt <= now && (!match || match(job)));
    for (const job of due) scheduled.splice(scheduled.indexOf(job), 1);
    const outcomes: Array<{ job: ScheduledJob; result?: unknown; error?: unknown }> = [];
    for (const job of due) {
      const registered = registry.get(job.name);
      if (!registered) throw new Error(`Harness has no function ${job.name}`);
      try {
        const isAction = (registered as { isAction?: boolean }).isAction === true;
        const result = isAction ? await runAction(registered, job.args) : await call(registered, job.args);
        outcomes.push({ job, result });
      } catch (error) {
        outcomes.push({ job, error });
      }
    }
    return outcomes;
  }

  function seed(table: string, doc: Record<string, unknown>) {
    const _id = `${table}|seed-${nextId++}`;
    rows(table).push({ _creationTime: 1, ...doc, _id } as Row);
    return _id;
  }

  return { ctx, actionCtx, rows, scheduled, call, runAction, runDueJobs, seed };
}

export type ConvexHarness = ReturnType<typeof createConvexHarness>;

type FakeSession = Record<string, unknown> & { id: string; status: string; payment_status: string };
type StripeFault =
  | "network_before_send"
  | "network_after_create"
  | "stored_500"
  | "invalid_request"
  | "server_error"
  | "unauthorized";

/**
 * Local Stripe stand-in with real idempotency semantics: a stored key with
 * the same body returns the stored result (including a stored 500), a stored
 * key with a different body is an idempotency_error, and validation failures
 * are not stored. Expiry below 30 minutes is rejected. No network is used.
 */
export function createFakeStripe(options: { livemode?: boolean } = {}) {
  const sessions = new Map<string, FakeSession>();
  const idempotency = new Map<string, { body: string; status: number; response: unknown }>();
  const calls: Array<{ method: string; path: string; idempotencyKey?: string; body?: string }> = [];
  const faults: StripeFault[] = [];
  let tamper: ((session: Record<string, unknown>) => Record<string, unknown>) | undefined;
  let counter = 0;
  const livemode = options.livemode ?? false;

  async function fetch(input: string | URL, init: RequestInit = {}) {
    const url = new URL(String(input));
    if (url.origin !== "https://api.stripe.com") throw new Error(`Fake Stripe got ${url.origin}`);
    const path = url.pathname.replace(/^\/v1/, "");
    const headers = init.headers as Record<string, string>;
    const method = init.method ?? "GET";
    const body = init.body ? String(init.body) : undefined;
    calls.push({ method, path, idempotencyKey: headers["Idempotency-Key"], body });
    const fault = faults.shift();
    if (fault === "network_before_send") throw new TypeError("network unreachable");
    if (fault === "unauthorized") return Response.json({ error: { type: "authentication_error" } }, { status: 401 });

    if (method === "POST" && path === "/checkout/sessions") {
      const key = headers["Idempotency-Key"];
      const stored = key ? idempotency.get(key) : undefined;
      if (stored) {
        if (stored.body !== body) {
          return Response.json({ error: { type: "idempotency_error" } }, { status: 400 });
        }
        if (fault === "network_after_create") throw new TypeError("connection reset");
        return Response.json(stored.response, { status: stored.status });
      }
      if (fault === "invalid_request") {
        return Response.json({ error: { type: "invalid_request_error" } }, { status: 400 });
      }
      if (fault === "stored_500") {
        idempotency.set(key, { body: body!, status: 500, response: { error: { type: "api_error" } } });
        return Response.json({ error: { type: "api_error" } }, { status: 500 });
      }
      const params = new URLSearchParams(body);
      const expiresAt = Number(params.get("expires_at"));
      if (!expiresAt || expiresAt * 1000 - Date.now() < 30 * 60 * 1000) {
        return Response.json({ error: { type: "invalid_request_error", param: "expires_at" } }, { status: 400 });
      }
      let amount = 0;
      for (let index = 0; params.has(`line_items[${index}][quantity]`); index += 1) {
        amount +=
          Number(params.get(`line_items[${index}][quantity]`)) *
          Number(params.get(`line_items[${index}][price_data][unit_amount]`));
      }
      counter += 1;
      const id = `cs_${livemode ? "live" : "test"}_fake${String(counter).padStart(12, "0")}`;
      const metadata: Record<string, string> = {};
      for (const [name, value] of params) {
        const match = /^metadata\[(.+)\]$/.exec(name);
        if (match) metadata[match[1]] = value;
      }
      const session: FakeSession = {
        id,
        object: "checkout.session",
        livemode,
        mode: params.get("mode"),
        status: "open",
        payment_status: "unpaid",
        url: `https://checkout.stripe.com/c/pay/${id}`,
        client_reference_id: params.get("client_reference_id"),
        metadata,
        amount_total: amount,
        currency: params.get("line_items[0][price_data][currency]"),
        expires_at: expiresAt,
        payment_intent: null
      };
      sessions.set(id, session);
      const response = tamper ? tamper(structuredClone(session)) : structuredClone(session);
      idempotency.set(key, { body: body!, status: 200, response });
      if (fault === "network_after_create") throw new TypeError("connection reset");
      return Response.json(response);
    }

    if (method === "GET" && path.startsWith("/checkout/sessions/")) {
      if (fault === "server_error") return Response.json({ error: { type: "api_error" } }, { status: 500 });
      const session = sessions.get(decodeURIComponent(path.slice("/checkout/sessions/".length)));
      if (!session) return Response.json({ error: { type: "invalid_request_error" } }, { status: 404 });
      return Response.json(structuredClone(session));
    }
    throw new Error(`Fake Stripe does not handle ${method} ${path}`);
  }

  return {
    fetch,
    sessions,
    idempotency,
    calls,
    createCalls: () => calls.filter((call) => call.method === "POST" && call.path === "/checkout/sessions"),
    retrieveCalls: () => calls.filter((call) => call.method === "GET"),
    fail(...next: StripeFault[]) {
      faults.push(...next);
    },
    tamperCreatedSession(change: ((session: Record<string, unknown>) => Record<string, unknown>) | undefined) {
      tamper = change;
    },
    pay(sessionId: string, paymentIntentId = `pi_fake_${sessionId.slice(-6)}`) {
      Object.assign(sessions.get(sessionId)!, { status: "complete", payment_status: "paid", payment_intent: paymentIntentId });
      return paymentIntentId;
    },
    expire(sessionId: string) {
      Object.assign(sessions.get(sessionId)!, { status: "expired", url: null });
    },
    session(sessionId: string) {
      return sessions.get(sessionId)!;
    }
  };
}

type TerminalFault =
  // Placeholder so a later fault lands on the intended request.
  | "none"
  | "network_before_send"
  | "network_after_create"
  | "stored_500"
  | "invalid_request"
  | "server_error"
  | "reader_timeout"
  | "reader_busy";

/**
 * Local Stripe Terminal stand-in with real idempotency semantics for
 * PaymentIntent creation and reader handoff: the same key and body return
 * the stored result, a changed body is an idempotency_error, and validation
 * failures are not stored. Declines keep the same intent payable, as Stripe
 * does. No network is used.
 */
export function createFakeStripeTerminal(options: { livemode?: boolean } = {}) {
  const intents = new Map<string, Record<string, unknown>>();
  const idempotency = new Map<string, { body: string; status: number; response: unknown }>();
  const calls: Array<{ method: string; path: string; idempotencyKey?: string; body?: string; authorization?: string }> = [];
  const faults: TerminalFault[] = [];
  const livemode = options.livemode ?? false;
  let counter = 0;
  let beforeRequest: ((call: { method: string; path: string }) => void) | undefined;

  async function fetch(input: string | URL, init: RequestInit = {}) {
    const url = new URL(String(input));
    if (url.origin !== "https://api.stripe.com") throw new Error(`Fake Stripe got ${url.origin}`);
    const path = url.pathname.replace(/^\/v1/, "");
    const headers = init.headers as Record<string, string>;
    const method = init.method ?? "GET";
    const body = init.body ? String(init.body) : undefined;
    calls.push({ method, path, idempotencyKey: headers["Idempotency-Key"], body, authorization: headers.Authorization });
    beforeRequest?.({ method, path });
    const fault = faults.shift();
    if (fault === "network_before_send") throw new TypeError("network unreachable");

    const stored = (key: string | undefined) => (key ? idempotency.get(key) : undefined);
    if (method === "POST" && path === "/payment_intents") {
      const key = headers["Idempotency-Key"];
      const existing = stored(key);
      if (existing) {
        if (existing.body !== body) return Response.json({ error: { type: "idempotency_error" } }, { status: 400 });
        if (fault === "network_after_create") throw new TypeError("connection reset");
        return Response.json(existing.response, { status: existing.status });
      }
      if (fault === "invalid_request") return Response.json({ error: { type: "invalid_request_error" } }, { status: 400 });
      if (fault === "stored_500") {
        idempotency.set(key, { body: body!, status: 500, response: { error: { type: "api_error" } } });
        return Response.json({ error: { type: "api_error" } }, { status: 500 });
      }
      const params = new URLSearchParams(body);
      const metadata: Record<string, string> = {};
      for (const [name, value] of params) {
        const match = /^metadata\[(.+)\]$/.exec(name);
        if (match) metadata[match[1]] = value;
      }
      counter += 1;
      const id = `pi_fake${String(counter).padStart(12, "0")}`;
      const intent = {
        id,
        object: "payment_intent",
        livemode,
        amount: Number(params.get("amount")),
        amount_received: 0,
        currency: params.get("currency"),
        status: "requires_payment_method",
        capture_method: params.get("capture_method"),
        payment_method_types: params.getAll("payment_method_types[]"),
        client_secret: `${id}_secret_fake`,
        metadata
      };
      intents.set(id, intent);
      idempotency.set(key, { body: body!, status: 200, response: structuredClone(intent) });
      if (fault === "network_after_create") throw new TypeError("connection reset");
      return Response.json(intent);
    }

    if (method === "GET" && path.startsWith("/payment_intents/")) {
      if (fault === "server_error") return Response.json({ error: { type: "api_error" } }, { status: 500 });
      const intent = intents.get(decodeURIComponent(path.slice("/payment_intents/".length)));
      if (!intent) return Response.json({ error: { type: "invalid_request_error" } }, { status: 404 });
      return Response.json(structuredClone(intent));
    }

    const reader = /^\/terminal\/readers\/([^/]+)\/process_payment_intent$/.exec(path);
    if (method === "POST" && reader) {
      if (fault === "reader_timeout") throw new TypeError("reader request timed out");
      if (fault === "reader_busy") {
        return Response.json({ error: { type: "invalid_request_error", code: "terminal_reader_busy" } }, { status: 400 });
      }
      const key = headers["Idempotency-Key"];
      const existing = stored(key);
      if (existing) return Response.json(existing.response, { status: existing.status });
      const paymentIntentId = new URLSearchParams(body).get("payment_intent")!;
      const response = {
        id: decodeURIComponent(reader[1]),
        object: "terminal.reader",
        status: "online",
        action: {
          type: "process_payment_intent",
          status: "in_progress",
          process_payment_intent: { payment_intent: paymentIntentId, process_config: { enable_customer_cancellation: true } }
        }
      };
      idempotency.set(key, { body: body!, status: 200, response });
      return Response.json(response);
    }
    throw new Error(`Fake Stripe Terminal does not handle ${method} ${path}`);
  }

  return {
    fetch,
    intents,
    calls,
    createCalls: () => calls.filter((call) => call.method === "POST" && call.path === "/payment_intents"),
    retrieveCalls: () => calls.filter((call) => call.method === "GET"),
    readerCalls: () => calls.filter((call) => call.path.startsWith("/terminal/readers/")),
    fail(...next: TerminalFault[]) {
      faults.push(...next);
    },
    onRequest(observer: ((call: { method: string; path: string }) => void) | undefined) {
      beforeRequest = observer;
    },
    pay(id: string) {
      const intent = intents.get(id)!;
      Object.assign(intent, { status: "succeeded", amount_received: intent.amount, latest_charge: `ch_${id.slice(3)}` });
      return intent;
    },
    decline(id: string) {
      return Object.assign(intents.get(id)!, {
        status: "requires_payment_method",
        last_payment_error: { code: "card_declined", decline_code: "generic_decline" }
      });
    },
    cancel(id: string) {
      return Object.assign(intents.get(id)!, { status: "canceled" });
    },
    intent(id: string) {
      return intents.get(id)!;
    }
  };
}

/** Local Resend stand-in that honors Idempotency-Key for its retention window. */
export function createFakeResend() {
  const sent = new Map<string, { id: string; at: number; body: string }>();
  const calls: Array<{ idempotencyKey: string; body: string }> = [];
  const faults: Array<"network_after_accept" | "status_422" | "status_500"> = [];
  let delivered = 0;

  async function fetch(input: string | URL, init: RequestInit = {}) {
    if (String(input) !== "https://api.resend.com/emails") throw new Error(`Fake Resend got ${String(input)}`);
    const headers = init.headers as Record<string, string>;
    const key = headers["Idempotency-Key"];
    const body = String(init.body);
    calls.push({ idempotencyKey: key, body });
    const fault = faults.shift();
    if (fault === "status_422") return Response.json({ name: "validation_error" }, { status: 422 });
    if (fault === "status_500") return Response.json({ name: "internal_server_error" }, { status: 500 });
    const existing = sent.get(key);
    if (existing && Date.now() - existing.at < 24 * 60 * 60 * 1000) {
      return Response.json({ id: existing.id });
    }
    delivered += 1;
    const id = `email_${delivered}`;
    sent.set(key, { id, at: Date.now(), body });
    if (fault === "network_after_accept") throw new TypeError("connection reset");
    return Response.json({ id });
  }

  return {
    fetch,
    calls,
    deliveredCount: () => delivered,
    fail(...next: Array<"network_after_accept" | "status_422" | "status_500">) {
      faults.push(...next);
    }
  };
}
