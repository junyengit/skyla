import type { BillingException, BillingExceptionPage, BillingExceptionStatus, BillingPageRequest, BillingRole } from "@skyla/payments";

export const billingPageBatchSize = 8;
export const billingSegmentLimit = 4096;
export type BillingSegment = Pick<BillingPageRequest, "cursor" | "endCursor">;
export type BillingTraversal = {
  query: { status: BillingExceptionStatus; limit: number }; cutoff?: number; role?: BillingRole;
  retrievedAt?: number; rows: BillingException[]; segments: BillingSegment[]; visited: string[];
};
export function startBillingTraversal(status: BillingExceptionStatus, limit = 25): BillingTraversal {
  return { query: { status, limit }, rows: [], segments: [{ cursor: null, endCursor: null }], visited: [] };
}
const traversalError = () => new Error("Billing pages could not be verified. Reload records.");
export function acceptBillingPage(state: BillingTraversal, page: BillingExceptionPage): BillingTraversal {
  const current = state.segments[0];
  if (!current || page.query.status !== state.query.status || page.query.limit !== state.query.limit ||
      page.startCursor !== current.cursor || page.endCursor !== current.endCursor ||
      (state.cutoff !== undefined && page.cutoff !== state.cutoff) || (state.role && page.role !== state.role)) throw traversalError();
  const pair = JSON.stringify(current);
  if (state.visited.includes(pair) || state.visited.length >= billingSegmentLimit) throw traversalError();
  let replacement: BillingSegment[] = [];
  let rows = state.rows;
  if (page.pageStatus !== null) {
    const middle = page.splitCursor, end = page.continueCursor;
    if (!middle || !end || middle === end || middle === current.cursor || end === current.cursor || page.isDone || page.segmentDone) throw traversalError();
    // Neither native split form contributes rows or establishes completion.
    replacement = [{ cursor: current.cursor, endCursor: middle }, { cursor: middle, endCursor: end }];
    if (end !== current.endCursor) replacement.push({ cursor: end, endCursor: current.endCursor });
  } else {
    const ids = new Set(rows.map(row => row.exceptionId));
    let last = rows.at(-1)?.recordedAt;
    for (const row of page.page) {
      if (ids.has(row.exceptionId) || (last !== undefined && row.recordedAt > last) || row.recordedAt > page.cutoff) throw traversalError();
      ids.add(row.exceptionId); last = row.recordedAt;
    }
    rows = [...rows, ...page.page];
    if (!page.segmentDone) {
      if (!page.continueCursor || page.continueCursor === current.cursor) throw traversalError();
      replacement = [{ cursor: page.continueCursor, endCursor: current.endCursor }];
    } else if (current.endCursor === null && !page.isDone) throw traversalError();
  }
  const segments = [...replacement, ...state.segments.slice(1)];
  const visited = [...state.visited, pair];
  if (visited.length + segments.length > billingSegmentLimit || segments.some(segment => visited.includes(JSON.stringify(segment)))) throw traversalError();
  return { ...state, cutoff: page.cutoff, role: page.role, retrievedAt: page.retrievedAt, rows, segments, visited };
}
/** At most eight reads per operator action. Stale reads cannot publish facts. */
export async function readBillingBatch(
  initial: BillingTraversal,
  read: (request: BillingPageRequest & { cutoff?: number }) => Promise<BillingExceptionPage>,
  current: () => boolean
): Promise<BillingTraversal | null> {
  let state = initial;
  for (let count = 0; count < billingPageBatchSize && state.segments.length > 0; count += 1) {
    if (!current()) return null;
    const page = await read({ ...state.query, ...state.segments[0]!, ...(state.cutoff === undefined ? {} : { cutoff: state.cutoff }) });
    if (!current()) return null;
    state = acceptBillingPage(state, page);
  }
  return current() ? state : null;
}
