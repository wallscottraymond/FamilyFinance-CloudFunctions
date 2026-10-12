/**
 * Transaction Repository
 *
 * Handles persistence for transaction entities.
 * All writes are audited automatically.
 *
 * NOTE: This repository uses snake_case internally but maps to/from
 * the legacy camelCase Firestore documents for backwards compatibility.
 *
 * @module repositories/transaction
 */

import type { TransactionSplitForMigration } from "../types/plaid";
import { getFirestore, Timestamp, FieldPath } from "firebase-admin/firestore";
import {
  WriteResult,
  TraceContext,
  ReadOptions,
  create_write_result,
  chunk_for_batch,
} from "../types";
import {
  TransactionForPersistence,
  TransactionSplitForPersistence,
  PendingTransactionInfo,
} from "../types/plaid";
import { record_audit_entry_async, record_audit_entries_batch } from "../audit";
import { NotFoundError, PermissionDeniedError } from "../types/errors";

/**
 * Firestore collection name.
 */
const COLLECTION = "transactions";

// ============================================================================
// Legacy Document Types (camelCase - for Firestore compatibility)
// ============================================================================

/**
 * Legacy Firestore document structure (camelCase).
 * Used for reading/writing to maintain backwards compatibility.
 *
 * NOTE: camelCase is intentional - this interfaces with existing Firestore documents.
 */
/* eslint-disable @typescript-eslint/naming-convention */
interface LegacyTransactionDoc {
  id: string;
  transactionId: string;
  userId?: string;
  ownerId: string;
  groupId: string | null;
  groupIds?: string[];
  isPrivate?: boolean;
  transactionDate: Timestamp;
  accountId: string;
  createdBy: string;
  updatedBy: string;
  currency: string;
  description: string;
  internalDetailedCategory: string | null;
  internalPrimaryCategory: string | null;
  plaidDetailedCategory: string;
  plaidPrimaryCategory: string;
  plaidItemId: string;
  source: "plaid" | "manual" | "import";
  transactionStatus: string;
  type: string | null;
  name: string;
  merchantName: string | null;
  vendorKey?: string | null;
  amount?: number;
  isPending?: boolean;
  pendingTransactionId?: string | null;
  splits: LegacySplitDoc[];
  initialPlaidData: {
    plaidAccountId: string;
    plaidMerchantName: string | null;
    plaidName: string;
    plaidTransactionId: string;
    plaidPending: boolean;
    source: "plaid";
  };
  createdAt: Timestamp;
  updatedAt: Timestamp;
  isActive?: boolean;
  isDeleted?: boolean;
  deletionReason?: string;
  needsReview?: boolean;
  needsNote?: boolean;
  // Denormalized union of every split's tag ids. `split.tags` is nested inside splits[], which
  // array-contains cannot query, so this top-level mirror powers tag filtering + delete-strip.
  tagIds?: string[];
}

interface LegacySplitDoc {
  splitId: string;
  budgetId: string;
  budgetName?: string;
  budgetAssignmentSource?: string;
  monthlyPeriodId: string | null;
  weeklyPeriodId: string | null;
  biWeeklyPeriodId: string | null;
  outflowId?: string | null;
  inflowId?: string | null;
  plaidPrimaryCategory: string;
  plaidDetailedCategory: string;
  internalPrimaryCategory: string | null;
  internalDetailedCategory: string | null;
  amount: number;
  description?: string | null;
  isDefault: boolean;
  spendStatus?: "counted" | "ignored" | "refund";
  isIgnored?: boolean;
  isRefund?: boolean;
  isTaxDeductible?: boolean;
  ignoredReason?: string | null;
  refundReason?: string | null;
  paymentType?: string;
  paymentDate: Timestamp;
  rules: string[];
  tags: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
/* eslint-enable @typescript-eslint/naming-convention */

// ============================================================================
// Mapping Functions
// ============================================================================

/** A pending split's MANUAL choices (only the ones the user actually made). */
function pending_manual_choices(s: Record<string, unknown>): Partial<TransactionSplitForMigration> {
  const out: Partial<TransactionSplitForMigration> = {};
  if (s.budgetAssignmentSource === "manual") out.budget_assignment_source = "manual";
  if (s.outflowAssignmentSource === "manual") {
    out.outflow_assignment_source = "manual";
    out.outflow_pinned_period_id = (s.outflowPinnedPeriodId as string | null | undefined) ?? null;
  }
  if (s.categorySource === "user") {
    out.category_source = "user";
    out.overall_category_id = (s.overallCategoryId as string | null | undefined) ?? null;
    out.first_category_id = (s.firstCategoryId as string | null | undefined) ?? null;
    out.second_category_id = (s.secondCategoryId as string | null | undefined) ?? null;
  }
  return out;
}

/**
 * Maps legacy Firestore document to PendingTransactionInfo.
 */
function map_to_pending_info(doc: LegacyTransactionDoc): PendingTransactionInfo {
  return {
    doc_id: doc.id,
    plaid_transaction_id: doc.transactionId,
    amount: doc.amount ?? doc.splits?.[0]?.amount ?? 0,
    splits: (doc.splits || []).map(s => ({
      split_id: s.splitId,
      amount: s.amount,
      budget_id: s.budgetId,
      outflow_id: s.outflowId || null,
      internal_primary_category: s.internalPrimaryCategory,
      internal_detailed_category: s.internalDetailedCategory,
      is_default: s.isDefault,
      tags: s.tags || [],
      // spendStatus is the source of truth; the booleans are its legacy mirrors.
      is_ignored: s.spendStatus ? s.spendStatus === "ignored" : !!s.isIgnored,
      is_refund: s.spendStatus ? s.spendStatus === "refund" : !!s.isRefund,
      is_tax_deductible: !!s.isTaxDeductible,
      ...pending_manual_choices(s as unknown as Record<string, unknown>),
    })),
    internal_primary_category: doc.internalPrimaryCategory,
    internal_detailed_category: doc.internalDetailedCategory,
    description_override: doc.description !== doc.name ? doc.description : null,
    tags: doc.splits?.[0]?.tags || [],
  };
}

/** A transaction doc a sync wrote, with what it replaced (null = created). */
export interface SyncWrittenDoc {
  doc_id: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
}

/** Options for a sync's transaction writes. */
export interface SyncWriteOptions {
  /** Stamped as `syncRunId` on every written doc (see `on_transaction_written`). */
  run_id?: string;
  /** Final shaping before the write — the sync runs the assignment engine here, in memory. */
  before_write?: (
    doc_id: string,
    data: Record<string, unknown>,
    existing: Record<string, unknown> | null
  ) => Promise<Record<string, unknown>>;
}

/**
 * Maps TransactionForPersistence to legacy Firestore document.
 */
function map_to_doc(
  entity: TransactionForPersistence,
  now: Timestamp
): LegacyTransactionDoc {
  const group_ids = entity.group_ids || [];

  return {
    id: entity.id || "",
    transactionId: entity.transaction_id,
    userId: entity.user_id,
    ownerId: entity.user_id,
    groupId: group_ids[0] || null,
    groupIds: group_ids,
    isPrivate: group_ids.length === 0,
    transactionDate: Timestamp.fromDate(entity.transaction_date),
    accountId: entity.account_id,
    createdBy: entity.user_id,
    updatedBy: entity.user_id,
    currency: entity.currency,
    description: entity.name,
    internalDetailedCategory: entity.internal_detailed_category,
    internalPrimaryCategory: entity.internal_primary_category,
    plaidDetailedCategory: entity.plaid_detailed_category,
    plaidPrimaryCategory: entity.plaid_primary_category,
    plaidItemId: entity.plaid_item_id,
    source: entity.source,
    transactionStatus: entity.is_pending ? "pending" : "approved",
    type: entity.type,
    name: entity.name,
    merchantName: entity.merchant_name,
    // Only when the caller computed it, so an update never nulls an existing key.
    ...(entity.vendor_key !== undefined ? { vendorKey: entity.vendor_key } : {}),
    amount: entity.amount,
    isPending: entity.is_pending,
    pendingTransactionId: entity.pending_transaction_id,
    splits: entity.splits.map(s => map_split_to_doc(s, now)),
    initialPlaidData: {
      plaidAccountId: entity.initial_plaid_data.plaid_account_id,
      plaidMerchantName: entity.initial_plaid_data.plaid_merchant_name,
      plaidName: entity.initial_plaid_data.plaid_name,
      plaidTransactionId: entity.initial_plaid_data.plaid_transaction_id,
      plaidPending: entity.initial_plaid_data.plaid_pending,
      source: "plaid",
    },
    createdAt: now,
    updatedAt: now,
    isActive: entity.is_active,
    isDeleted: !entity.is_active,
    // Rules Engine flags (non-blocking; drive the "Needs review" queue). Written on every doc so the
    // queue query (needsReview == true) is consistent.
    needsReview: entity.needs_review ?? false,
    needsNote: entity.needs_note ?? false,
    // Denormalized union of splits' tags → array-contains queryable (see LegacyTransactionDoc).
    tagIds: Array.from(new Set(entity.splits.flatMap(s => s.tags ?? []))),
  };
}

function map_split_to_doc(
  split: TransactionSplitForPersistence,
  now: Timestamp
): LegacySplitDoc {
  return {
    splitId: split.split_id,
    budgetId: split.budget_id,
    monthlyPeriodId: split.monthly_period_id,
    weeklyPeriodId: split.weekly_period_id,
    biWeeklyPeriodId: split.bi_weekly_period_id,
    outflowId: split.outflow_id,
    plaidPrimaryCategory: split.plaid_primary_category,
    plaidDetailedCategory: split.plaid_detailed_category,
    internalPrimaryCategory: split.internal_primary_category,
    internalDetailedCategory: split.internal_detailed_category,
    amount: split.amount,
    isDefault: split.is_default,
    isIgnored: split.is_ignored,
    isRefund: split.is_refund,
    isTaxDeductible: split.is_tax_deductible,
    paymentDate: Timestamp.fromDate(split.payment_date),
    rules: split.rules,
    tags: split.tags,
    // Only written when a rule pinned the budget → the assignment engine honors "manual" and won't
    // reassign it (compute_transaction_assignment). Absent = "category" (engine default).
    ...(split.budget_assignment_source
      ? { budgetAssignmentSource: split.budget_assignment_source }
      : {}),
    // Manual bill pin + user category override (carried pending → posted). Only when set.
    ...(split.outflow_assignment_source === "manual"
      ? {
        outflowAssignmentSource: "manual",
        outflowPinnedPeriodId: split.outflow_pinned_period_id ?? null,
      }
      : {}),
    ...(split.category_source === "user"
      ? {
        categorySource: "user",
        overallCategoryId: split.overall_category_id ?? null,
        firstCategoryId: split.first_category_id ?? null,
        secondCategoryId: split.second_category_id ?? null,
      }
      : {}),
    createdAt: now,
    updatedAt: now,
  };
}

// ============================================================================
// Repository Functions
// ============================================================================

/**
 * Gets Firestore document reference.
 */
function doc_ref(id: string): FirebaseFirestore.DocumentReference {
  return getFirestore().collection(COLLECTION).doc(id);
}

/**
 * Transaction Repository
 *
 * All write operations automatically create audit entries.
 */
export const transaction_repo = {
  /**
   * Upserts transactions from Plaid sync.
   *
   * For each transaction:
   * - If exists (by plaidTransactionId): updates if materially changed
   * - If new: creates with full data
   *
   * @param ctx - Trace context
   * @param transactions - Transactions ready for persistence
   * @param user_id - User ID
   * @param plaid_item_id - Plaid item ID (for scoping)
   * @returns Upsert results with created/updated counts
   */
  async upsert_from_plaid_sync(
    ctx: TraceContext,
    transactions: TransactionForPersistence[],
    user_id: string,
    plaid_item_id: string,
    on_create?: (txn: TransactionForPersistence) => TransactionForPersistence,
    // UPDATE-branch hook (Plaid-Modified-Sync-Preserves-Edits): the caller's PURE merge of
    // the fresh Plaid doc into the doc we already hold (keeps the user's splits / tags /
    // review / categories). The repo holds no merge logic; it just applies it on update.
    on_update?: (
      existing: Record<string, unknown>,
      fresh: Record<string, unknown>
    ) => Record<string, unknown>,
    opts?: SyncWriteOptions
  ): Promise<{
    created: number;
    updated: number;
    results: Array<{
      plaid_transaction_id: string;
      doc_id: string;
      action: "created" | "updated";
    }>;
    /** Every doc written (before = the stored doc, null on create) — the sync's follow-up input. */
    written: SyncWrittenDoc[];
  }> {
    if (transactions.length === 0) {
      return { created: 0, updated: 0, results: [], written: [] };
    }

    const db = getFirestore();
    const now = Timestamp.now();
    let created = 0;
    let updated = 0;
    const results: Array<{
      plaid_transaction_id: string;
      doc_id: string;
      action: "created" | "updated";
    }> = [];
    const written: SyncWrittenDoc[] = [];
    // Stamped on every doc this sync writes so `on_transaction_written` can tell the write came
    // from a sync (which runs its own single follow-up pass) and skip its per-transaction fan-out.
    const tag: Record<string, unknown> = opts?.run_id
      ? { syncRunId: opts.run_id, lastWriteSource: "plaid_sync" }
      : {};

    // Process in batches
    const chunks = chunk_for_batch(transactions);

    for (const chunk of chunks) {
      const batch = db.batch();
      const audits: Array<{ doc_id: string; action: "created" | "updated" }> = [];

      // Existence lookup for the WHOLE chunk in ⌈N/30⌉ batched `in` queries (matches by the
      // `transactionId` field, so it finds both deterministic `plaid_${id}` docs AND legacy
      // random-id docs) — instead of one indexed query PER transaction (the O(N)/sync read line).
      const existing_docs = await this.get_by_plaid_transaction_ids(
        ctx,
        user_id,
        chunk.map((t) => t.transaction_id)
      );
      const existing_by_txn_id = new Map<
        string,
        { doc_id: string; created_at: Timestamp; doc: LegacyTransactionDoc }
      >();
      for (const d of existing_docs) {
        existing_by_txn_id.set(d.transactionId, {
          doc_id: d.id,
          created_at: d.createdAt,
          doc: d, // full doc, already read by the lookup (the merge needs no extra reads)
        });
      }

      for (const txn of chunk) {
        const existing = existing_by_txn_id.get(txn.transaction_id) ?? null;

        if (existing) {
          // UPDATE: Update the existing document
          const fresh_doc = map_to_doc({ ...txn, id: existing.doc_id }, now);
          fresh_doc.createdAt = existing.created_at; // Preserve original creation time
          fresh_doc.updatedAt = now;
          const { id: _existing_id, ...existing_doc } =
            existing.doc as unknown as Record<string, unknown>;
          const merged = on_update
            ? on_update(existing_doc, fresh_doc as unknown as Record<string, unknown>)
            : (fresh_doc as unknown as Record<string, unknown>);
          // Final shape decided BEFORE the write (e.g. the assignment engine run in memory), so
          // the transaction is written once, finished.
          const shaped = opts?.before_write
            ? await opts.before_write(existing.doc_id, merged, existing_doc)
            : merged;
          const doc_data = { ...shaped, ...tag };

          batch.update(doc_ref(existing.doc_id), doc_data);

          results.push({
            plaid_transaction_id: txn.transaction_id,
            doc_id: existing.doc_id,
            action: "updated",
          });
          written.push({ doc_id: existing.doc_id, before: existing_doc, after: doc_data });
          audits.push({ doc_id: existing.doc_id, action: "updated" });
          updated++;
        } else {
          // CREATE: New transaction.
          // DETERMINISTIC doc id derived from the Plaid transaction_id (NOT random)
          // so concurrent syncs (the 6h fallback crons + a webhook processing the
          // same "added" txn) collide on the SAME doc id → one idempotent `set`,
          // never a duplicate. The pre-check above is not atomic, so a random id
          // would let both branches create separate docs (the dup bug, 2026-08-18).
          // `plaid_` prefix avoids Firestore's reserved `.`/`..`/`__*__` id forms;
          // `/` (illegal in an id) is sanitized. Existing random-id docs stay found
          // by `get_by_plaid_transaction_id`, so no migration + no split-brain.
          //
          // FIRST-WRITE-ONLY hook: apply the caller's pure transform (the Rules Engine) ONLY on
          // CREATE — never on the update branch above — so rules run exactly once per transaction
          // and can't clobber a later manual edit. The transform is pure; the repo holds no rule
          // logic, it just invokes it at the create lifecycle point.
          const effective = on_create ? on_create(txn) : txn;
          const doc_id = `plaid_${effective.transaction_id.replace(/\//g, "_")}`;
          const base = map_to_doc({ ...effective, id: doc_id }, now) as unknown as Record<string, unknown>;
          const shaped = opts?.before_write ? await opts.before_write(doc_id, base, null) : base;
          const doc_data = { ...shaped, ...tag };

          batch.set(doc_ref(doc_id), doc_data);

          results.push({
            plaid_transaction_id: txn.transaction_id,
            doc_id,
            action: "created",
          });
          written.push({ doc_id, before: null, after: doc_data });
          audits.push({ doc_id, action: "created" });
          created++;
        }
      }

      await batch.commit();

      // ONE audit entry per page (ids only) instead of a full-copy, fire-and-forget entry per
      // transaction — 3,000 audit docs per first link became 6. Awaited so it isn't dropped.
      if (audits.length > 0) {
        await record_audit_entries_batch([
          {
            user_id,
            action: "update",
            entity_type: "transaction",
            entity_id: `plaid_sync:${plaid_item_id}`,
            before: null,
            after: {
              created: audits.filter((a) => a.action === "created").map((a) => a.doc_id),
              updated: audits.filter((a) => a.action === "updated").map((a) => a.doc_id),
            },
            trace_id: ctx.trace_id,
            metadata: { source: "api", context: { plaid_sync: true, run_id: opts?.run_id ?? null } },
          },
        ]).catch((e) => console.warn(`[${ctx.trace_id}] sync audit write failed (non-fatal):`, e));
      }
    }

    console.log(
      `[${ctx.trace_id}] upsert_from_plaid_sync: created=${created}, updated=${updated}`
    );

    return { created, updated, results, written };
  },

  /**
   * Loads full transaction docs by their PLAID transaction ids (the membership
   * list a recurring outflow/inflow carries in `transactionIds`). Queries by
   * `transactionId` (globally unique → no composite index) and filters to the
   * owner in memory. Batched via Firestore `in` (≤30 per query). Used by the
   * recurring reconciliation resolver.
   */
  async get_by_plaid_transaction_ids(
    ctx: TraceContext,
    user_id: string,
    plaid_transaction_ids: string[]
  ): Promise<LegacyTransactionDoc[]> {
    if (plaid_transaction_ids.length === 0) {
      return [];
    }
    const db = getFirestore();
    const out: LegacyTransactionDoc[] = [];
    // `in` takes ≤30 values; run the chunks in parallel (was serial — ~17 round trips per
    // 500-transaction page).
    const chunks: string[][] = [];
    for (let i = 0; i < plaid_transaction_ids.length; i += 30) {
      chunks.push(plaid_transaction_ids.slice(i, i + 30));
    }
    const snapshots = await Promise.all(
      chunks.map((chunk) => db.collection(COLLECTION).where("transactionId", "in", chunk).get())
    );
    for (const snapshot of snapshots) {
      for (const doc of snapshot.docs) {
        const data = doc.data() as LegacyTransactionDoc;
        if (data.ownerId === user_id) {
          out.push({ ...data, id: doc.id });
        }
      }
    }
    console.log(
      `[${ctx.trace_id}] get_by_plaid_transaction_ids: requested=${plaid_transaction_ids.length}, found=${out.length}`
    );
    return out;
  },

  /**
   * Loads active transactions whose splits are linked to a recurring outflow/inflow,
   * via the denormalized queryable `splitOutflowIds` / `splitInflowIds`
   * (`array-contains`). This is the DURABLE link (stamped by the assignment engine),
   * which survives Plaid's id reissue on pending→posted — unlike the recurring's
   * stale stream `transactionIds[]`. Returns docs with `id` populated.
   *
   * @param ctx - Trace context
   * @param user_id - Owner (filtered in memory to avoid a composite index)
   * @param recurring_type - "outflow" | "inflow"
   * @param recurring_id - The recurring definition id
   */
  async get_by_split_recurring_link(
    ctx: TraceContext,
    user_id: string,
    recurring_type: "outflow" | "inflow",
    recurring_id: string
  ): Promise<LegacyTransactionDoc[]> {
    if (!recurring_id) return [];
    const field = recurring_type === "outflow" ? "splitOutflowIds" : "splitInflowIds";
    const db = getFirestore();
    const snapshot = await db
      .collection(COLLECTION)
      .where(field, "array-contains", recurring_id)
      .get();
    const out: LegacyTransactionDoc[] = [];
    for (const doc of snapshot.docs) {
      const data = doc.data() as LegacyTransactionDoc;
      if (data.ownerId === user_id && data.isActive !== false) {
        out.push({ ...data, id: doc.id });
      }
    }
    console.log(
      `[${ctx.trace_id}] get_by_split_recurring_link: ${recurring_type}=${recurring_id}, found=${out.length}`
    );
    return out;
  },

  /**
   * Updates specific fields on a transaction.
   *
   * @param ctx - Trace context
   * @param doc_id - Document ID
   * @param updates - Field updates to apply
   * @returns Write result
   */
  async update_transaction_fields(
    ctx: TraceContext,
    doc_id: string,
    updates: Partial<{
      internal_primary_category: string | null;
      internal_detailed_category: string | null;
      splits: TransactionSplitForPersistence[];
      is_pending: boolean;
    }>
  ): Promise<WriteResult> {
    const now = Timestamp.now();
    const before_doc = await doc_ref(doc_id).get();

    if (!before_doc.exists) {
      throw new Error(`Transaction ${doc_id} not found`);
    }

    const before = before_doc.data() as LegacyTransactionDoc;

    /* eslint-disable @typescript-eslint/naming-convention */
    const update_data: Record<string, unknown> = {
      updatedAt: now,
    };

    if (updates.internal_primary_category !== undefined) {
      update_data.internalPrimaryCategory = updates.internal_primary_category;
    }
    if (updates.internal_detailed_category !== undefined) {
      update_data.internalDetailedCategory = updates.internal_detailed_category;
    }
    if (updates.splits !== undefined) {
      update_data.splits = updates.splits.map(s => map_split_to_doc(s, now));
    }
    if (updates.is_pending !== undefined) {
      update_data.isPending = updates.is_pending;
      update_data.transactionStatus = updates.is_pending ? "pending" : "approved";
    }
    /* eslint-enable @typescript-eslint/naming-convention */

    await doc_ref(doc_id).update(update_data);

    // Audit entry
    record_audit_entry_async({
      user_id: before.ownerId,
      action: "update",
      entity_type: "transaction",
      entity_id: doc_id,
      before: before as unknown as Record<string, unknown>,
      after: { ...before, ...update_data } as unknown as Record<string, unknown>,
      trace_id: ctx.trace_id,
      metadata: { source: "api", context: { plaid_sync: true, field_update: true } },
    });

    return create_write_result("transaction", doc_id, "merge", before, { ...before, ...update_data });
  },

  /**
   * Manually PIN a split to a recurring bill (outflow) or CLEAR the pin (outflow_id
   * = null), or DETACH it from bills (`outflow_id = null` + `detach`: a manual pin to
   * "none" — "remove from bill" — that beats auto/stream re-linking; see
   * domain/recurring/stream_membership `is_split_detached_from_outflow`).
   * Sets the split's `outflowId` + `outflowAssignmentSource="manual"` (so the
   * Assignment Engine preserves it across re-syncs) and recomputes the durable
   * `splitOutflowIds` denorm (which the recurring reconcile queries). The resulting
   * write fires `on_transaction_written`, which enqueues the reconcile for the
   * affected bill(s) across before∪after — marking the bill paid. Structural guards
   * only (ownership, existence); no business logic.
   */
  async pin_split_to_outflow(
    ctx: TraceContext,
    doc_id: string,
    split_id: string,
    outflow_id: string | null,
    user_id: string,
    clear_budget = false,
    outflow_period_id: string | null = null,
    detach = false
  ): Promise<WriteResult> {
    const ref = doc_ref(doc_id);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new NotFoundError("transaction", doc_id);
    }
    const before = snap.data() as LegacyTransactionDoc & {
      splits?: Array<Record<string, unknown>>;
    };
    if (before.ownerId !== user_id && (before as { userId?: string }).userId !== user_id) {
      throw new PermissionDeniedError("assign_split_to_outflow", doc_id);
    }
    const splits = (before.splits ?? []).map((s) =>
      s.splitId === split_id
        ? {
            ...s,
            outflowId: outflow_id,
            // Pin manually so a future sync/engine pass preserves it; clearing (null)
            // reverts to auto-derivation unless it's a DETACH (manual pin to "no bill").
            outflowAssignmentSource: outflow_id || detach ? "manual" : "auto",
            // Optional period pin (Bill-Assignment-Two-Stage-Picker): force the recurring
            // reconcile to place this payment in a SPECIFIC period (sourcePeriodId),
            // overriding date-based alignment. Cleared when the bill pin is cleared.
            outflowPinnedPeriodId: outflow_id ? outflow_period_id : null,
            inflowId: null, // a bill payment is not also an income match
            ...(clear_budget ? { budgetId: "", budgetName: "" } : {}),
          }
        : s
    );
    if (!splits.some((s) => s.splitId === split_id)) {
      throw new NotFoundError("transaction_split", split_id);
    }
    // eslint-disable-next-line @typescript-eslint/naming-convention
    const splitOutflowIds = Array.from(
      new Set(
        splits
          .map((s) => s.outflowId as string | undefined)
          .filter((id): id is string => !!id)
      )
    );
    const now = Timestamp.now();
    // eslint-disable-next-line @typescript-eslint/naming-convention
    const update_data = { splits, splitOutflowIds, updatedAt: now, updatedBy: user_id };
    await ref.update(update_data);

    record_audit_entry_async({
      user_id,
      action: "update",
      entity_type: "transaction",
      entity_id: doc_id,
      before: before as unknown as Record<string, unknown>,
      after: { ...before, ...update_data } as unknown as Record<string, unknown>,
      trace_id: ctx.trace_id,
      metadata: { source: "api", context: { manual_outflow_pin: true, outflow_id, detach } },
    });

    console.log(
      `[${ctx.trace_id}] pin_split_to_outflow: txn=${doc_id} split=${split_id} → ` +
        `outflow=${outflow_id ?? (detach ? "detached" : "cleared")}`
    );
    return create_write_result("transaction", doc_id, "merge", before, { ...before, ...update_data });
  },

  /**
   * Soft-deletes transactions by Plaid transaction IDs.
   *
   * @param ctx - Trace context
   * @param user_id - User ID for verification
   * @param plaid_transaction_ids - Plaid transaction IDs to soft-delete
   * @param reason - Reason for deletion
   * @returns Write results
   */
  async soft_delete_by_plaid_ids(
    ctx: TraceContext,
    user_id: string,
    plaid_transaction_ids: string[],
    reason: string,
    opts?: { run_id?: string; written?: SyncWrittenDoc[] }
  ): Promise<WriteResult[]> {
    if (plaid_transaction_ids.length === 0) {
      return [];
    }

    const db = getFirestore();
    const now = Timestamp.now();
    const results: WriteResult[] = [];

    // Query for all transactions by Plaid IDs. `in` accepts at most 30 values — the old
    // 500-id chunks made any page with >30 removals throw (removals silently never applied).
    const chunks = chunk_for_batch(plaid_transaction_ids, 30);

    for (const chunk of chunks) {
      const snapshot = await db
        .collection(COLLECTION)
        .where("transactionId", "in", chunk)
        .where("ownerId", "==", user_id)
        .get();

      if (snapshot.empty) continue;

      const batch = db.batch();

      for (const doc of snapshot.docs) {
        const before = doc.data() as LegacyTransactionDoc;

        /* eslint-disable @typescript-eslint/naming-convention */
        const update_data: Record<string, unknown> = {
          isActive: false,
          isDeleted: true,
          deletionReason: reason,
          updatedAt: now,
          ...(opts?.run_id ? { syncRunId: opts.run_id, lastWriteSource: "plaid_sync" } : {}),
        };
        /* eslint-enable @typescript-eslint/naming-convention */

        batch.update(doc.ref, update_data);
        opts?.written?.push({
          doc_id: doc.id,
          before: before as unknown as Record<string, unknown>,
          after: { ...before, ...update_data } as Record<string, unknown>,
        });

        results.push(
          create_write_result("transaction", doc.id, "merge", before, {
            ...before,
            ...update_data,
          })
        );

        // Audit entry
        record_audit_entry_async({
          user_id,
          action: "delete",
          entity_type: "transaction",
          entity_id: doc.id,
          before: before as unknown as Record<string, unknown>,
          after: { ...before, ...update_data } as unknown as Record<string, unknown>,
          trace_id: ctx.trace_id,
          metadata: { source: "api", context: { plaid_sync: true, reason } },
        });
      }

      await batch.commit();
    }

    console.log(
      `[${ctx.trace_id}] soft_delete_by_plaid_ids: deleted=${results.length}`
    );

    return results;
  },

  /**
   * Gets pending transactions for a Plaid item.
   *
   * Used by resolver to build the pending transaction lookup map
   * for pending->posted migration.
   *
   * @param ctx - Trace context
   * @param user_id - User ID
   * @param plaid_item_id - Plaid item ID
   * @returns Map of plaid_transaction_id -> PendingTransactionInfo
   */
  async get_pending_transactions_for_item(
    ctx: TraceContext,
    user_id: string,
    plaid_item_id: string
  ): Promise<Map<string, PendingTransactionInfo>> {
    const db = getFirestore();

    // Recently removed-by-Plaid-sync pendings only, within a window covering the
    // pending lifecycle (Plaid posts 1–5 business days out).
    const REMOVED_WINDOW_MS = 12 * 24 * 60 * 60 * 1000;
    const cutoff_ms = Date.now() - REMOVED_WINDOW_MS;

    // ACTIVE pendings — the common (same-sync) case. PLUS recently REMOVED-BY-SYNC
    // pendings — so a posted arriving in a LATER sync (after Plaid already removed the
    // pending) can STILL inherit the user's splits. The removed query is bounded by
    // `updatedAt >= cutoff` (Read-Cost-Review-Round-3 Q5): it used to read EVERY soft-deleted
    // pending the item ever had, then drop all but the last 12 days in memory — same result,
    // now without reading the old ones. Index: ownerId+plaidItemId+isPending+isActive+updatedAt.
    const [active_snap, removed_snap] = await Promise.all([
      db
        .collection(COLLECTION)
        .where("ownerId", "==", user_id)
        .where("plaidItemId", "==", plaid_item_id)
        .where("isPending", "==", true)
        .where("isActive", "==", true)
        .get(),
      db
        .collection(COLLECTION)
        .where("ownerId", "==", user_id)
        .where("plaidItemId", "==", plaid_item_id)
        .where("isPending", "==", true)
        .where("isActive", "==", false)
        .where("updatedAt", ">=", Timestamp.fromMillis(cutoff_ms))
        .get(),
    ]);

    const result = new Map<string, PendingTransactionInfo>();

    for (const doc of active_snap.docs) {
      const data = doc.data() as LegacyTransactionDoc;
      result.set(data.transactionId, map_to_pending_info(data));
    }

    // Don't overwrite an active. (The cutoff re-check below is now redundant with the
    // query bound but kept as a guard.)
    let removed_recent = 0;
    for (const doc of removed_snap.docs) {
      const data = doc.data() as LegacyTransactionDoc & {
        isDeleted?: boolean;
        deletionReason?: string;
        updatedAt?: { toMillis?: () => number };
      };
      const removed_by_sync =
        data.isDeleted === true &&
        typeof data.deletionReason === "string" &&
        data.deletionReason.toLowerCase().includes("removed by plaid");
      const updated_ms = data.updatedAt?.toMillis?.() ?? 0;
      if (!removed_by_sync || updated_ms < cutoff_ms) continue;
      if (result.has(data.transactionId)) continue; // an active pending wins
      result.set(data.transactionId, map_to_pending_info(data));
      removed_recent++;
    }

    console.log(
      `[${ctx.trace_id}] get_pending_transactions_for_item: found=${result.size} ` +
        `(active=${active_snap.size}, removed-recent=${removed_recent})`
    );

    return result;
  },

  /**
   * Gets a transaction by Plaid transaction ID.
   *
   * @param ctx - Trace context
   * @param user_id - User ID for scoping
   * @param plaid_transaction_id - Plaid transaction ID
   * @returns Transaction info or null if not found
   */
  async get_by_plaid_transaction_id(
    ctx: TraceContext,
    user_id: string,
    plaid_transaction_id: string
  ): Promise<{ doc_id: string; created_at: Timestamp } | null> {
    const db = getFirestore();

    const snapshot = await db
      .collection(COLLECTION)
      .where("transactionId", "==", plaid_transaction_id)
      .where("ownerId", "==", user_id)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return null;
    }

    const doc = snapshot.docs[0];
    const data = doc.data() as LegacyTransactionDoc;

    return {
      doc_id: doc.id,
      created_at: data.createdAt,
    };
  },

  /**
   * Gets transaction by document ID.
   *
   * @param ctx - Trace context
   * @param doc_id - Document ID
   * @returns Transaction document or null
   */
  async get_by_id(
    ctx: TraceContext,
    doc_id: string
  ): Promise<LegacyTransactionDoc | null> {
    const doc = await doc_ref(doc_id).get();

    if (!doc.exists) {
      return null;
    }

    return doc.data() as LegacyTransactionDoc;
  },

  /**
   * Bulk-reads the FULL active transaction docs for a set of ids via chunked `getAll` (≤300/call).
   * Used by the batch assignment path to read each txn ONCE — instead of a per-transaction
   * `get_raw_by_id` inside `resolve_assignment_context` (N single-doc reads per sync). The dates
   * come along for free (so the candidate-window probe is no longer a separate read). Missing /
   * inactive docs are skipped.
   */
  async get_raw_by_ids(
    _ctx: TraceContext,
    doc_ids: string[]
  ): Promise<Array<{ id: string; data: Record<string, unknown>; update_time?: Timestamp }>> {
    if (doc_ids.length === 0) {
      return [];
    }
    const db = getFirestore();
    const out: Array<{ id: string; data: Record<string, unknown>; update_time?: Timestamp }> = [];
    const CHUNK = 300; // Firestore getAll practical batch size
    for (let i = 0; i < doc_ids.length; i += CHUNK) {
      const refs = doc_ids.slice(i, i + CHUNK).map((id) => doc_ref(id));
      const snaps = await db.getAll(...refs);
      for (const snap of snaps) {
        if (!snap.exists) continue;
        const data = snap.data() as Record<string, unknown>;
        if (data.isActive === false) continue;
        out.push({ id: snap.id, data, update_time: snap.updateTime });
      }
    }
    return out;
  },

  /**
   * Writes the Transaction Assignment Engine's output: the updated splits array
   * (with the engine-owned assignment fields applied) plus the denormalized
   * `splitBudgetIds`. This is the engine's SINGLE write of split assignment.
   *
   * @param _ctx - Trace context
   * @param doc_id - Transaction document ID
   * @param updated_splits - The full splits array, with assignment fields applied
   * @param split_budget_ids - Distinct budget ids across the splits (queryable)
   * @param split_outflow_ids - Distinct recurring-outflow links (queryable)
   * @param split_inflow_ids - Distinct recurring-inflow links (queryable)
   */
  async apply_split_assignments(
    _ctx: TraceContext,
    doc_id: string,
    updated_splits: Array<Record<string, unknown>>,
    split_budget_ids: string[],
    split_outflow_ids: string[] = [],
    split_inflow_ids: string[] = [],
    /** The assignment run writing this — lets `on_transaction_written` skip the engine's own
     *  writes (the batch runs its own single follow-up instead of N re-entries). */
    assign_run_id?: string,
    /** Extra top-level fields written in the SAME update (e.g. the 3-0b legacy clear). */
    extra_fields?: Record<string, unknown>,
    /** The doc's update time when it was read: the write fails (returns false) if anything
     *  changed it since (a user edit, a sync) — never overwrite a newer write. */
    read_update_time?: Timestamp
  ): Promise<boolean> {
    /* eslint-disable @typescript-eslint/naming-convention */
    const data = {
      ...(extra_fields ?? {}),
      ...(assign_run_id ? { assignRunId: assign_run_id, lastWriteSource: "assignment" } : {}),
      splits: updated_splits,
      splitBudgetIds: split_budget_ids,
      // Queryable durable txn↔recurring links (array-contains) — power recurring
      // reconciliation without the stale Plaid stream transactionIds[].
      splitOutflowIds: split_outflow_ids,
      splitInflowIds: split_inflow_ids,
      updatedAt: Timestamp.now(),
    };
    /* eslint-enable @typescript-eslint/naming-convention */
    try {
      if (read_update_time) {
        await doc_ref(doc_id).update(data, { lastUpdateTime: read_update_time });
      } else {
        await doc_ref(doc_id).update(data);
      }
      return true;
    } catch (error) {
      // FAILED_PRECONDITION: the doc changed after we read it — its newer writer (an edit's
      // trigger, a sync's in-memory assignment) assigns it; skipping is the safe outcome.
      if ((error as { code?: number }).code === 9) return false;
      throw error;
    }
  },

  /**
   * Counts active transactions for a specific account.
   *
   * Used by resolvers to determine cascade scope for account removal.
   *
   * @param ctx - Trace context
   * @param account_id - Plaid account ID
   * @param user_id - User ID for scoping
   * @returns Count of active transactions for the account
   */
  async count_by_account_id(
    ctx: TraceContext,
    account_id: string,
    user_id: string
  ): Promise<number> {
    const db = getFirestore();

    const snapshot = await db
      .collection(COLLECTION)
      .where("accountId", "==", account_id)
      .where("ownerId", "==", user_id)
      .where("isActive", "==", true)
      .count()
      .get();

    const count = snapshot.data().count;

    console.log(
      `[${ctx.trace_id}] count_by_account_id: account=${account_id}, count=${count}`
    );

    return count;
  },

  /**
   * Gets transaction IDs for a specific account.
   *
   * Used by resolvers to get affected transaction IDs for cascade operations.
   * Returns only IDs to minimize memory usage.
   *
   * @param ctx - Trace context
   * @param account_id - Plaid account ID
   * @param user_id - User ID for scoping
   * @param limit - Maximum number of IDs to return (default 1000)
   * @param options - Read options. `include_deleted: true` drops the
   *   `isActive == true` filter so soft-deleted/hidden transactions are
   *   returned too (needed by the account-restore flow, which must find the
   *   transactions that account removal set to `isActive: false`).
   * @returns Array of transaction document IDs
   */
  async get_ids_by_account_id(
    ctx: TraceContext,
    account_id: string,
    user_id: string,
    limit: number = 1000,
    options?: ReadOptions
  ): Promise<string[]> {
    const db = getFirestore();

    let query = db
      .collection(COLLECTION)
      .where("accountId", "==", account_id)
      .where("ownerId", "==", user_id);

    if (!options?.include_deleted) {
      query = query.where("isActive", "==", true);
    }

    const snapshot = await query
      .select() // Select no fields, just get document IDs
      .limit(limit)
      .get();

    const ids = snapshot.docs.map(doc => doc.id);

    console.log(
      `[${ctx.trace_id}] get_ids_by_account_id: account=${account_id}, found=${ids.length}`
    );

    return ids;
  },

  /**
   * Hides up to 500 active transactions for a removed account (one page).
   * Inactive transactions drop out of every derived total. Idempotent. Returns
   * the count hidden and whether a full page came back (more may remain).
   */
  async hide_for_account(
    ctx: TraceContext,
    account_id: string,
    user_id: string
  ): Promise<{ hidden: number; has_more: boolean }> {
    const db = getFirestore();
    const now = Timestamp.now();
    const snapshot = await db
      .collection(COLLECTION)
      .where("accountId", "==", account_id)
      .where("ownerId", "==", user_id)
      .where("isActive", "==", true)
      .limit(500)
      .get();

    if (snapshot.empty) {
      return { hidden: 0, has_more: false };
    }

    let hidden = 0;
    const chunks = chunk_for_batch(snapshot.docs.map((d) => d.id));
    for (const chunk of chunks) {
      const batch = db.batch();
      for (const id of chunk) {
        /* eslint-disable @typescript-eslint/naming-convention */
        const update_data: Record<string, unknown> = {
          isActive: false,
          isHidden: true,
          hiddenAt: now,
          hiddenReason: "account_removed",
          updatedAt: now,
        };
        /* eslint-enable @typescript-eslint/naming-convention */
        batch.update(doc_ref(id), update_data);
        hidden++;
      }
      await batch.commit();
    }

    console.log(
      `[${ctx.trace_id}] hide_for_account: account=${account_id}, hidden=${hidden}`
    );
    return { hidden, has_more: snapshot.size === 500 };
  },

  /**
   * Restores up to 500 transactions that an account removal hid (one page) —
   * only `hiddenReason == "account_removed"`, so transactions soft-deleted for
   * other reasons (e.g. superseded pendings) stay deleted. Idempotent. Returns
   * the count restored and whether a full page came back (more may remain).
   */
  async restore_for_account(
    ctx: TraceContext,
    account_id: string,
    user_id: string
  ): Promise<{ restored: number; has_more: boolean }> {
    const db = getFirestore();
    const now = Timestamp.now();
    const snapshot = await db
      .collection(COLLECTION)
      .where("accountId", "==", account_id)
      .where("ownerId", "==", user_id)
      .where("isActive", "==", false)
      .where("hiddenReason", "==", "account_removed")
      .select()
      .limit(500)
      .get();

    if (snapshot.empty) {
      return { restored: 0, has_more: false };
    }

    let restored = 0;
    for (const chunk of chunk_for_batch(snapshot.docs.map((d) => d.id))) {
      const batch = db.batch();
      for (const id of chunk) {
        /* eslint-disable @typescript-eslint/naming-convention */
        batch.update(doc_ref(id), {
          isActive: true,
          isHidden: false,
          hiddenReason: null,
          hiddenAt: null,
          updatedAt: now,
        });
        /* eslint-enable @typescript-eslint/naming-convention */
        restored++;
      }
      await batch.commit();
    }

    console.log(
      `[${ctx.trace_id}] restore_for_account: account=${account_id}, restored=${restored}`
    );
    return { restored, has_more: snapshot.size === 500 };
  },

  /**
   * Batch-applies a fixed set of fields to the given transaction IDs (chunked).
   * Generic persistence helper — no business logic; the caller computes `fields`.
   * Returns the number of docs written.
   */
  async set_fields_by_ids(
    ctx: TraceContext,
    ids: string[],
    fields: Record<string, unknown>
  ): Promise<number> {
    if (ids.length === 0) {
      return 0;
    }
    const db = getFirestore();
    let written = 0;
    for (const chunk of chunk_for_batch(ids)) {
      const batch = db.batch();
      for (const id of chunk) {
        batch.update(doc_ref(id), fields);
        written++;
      }
      await batch.commit();
    }
    console.log(`[${ctx.trace_id}] set_fields_by_ids: written=${written}`);
    return written;
  },

  /**
   * Gets all active transaction IDs owned by a user.
   *
   * Queries by `userId` (the field the assignment engine + spend recompute use,
   * NOT `ownerId`) so the backfill's work-list matches exactly what
   * `recompute_budget_spent` will sum. Returns only IDs to bound memory.
   *
   * @param ctx - Trace context
   * @param user_id - User ID (matches the `userId` field)
   * @param limit - Optional hard cap on IDs returned. Omit (default) to return
   *   ALL active transaction IDs via pagination — required for full coverage.
   * @returns Array of transaction document IDs
   */
  async get_ids_by_user_id(
    ctx: TraceContext,
    user_id: string,
    limit?: number
  ): Promise<string[]> {
    const db = getFirestore();
    const PAGE = 5000;
    const ids: string[] = [];
    let cursor: string | undefined;

    // Paginate by document id (implicit __name__ order — no composite index) so
    // users with more than one page of transactions are FULLY covered. A fixed
    // cap here silently under-covers the backfill/re-assignment work-list, which
    // strands the tail of a large account (the bug that left 291 transfers in EE).
    for (;;) {
      let query = db
        .collection(COLLECTION)
        .where("userId", "==", user_id)
        .where("isActive", "==", true)
        .orderBy(FieldPath.documentId())
        .select() // Document IDs only
        .limit(PAGE);
      if (cursor) {
        query = query.startAfter(cursor);
      }
      const snapshot = await query.get();
      if (snapshot.empty) break;
      for (const doc of snapshot.docs) {
        ids.push(doc.id);
      }
      if (limit && ids.length >= limit) {
        return ids.slice(0, limit);
      }
      if (snapshot.size < PAGE) break; // last page
      cursor = snapshot.docs[snapshot.docs.length - 1].id;
    }

    console.log(
      `[${ctx.trace_id}] get_ids_by_user_id: user=${user_id}, found=${ids.length}`
    );

    return ids;
  },

  /**
   * Gets active transaction IDs whose `updatedAt` is STRICTLY AFTER `since_ms`, oldest first
   * (field-masked — ids only). Powers the debounced per-user batch assignment: a Plaid-sync burst
   * writes many txns → one batch job re-assigns just the recently-changed ones via
   * `assign_transactions_batch` (shared context + candidates resolved ONCE) instead of one
   * per-transaction job each re-reading every reference collection. `limit` caps a single pass;
   * the caller advances its watermark and re-runs if it hit the cap.
   *
   * Composite index: `transactions(userId, updatedAt)`.
   */
  async get_ids_updated_since(
    _ctx: TraceContext,
    user_id: string,
    since_ms: number,
    limit: number
  ): Promise<Array<{ id: string; updated_ms: number }>> {
    const snapshot = await getFirestore()
      .collection(COLLECTION)
      .where("userId", "==", user_id)
      .where("updatedAt", ">", Timestamp.fromMillis(since_ms))
      .orderBy("updatedAt", "asc")
      .select("updatedAt") // ids + the cursor field only
      .limit(limit)
      .get();
    return snapshot.docs.map((doc) => ({
      id: doc.id,
      updated_ms: (doc.get("updatedAt") as Timestamp).toMillis(),
    }));
  },

  /**
   * Gets active transaction IDs that have at least one split assigned to a
   * budget. Splits are nested maps, so this scans the user's active
   * transactions (by ownerId AND userId, deduped) and filters in memory.
   * Used by the delete cascade to re-run assignment on a deleted budget's txns.
   *
   * @param ctx - Trace context
   * @param user_id - User ID
   * @param budget_id - Budget whose referencing transactions to find
   */
  async get_ids_referencing_budget(
    ctx: TraceContext,
    user_id: string,
    budget_id: string
  ): Promise<string[]> {
    const db = getFirestore();
    // Filter to ONLY the txns that reference this budget, server-side, via the denormalized
    // `splitBudgetIds` union array (`array-contains`) — NOT a full-collection scan of the user's
    // active txns followed by an in-memory `includes()`. A heavy account has thousands of active
    // txns; the old scan read them all (billed per doc + OOM risk on the 256MiB delete fn), where
    // only a handful reference the deleted budget. Needs the composite index
    // (ownerId, isActive, splitBudgetIds CONTAINS). `.select()` projects to zero fields — we only
    // need the ids. `ownerId == userId` for every non-shared txn (both written from the same source
    // in map_to_doc); re-add a userId leg behind the RBAC-sharing flag if cross-owner txns exist.
    const owner_snap = await db
      .collection(COLLECTION)
      .where("ownerId", "==", user_id)
      .where("isActive", "==", true)
      .where("splitBudgetIds", "array-contains", budget_id)
      .select()
      .get();

    const ids = owner_snap.docs.map((doc) => doc.id);
    console.log(
      `[${ctx.trace_id}] get_ids_referencing_budget: budget=${budget_id}, found=${ids.length}`
    );
    return ids;
  },

  /**
   * Clears the Rules Engine review flags on a transaction (the "Needs review" queue action).
   * `updatedAt` is bumped; nothing assignment/spend-relevant changes so the write is cheap.
   */
  async clear_review_flags(_ctx: TraceContext, doc_id: string): Promise<void> {
    /* eslint-disable @typescript-eslint/naming-convention */
    await doc_ref(doc_id).update({
      needsReview: false,
      needsNote: false,
      updatedAt: Timestamp.now(),
    });
    /* eslint-enable @typescript-eslint/naming-convention */
  },

  /**
   * Gets one transaction's raw doc data + id, or null if missing/inactive.
   * Returns the raw camelCase map so the assignment resolver can read-modify-
   * write nested splits onto it.
   */
  async get_raw_by_id(
    _ctx: TraceContext,
    transaction_id: string
  ): Promise<{ id: string; data: Record<string, unknown> } | null> {
    const doc = await getFirestore()
      .collection(COLLECTION)
      .doc(transaction_id)
      .get();
    if (!doc.exists) {
      return null;
    }
    const data = doc.data() as Record<string, unknown>;
    if (data.isActive === false) {
      return null;
    }
    return { id: doc.id, data };
  },

  /**
   * Gets active transactions (raw doc data + id) whose `transactionDate` falls
   * in [start_ms, end_ms]. Returns raw maps so callers (spend / re-home
   * resolvers) can map nested splits themselves.
   *
   * Composite index: `transactions(userId, transactionDate)`.
   */
  async get_active_in_date_range(
    _ctx: TraceContext,
    user_id: string,
    start_ms: number,
    end_ms: number
  ): Promise<Array<{ id: string; data: Record<string, unknown> }>> {
    const db = getFirestore();
    const snapshot = await db
      .collection(COLLECTION)
      .where("userId", "==", user_id)
      .where("transactionDate", ">=", Timestamp.fromMillis(start_ms))
      .where("transactionDate", "<=", Timestamp.fromMillis(end_ms))
      .get();
    return snapshot.docs
      .map((doc) => ({ id: doc.id, data: doc.data() as Record<string, unknown> }))
      .filter((t) => t.data.isActive !== false);
  },

  /**
   * Store each transaction's transfer role (3d — internal / edge_out / edge_in / external), only
   * for the ones that changed. A role change is an assignment input (field guard), so the
   * debounced per-user assignment batch re-assigns exactly those.
   */
  async set_transfer_roles(
    _ctx: TraceContext,
    roles: Map<string, string>,
    /** Stamped (assignRunId) — the caller re-assigns these itself; the trigger skips them. */
    run_id: string
  ): Promise<number> {
    const db = getFirestore();
    const entries = [...roles.entries()];
    for (let i = 0; i < entries.length; i += 450) {
      const batch = db.batch();
      for (const [id, role] of entries.slice(i, i + 450)) {
        /* eslint-disable @typescript-eslint/naming-convention */
        batch.update(doc_ref(id), {
          transferRole: role,
          assignRunId: run_id,
          lastWriteSource: "transfer_roles",
          updatedAt: Timestamp.now(),
        });
        /* eslint-enable @typescript-eslint/naming-convention */
      }
      await batch.commit();
    }
    return entries.length;
  },

  /**
   * One page of a user's transactions in DATE order (then doc id), starting after `cursor` —
   * the bounded re-assign engine's walk (3-R): each page's dates are contiguous, so its
   * recurring-candidate preload stays narrow. Inactive docs are dropped after the read (they still
   * advance the cursor via `last`).
   *
   * Composite index: `transactions(userId, transactionDate)` (doc id is the implicit tiebreak).
   */
  async get_page_by_date(
    _ctx: TraceContext,
    user_id: string,
    cursor: { date_ms: number; doc_id: string } | null,
    limit: number,
    scope: { from_ms?: number; to_ms?: number; account_ids?: string[] } = {}
  ): Promise<{
    docs: Array<{ id: string; data: Record<string, unknown>; update_time: Timestamp }>;
    last: { date_ms: number; doc_id: string } | null;
    exhausted: boolean;
  }> {
    let q = getFirestore()
      .collection(COLLECTION)
      .where("userId", "==", user_id)
      .orderBy("transactionDate", "asc")
      .orderBy(FieldPath.documentId(), "asc");
    // Account-scoped (a view change): query just those accounts — index
    // transactions(userId, accountId, transactionDate). Up to Firestore's 30 `in` values.
    if (scope.account_ids?.length && scope.account_ids.length <= 30) {
      q = q.where("accountId", "in", scope.account_ids);
    }
    if (scope.from_ms !== undefined) {
      q = q.where("transactionDate", ">=", Timestamp.fromMillis(scope.from_ms));
    }
    if (scope.to_ms !== undefined) {
      q = q.where("transactionDate", "<=", Timestamp.fromMillis(scope.to_ms));
    }
    if (cursor) {
      q = q.startAfter(Timestamp.fromMillis(cursor.date_ms), cursor.doc_id);
    }
    const snap = await q.limit(limit).get();
    const tail = snap.docs[snap.docs.length - 1];
    return {
      docs: snap.docs
        .map((d) => ({
          id: d.id,
          data: d.data() as Record<string, unknown>,
          update_time: d.updateTime,
        }))
        .filter((t) => t.data.isActive !== false),
      last: tail
        ? {
          date_ms: (tail.get("transactionDate") as Timestamp).toMillis(),
          doc_id: tail.id,
        }
        : cursor,
      exhausted: snap.docs.length < limit,
    };
  },

  /**
   * Sets a split's tags (or every split's tags when `split_id` is null — the whole-transaction
   * case) and recomputes the top-level `tagIds` union. `splits_raw` is the already-read raw splits
   * array from `get_raw_by_id`, so this costs one write (the caller did the read + owner check).
   */
  async write_split_tags(
    _ctx: TraceContext,
    doc_id: string,
    splits_raw: unknown,
    split_id: string | null,
    tag_ids: string[]
  ): Promise<void> {
    /* eslint-disable @typescript-eslint/naming-convention */
    const splits = Array.isArray(splits_raw)
      ? (splits_raw as Array<Record<string, unknown>>)
      : [];
    for (const s of splits) {
      if (split_id === null || s.splitId === split_id) {
        s.tags = tag_ids;
      }
    }
    const tagIds = Array.from(
      new Set(splits.flatMap((s) => (Array.isArray(s.tags) ? (s.tags as string[]) : [])))
    );
    await doc_ref(doc_id).update({ splits, tagIds, updatedAt: Timestamp.now() });
    /* eslint-enable @typescript-eslint/naming-convention */
  },

  /**
   * Removes `tag_id` from every split's `tags` and from the top-level `tagIds` on all of the
   * user's tagged transactions. Bounded batch (500-doc commits). Returns the count stripped.
   * Composite index: `transactions(userId, tagIds array-contains)`.
   */
  async strip_tag(
    _ctx: TraceContext,
    user_id: string,
    tag_id: string
  ): Promise<number> {
    /* eslint-disable @typescript-eslint/naming-convention */
    const db = getFirestore();
    const snapshot = await db
      .collection(COLLECTION)
      .where("userId", "==", user_id)
      .where("tagIds", "array-contains", tag_id)
      .get();
    let batch = db.batch();
    let pending = 0;
    let count = 0;
    for (const doc of snapshot.docs) {
      const data = doc.data() as Record<string, unknown>;
      const splits = Array.isArray(data.splits)
        ? (data.splits as Array<Record<string, unknown>>)
        : [];
      for (const s of splits) {
        if (Array.isArray(s.tags)) {
          s.tags = (s.tags as string[]).filter((t) => t !== tag_id);
        }
      }
      const tagIds = Array.from(
        new Set(splits.flatMap((s) => (Array.isArray(s.tags) ? (s.tags as string[]) : [])))
      );
      batch.update(doc.ref, { splits, tagIds, updatedAt: Timestamp.now() });
      pending++;
      count++;
      if (pending === 450) {
        await batch.commit();
        batch = db.batch();
        pending = 0;
      }
    }
    if (pending > 0) {
      await batch.commit();
    }
    return count;
    /* eslint-enable @typescript-eslint/naming-convention */
  },

  // (cursor writes belong to the plaid_items aggregate → plaid_item_repo.update_cursor)
};
