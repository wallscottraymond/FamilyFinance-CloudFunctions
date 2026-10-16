/**
 * Recurring Review Repository (Convert-To-Recurring Phase 1)
 *
 * Two collections:
 *   - `recurring_review_items/{uid}__{kind}__{hash}` — the "Bills to review" items the app listens
 *     to (owner read only, no client writes). NO trigger listens to this collection (R7).
 *   - `_recurring_review_state/{uid}` — server-only memory (suppressed Plaid txn ids, "Not a bill"
 *     vendors, detector throttle). One `get` per reader.
 *
 * Resolved items carry `expireAt` (console TTL policy on that field); open and dismissed items
 * never do (a dismissed item is the visible half of the "Not a bill" memory).
 *
 * @module repositories/recurring_review
 */

import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { TraceContext, chunk_for_batch } from "../types";
import {
  RESOLVED_ITEM_TTL_MS,
  RecurringReviewState,
  ReviewItem,
  ReviewStateChange,
  apply_review_state_change,
  suppressed_hash,
} from "../domain/recurring/review_item.service";

export const REVIEW_ITEMS_COLLECTION = "recurring_review_items";
export const REVIEW_STATE_COLLECTION = "_recurring_review_state";
/** Reserved (rules deny-all, purged); the detector throttle lives in the review state doc (X8). */
export const DETECTOR_STATE_COLLECTION = "_recurring_detector_state";

/* eslint-disable @typescript-eslint/naming-convention */
interface ReviewItemDoc {
  id: string;
  userId: string;
  kind: ReviewItem["kind"];
  direction: ReviewItem["direction"];
  source: ReviewItem["source"];
  status: ReviewItem["status"];
  answer: ReviewItem["answer"];
  subjectKey: string;
  vendorKey: string | null;
  accountId: string | null;
  plaidItemDocId: string | null;
  streamId: string | null;
  recordId: string | null;
  name: string;
  amount: number;
  frequency: string | null;
  plaidStatus: string | null;
  category: string | null;
  transactionIds: string[];
  nextDueDate: Timestamp | null;
  userFrequency: string | null;
  contentHash: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  resolvedAt: Timestamp | null;
  expireAt?: Timestamp;
}

interface ReviewStateDoc {
  userId: string;
  suppressedTxnIds: string[];
  suppressedHash: string;
  dismissedVendorKeys: string[];
  detectorLastRunDay: string | null;
  updatedAt: Timestamp;
}

function state_from_doc(user_id: string, d: ReviewStateDoc): RecurringReviewState {
  return {
    user_id,
    suppressed_txn_ids: d.suppressedTxnIds ?? [],
    dismissed_vendor_keys: d.dismissedVendorKeys ?? [],
    detector_last_run_day: d.detectorLastRunDay ?? null,
  };
}

function state_to_doc(state: RecurringReviewState): ReviewStateDoc {
  /* eslint-disable @typescript-eslint/naming-convention */
  return {
    userId: state.user_id,
    suppressedTxnIds: state.suppressed_txn_ids,
    suppressedHash: suppressed_hash(state),
    dismissedVendorKeys: state.dismissed_vendor_keys,
    detectorLastRunDay: state.detector_last_run_day,
    updatedAt: Timestamp.now(),
  };
  /* eslint-enable @typescript-eslint/naming-convention */
}

function to_doc(item: ReviewItem): ReviewItemDoc {
  return {
    id: item.id,
    userId: item.user_id,
    kind: item.kind,
    direction: item.direction,
    source: item.source,
    status: item.status,
    answer: item.answer,
    subjectKey: item.subject_key,
    vendorKey: item.vendor_key,
    accountId: item.account_id,
    plaidItemDocId: item.plaid_item_doc_id,
    streamId: item.stream_id,
    recordId: item.record_id,
    name: item.name,
    amount: item.amount,
    frequency: item.frequency,
    plaidStatus: item.plaid_status,
    category: item.category,
    transactionIds: item.transaction_ids,
    nextDueDate: item.next_due_ms !== null ? Timestamp.fromMillis(item.next_due_ms) : null,
    userFrequency: item.user_frequency,
    contentHash: item.content_hash,
    createdAt: Timestamp.fromMillis(item.created_at_ms),
    updatedAt: Timestamp.fromMillis(item.updated_at_ms),
    resolvedAt: item.resolved_at_ms !== null ? Timestamp.fromMillis(item.resolved_at_ms) : null,
    ...(item.status === "resolved" && item.resolved_at_ms !== null
      ? { expireAt: Timestamp.fromMillis(item.resolved_at_ms + RESOLVED_ITEM_TTL_MS) }
      : {}),
  };
}
/* eslint-enable @typescript-eslint/naming-convention */

function from_doc(d: ReviewItemDoc): ReviewItem {
  return {
    id: d.id,
    user_id: d.userId,
    kind: d.kind,
    direction: d.direction,
    source: d.source,
    status: d.status,
    answer: d.answer ?? null,
    subject_key: d.subjectKey,
    vendor_key: d.vendorKey ?? null,
    account_id: d.accountId ?? null,
    plaid_item_doc_id: d.plaidItemDocId ?? null,
    stream_id: d.streamId ?? null,
    record_id: d.recordId ?? null,
    name: d.name,
    amount: d.amount,
    frequency: d.frequency ?? null,
    plaid_status: d.plaidStatus ?? null,
    category: d.category ?? null,
    transaction_ids: d.transactionIds ?? [],
    next_due_ms: d.nextDueDate ? d.nextDueDate.toMillis() : null,
    user_frequency: d.userFrequency ?? null,
    content_hash: d.contentHash,
    created_at_ms: d.createdAt?.toMillis?.() ?? 0,
    updated_at_ms: d.updatedAt?.toMillis?.() ?? 0,
    resolved_at_ms: d.resolvedAt ? d.resolvedAt.toMillis() : null,
  };
}

const items = () => getFirestore().collection(REVIEW_ITEMS_COLLECTION);
const state_ref = (user_id: string) =>
  getFirestore().collection(REVIEW_STATE_COLLECTION).doc(user_id);

export const recurring_review_repo = {
  /** The user's review state, or null (1 read). */
  async get_state(_ctx: TraceContext, user_id: string): Promise<RecurringReviewState | null> {
    if (!user_id) return null;
    const snap = await state_ref(user_id).get();
    return snap.exists ? state_from_doc(user_id, snap.data() as ReviewStateDoc) : null;
  },

  /**
   * Apply a change to the user's review state ATOMICALLY: read-modify-write in one transaction, so
   * concurrent writers (a sync, an answer, the detector) never lose each other's change (e.g. a
   * "Not a bill" landing while a sync writes its held-out ids). Writes only when it changed.
   * Callers first check the change against the state they already read and skip this when it is a
   * no-op there (no extra read). Returns the previous (fresh) state and what changed.
   */
  async apply_state_change(
    ctx: TraceContext,
    user_id: string,
    change: ReviewStateChange
  ): Promise<{
    previous: RecurringReviewState | null;
    next: RecurringReviewState;
    changed: boolean;
    suppressed_changed: boolean;
  }> {
    const db = getFirestore();
    const ref = state_ref(user_id);
    const out = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const previous = snap.exists ? state_from_doc(user_id, snap.data() as ReviewStateDoc) : null;
      const r = apply_review_state_change(previous, user_id, change);
      if (r.changed) tx.set(ref, state_to_doc(r.next));
      return { previous, ...r };
    });
    if (out.changed) {
      console.log(
        `[${ctx.trace_id}] recurring_review_repo.apply_state_change ${user_id}: ` +
          `suppressed=${out.next.suppressed_txn_ids.length} dismissed=${out.next.dismissed_vendor_keys.length}`
      );
    }
    return out;
  },

  /** The items at these (deterministic) ids — one batched read; missing ids are absent (X8). */
  async get_items_by_ids(_ctx: TraceContext, ids: string[]): Promise<Map<string, ReviewItem>> {
    const out = new Map<string, ReviewItem>();
    const unique = [...new Set(ids)];
    for (const chunk of chunk_for_batch(unique)) {
      if (chunk.length === 0) continue;
      const snaps = await getFirestore().getAll(...chunk.map((id) => items().doc(id)));
      for (const s of snaps) if (s.exists) out.set(s.id, from_doc(s.data() as ReviewItemDoc));
    }
    return out;
  },

  /** One item (1 read), or null. */
  async get_item(_ctx: TraceContext, id: string): Promise<ReviewItem | null> {
    const snap = await items().doc(id).get();
    return snap.exists ? from_doc(snap.data() as ReviewItemDoc) : null;
  },

  /** Upsert items (full replace — the domain built the whole item). Batched. Returns count. */
  async upsert_items(ctx: TraceContext, list: ReviewItem[]): Promise<number> {
    if (list.length === 0) return 0;
    for (const chunk of chunk_for_batch(list)) {
      const batch = getFirestore().batch();
      for (const item of chunk) batch.set(items().doc(item.id), to_doc(item));
      await batch.commit();
    }
    console.log(`[${ctx.trace_id}] recurring_review_repo.upsert_items: ${list.length}`);
    return list.length;
  },

  /** The user's OPEN items on one account (account removal closes them, X19). */
  async get_open_for_account(
    _ctx: TraceContext,
    user_id: string,
    account_id: string
  ): Promise<ReviewItem[]> {
    const snap = await items()
      .where("userId", "==", user_id)
      .where("accountId", "==", account_id)
      .where("status", "==", "open")
      .get();
    return snap.docs.map((d) => from_doc(d.data() as ReviewItemDoc));
  },

  /** The user's OPEN items (what the app's one listener sees; used by tests / tooling). */
  async get_open_for_user(_ctx: TraceContext, user_id: string): Promise<ReviewItem[]> {
    const snap = await items().where("userId", "==", user_id).where("status", "==", "open").get();
    return snap.docs.map((d) => from_doc(d.data() as ReviewItemDoc));
  },
};
