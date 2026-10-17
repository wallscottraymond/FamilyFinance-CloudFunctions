/**
 * Recurring Sync Resolver
 *
 * Gathers dependencies for the recurring sync orchestrator.
 * - Fetches plaid_item and decrypts access token
 * - Gets user context (family, currency, groups)
 * - Fetches existing manual inflows/outflows for merge detection
 * - Identifies affected cashflow projections
 *
 * @module resolvers/plaid/recurring_sync
 */

import { getFirestore } from "firebase-admin/firestore";
import {
  TraceContext,
  DependencyResult,
  batch_dependencies,
} from "../../types";
import { decryptAccessToken } from "../../../utils/encryption";
import { inflow_repo, outflow_repo } from "../../repositories";
import { ExistingInflowData } from "../../domain/inflow.service";
import { ExistingOutflowData } from "../../domain/outflow.service";

// ============================================================================
// Types
// ============================================================================

/**
 * Input for recurring sync dependency resolution.
 */
export interface ResolveRecurringSyncInput {
  /** Plaid item document ID (our Firestore doc ID) */
  item_id: string;

  /** User ID */
  user_id: string;
}

/**
 * Plaid item data needed for recurring sync.
 */
export interface PlaidItemForRecurringSync {
  /** Our Firestore document ID */
  doc_id: string;

  /** Plaid's item ID */
  plaid_item_id: string;

  /** Decrypted access token */
  access_token: string;

  /** User who owns this item */
  user_id: string;

  /** Institution ID */
  institution_id: string;

  /** Institution name */
  institution_name: string;

  /** Last recurring sync timestamp */
  last_recurring_sync?: Date | null;
  /** The user has a "Not a bill" / delete memory the planner must honour (C). */
  review_memory?: boolean;
}

/**
 * User context for recurring sync.
 */
export interface RecurringSyncUserContext {
  /** Family ID (if user is in a family) */
  family_id: string | null;

  /** Default currency */
  currency: string;

  /** Group IDs for access control */
  group_ids: string[];
}

/**
 * Full dependencies for recurring sync orchestrator.
 */
export interface RecurringSyncDependencies {
  /** Plaid item data with decrypted token */
  plaid_item: PlaidItemForRecurringSync;

  /** User context */
  user_context: RecurringSyncUserContext;

  /** Existing manual inflows for merge detection */
  existing_manual_inflows: ExistingInflowData[];

  /** Existing manual outflows for merge detection */
  existing_manual_outflows: ExistingOutflowData[];

  /** Existing Plaid inflows for upsert logic */
  existing_plaid_inflow_ids: Set<string>;

  /** Existing Plaid outflows for upsert logic */
  existing_plaid_outflow_ids: Set<string>;

  /** Dependency analysis result */
  dependency_result: DependencyResult;

  /**
   * Plaid account IDs on this item that are still active. Streams on a removed
   * account are dropped, or the sync would re-create/re-activate bills and income
   * the account removal soft-deleted (same rule as the transaction sync).
   */
  active_account_ids: Set<string>;

  /** Plaid account id → account type (`depository` / `credit` / `loan` …) for this item's active
   *  accounts — the capture rules' income gate (X17). Same read as `active_account_ids`. */
  account_types: Map<string, string>;

  /**
   * The user's ACTIVE bills / income (already loaded above), as the capture planner needs them:
   * v2 stamp, Plaid's flag, answers, vendor, dates. Nothing extra is read for this.
   */
  active_records: CaptureRecordInfo[];
}

/** A stored bill / income as the capture planner sees it (a lookup shape, no logic). */
export interface CaptureRecordInfo {
  id: string;
  direction: "outflow" | "inflow";
  is_active: boolean;
  is_hidden: boolean;
  v2: boolean;
  plaid_is_active: boolean | null;
  plaid_inactive_ack_ms: number | null;
  merged_into_id: string | null;
  account_id: string;
  plaid_item_id: string;
  source: string;
  name: string;
  merchant_name: string | null;
  description: string | null;
  average_amount: number;
  frequency: string;
  plaid_status: string;
  plaid_detailed_category: string;
  first_date_ms: number;
  last_date_ms: number;
  removal_intervals: Array<{ from_ms: number; to_ms: number | null; mode: string }>;
  transaction_ids: string[];
  /** The user's own name for it (wins over Plaid's merchant / description in `name`). */
  custom_name?: string | null;
  // Convert-To-Recurring Phase 2 (absent on every record that predates it).
  vendor_key?: string | null;
  expected_amount_override?: number | null;
  user_frequency?: string | null;
  absorbed_streams?: import("../../domain/recurring/convert_recurring.service").AbsorbedStream[];
  absorbed_txn_ids?: string[];
}

// ============================================================================
// Resolver Function
// ============================================================================

const ms_of = (t: { toMillis?: () => number } | null | undefined): number =>
  (t && typeof t.toMillis === "function" ? t.toMillis() : 0);

/** Map a loaded outflow / inflow entity → the planner's lookup shape (no reads). */
export function to_capture_record_info(
  r: {
    id: string;
    is_active: boolean;
    is_hidden: boolean;
    capture_rules_version: number | null;
    plaid_is_active: boolean | null;
    plaid_inactive_ack_at_ms: number | null;
    merged_into_id: string | null;
    account_id: string;
    plaid_item_id: string;
    source: string;
    user_custom_name: string | null;
    description: string | null;
    average_amount: number;
    frequency: string;
    plaid_status: string;
    plaid_detailed_category: string;
    first_date: unknown;
    last_date: unknown;
    removal_intervals: Array<{ from_ms: number; to_ms: number | null; mode: string }>;
    transaction_ids: string[];
    vendor_key?: string | null;
    expected_amount_override?: number | null;
    user_frequency?: string | null;
    absorbed_streams?: import("../../domain/recurring/convert_recurring.service").AbsorbedStream[];
    absorbed_txn_ids?: string[];
  },
  direction: "outflow" | "inflow",
  merchant_name: string | null
): CaptureRecordInfo {
  return {
    id: r.id,
    direction,
    is_active: r.is_active,
    is_hidden: r.is_hidden === true,
    v2: r.capture_rules_version === 2,
    plaid_is_active: r.plaid_is_active,
    plaid_inactive_ack_ms: r.plaid_inactive_ack_at_ms,
    merged_into_id: r.merged_into_id,
    account_id: r.account_id,
    plaid_item_id: r.plaid_item_id,
    source: r.source,
    name: r.user_custom_name || merchant_name || r.description || (direction === "outflow" ? "Bill" : "Income"),
    merchant_name,
    description: r.description,
    average_amount: r.average_amount,
    frequency: r.frequency,
    plaid_status: r.plaid_status,
    plaid_detailed_category: r.plaid_detailed_category,
    first_date_ms: ms_of(r.first_date as { toMillis?: () => number }),
    last_date_ms: ms_of(r.last_date as { toMillis?: () => number }),
    removal_intervals: r.removal_intervals ?? [],
    transaction_ids: r.transaction_ids ?? [],
    custom_name: r.user_custom_name ?? null,
    ...(r.vendor_key ? { vendor_key: r.vendor_key } : {}),
    ...(r.expected_amount_override != null ? { expected_amount_override: r.expected_amount_override } : {}),
    ...(r.user_frequency ? { user_frequency: r.user_frequency } : {}),
    ...(r.absorbed_streams?.length ? { absorbed_streams: r.absorbed_streams } : {}),
    ...(r.absorbed_txn_ids?.length ? { absorbed_txn_ids: r.absorbed_txn_ids } : {}),
  };
}

/**
 * Resolves dependencies needed for the recurring sync orchestrator.
 *
 * This resolver:
 * 1. Fetches the plaid_item by doc ID
 * 2. Decrypts the access token
 * 3. Gets user context (family, currency, groups)
 * 4. Fetches existing inflows for merge detection
 * 5. Fetches existing outflows for merge detection
 * 6. Identifies affected cashflow projections
 *
 * @param ctx - Trace context
 * @param input - Recurring sync input
 * @returns Dependencies for the orchestrator, or null if not found
 */
export async function resolve_recurring_sync_dependencies(
  ctx: TraceContext,
  input: ResolveRecurringSyncInput
): Promise<RecurringSyncDependencies | null> {
  const db = getFirestore();

  // Step 1: Fetch plaid_item by document ID
  const item_doc = await db.collection("plaid_items").doc(input.item_id).get();

  if (!item_doc.exists) {
    console.error(
      `[${ctx.trace_id}] Plaid item not found: ${input.item_id}`
    );
    return null;
  }

  const item_data = item_doc.data()!;

  // Verify user ownership
  if (item_data.userId !== input.user_id) {
    console.error(
      `[${ctx.trace_id}] User ${input.user_id} does not own item ${input.item_id}`
    );
    return null;
  }

  // Check if item is active
  if (!item_data.isActive) {
    console.error(
      `[${ctx.trace_id}] Plaid item ${input.item_id} is not active`
    );
    return null;
  }

  // Step 2: Decrypt access token
  const encrypted_token = item_data.accessToken;

  if (!encrypted_token) {
    console.error(
      `[${ctx.trace_id}] Plaid item ${input.item_id} has no access token`
    );
    return null;
  }

  let access_token: string;
  try {
    access_token = decryptAccessToken(encrypted_token);
  } catch (error) {
    console.error(
      `[${ctx.trace_id}] Failed to decrypt access token for item ${input.item_id}:`,
      error
    );
    return null;
  }

  // Step 3: Get user context
  const user_context = await resolve_user_context(db, input.user_id);

  // Step 4: Fetch existing inflows for this user
  const all_inflows = await inflow_repo.get_by_user_id(ctx, input.user_id, {
    include_deleted: false,
  });

  // Separate manual and Plaid inflows
  const existing_manual_inflows: ExistingInflowData[] = [];
  const existing_plaid_inflow_ids = new Set<string>();

  for (const inflow of all_inflows) {
    if (inflow.source === "manual") {
      existing_manual_inflows.push({
        id: inflow.id,
        payer_name: inflow.payer_name,
        description: inflow.description,
        average_amount: inflow.average_amount,
        frequency: inflow.frequency,
        source: inflow.source,
        is_active: inflow.is_active,
        plaid_stream_id: inflow.plaid_stream_id,
      });
    } else if (inflow.plaid_item_id === item_data.plaidItemId) {
      // STALE-CANDIDATE SET IS ITEM-SCOPED. Only Plaid inflows belonging to the
      // item being synced can go stale — otherwise syncing one item marks every
      // OTHER item's recurring stale (the multi-item data-loss bug). Inflows from
      // other items (or with no item id) are intentionally NOT candidates.
      existing_plaid_inflow_ids.add(inflow.id);
    }
  }

  // Step 5: Fetch existing outflows for this user
  const all_outflows = await outflow_repo.get_by_user_id(ctx, input.user_id, {
    include_deleted: false,
  });

  // Separate manual and Plaid outflows
  const existing_manual_outflows: ExistingOutflowData[] = [];
  const existing_plaid_outflow_ids = new Set<string>();

  for (const outflow of all_outflows) {
    if (outflow.source === "manual") {
      existing_manual_outflows.push({
        id: outflow.id,
        merchant_name: outflow.merchant_name,
        description: outflow.description,
        average_amount: outflow.average_amount,
        frequency: outflow.frequency,
        source: outflow.source,
        is_active: outflow.is_active,
        plaid_stream_id: outflow.plaid_stream_id,
      });
    } else if (outflow.plaid_item_id === item_data.plaidItemId) {
      // Item-scoped stale candidates (see the inflow loop above): only THIS item's
      // Plaid outflows can be marked stale by this sync.
      existing_plaid_outflow_ids.add(outflow.id);
    }
  }

  // Step 5b: Active accounts on this item (removed accounts' streams are dropped)
  const accounts_snapshot = await db.collection("accounts")
    .where("itemId", "==", item_data.plaidItemId)
    .where("isActive", "==", true)
    .get();
  const active_account_ids = new Set<string>(
    accounts_snapshot.docs.map((doc) => doc.data().accountId || doc.id)
  );
  const account_types = new Map<string, string>(
    accounts_snapshot.docs.map((doc) => [
      doc.data().accountId || doc.id,
      String(doc.data().accountType ?? doc.data().type ?? ""),
    ])
  );
  const active_records: CaptureRecordInfo[] = [
    ...all_outflows.map((o) => to_capture_record_info(o, "outflow", o.merchant_name)),
    ...all_inflows.map((i) => to_capture_record_info(i, "inflow", i.payer_name)),
  ];

  // Step 6: Identify affected cashflow projections
  const dependency_result = await resolve_affected_cashflow_projections(
    db,
    input.user_id,
    user_context.family_id
  );

  console.log(
    `[${ctx.trace_id}] Resolved recurring sync dependencies: ` +
    `item=${input.item_id}, ` +
    `manual_inflows=${existing_manual_inflows.length}, ` +
    `manual_outflows=${existing_manual_outflows.length}, ` +
    `plaid_inflows=${existing_plaid_inflow_ids.size}, ` +
    `plaid_outflows=${existing_plaid_outflow_ids.size}, ` +
    `affected_projections=${dependency_result.affected_entities.length}`
  );

  return {
    plaid_item: {
      doc_id: item_doc.id,
      plaid_item_id: item_data.plaidItemId,
      access_token,
      user_id: input.user_id,
      institution_id: item_data.institutionId || "",
      institution_name: item_data.institutionName || "Unknown Institution",
      last_recurring_sync: item_data.lastRecurringSyncAt?.toDate() || null,
      review_memory: (item_data as { reviewMemory?: boolean }).reviewMemory === true,
    },
    user_context,
    existing_manual_inflows,
    existing_manual_outflows,
    existing_plaid_inflow_ids,
    existing_plaid_outflow_ids,
    dependency_result,
    active_account_ids,
    account_types,
    active_records,
  };
}

/**
 * Resolves dependencies for webhook-triggered recurring sync.
 *
 * Looks up item by Plaid item ID instead of doc ID.
 *
 * @param ctx - Trace context
 * @param plaid_item_id - Plaid item ID (from webhook)
 * @returns Dependencies for the orchestrator, or null if item not found
 */
export async function resolve_webhook_recurring_sync_dependencies(
  ctx: TraceContext,
  plaid_item_id: string
): Promise<RecurringSyncDependencies | null> {
  const db = getFirestore();

  // Find item by Plaid item ID
  const items_snapshot = await db.collection("plaid_items")
    .where("plaidItemId", "==", plaid_item_id)
    .where("isActive", "==", true)
    .limit(1)
    .get();

  if (items_snapshot.empty) {
    console.error(
      `[${ctx.trace_id}] No active plaid_item found for Plaid ID: ${plaid_item_id}`
    );
    return null;
  }

  const item_doc = items_snapshot.docs[0];
  const item_data = item_doc.data();
  const user_id = item_data.userId;

  // Use the standard resolver with doc ID
  return resolve_recurring_sync_dependencies(ctx, {
    item_id: item_doc.id,
    user_id,
  });
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Resolves user context for recurring sync.
 */
async function resolve_user_context(
  db: FirebaseFirestore.Firestore,
  user_id: string
): Promise<RecurringSyncUserContext> {
  let family_id: string | null = null;
  let currency = "USD";
  // Accounts start private (Account-Rooted-Sharing P1): sharing comes from an
  // account's placement, never from stamping the user's groups onto synced data.
  const group_ids: string[] = [];

  const user_doc = await db.collection("users").doc(user_id).get();

  if (user_doc.exists) {
    const user_data = user_doc.data()!;
    family_id = user_data.familyId || null;

    // Get family settings for currency
    if (family_id) {
      const family_doc = await db.collection("families").doc(family_id).get();
      if (family_doc.exists) {
        const family_data = family_doc.data()!;
        currency = family_data.settings?.currency || "USD";
      }
    }
  }

  return {
    family_id,
    currency,
    group_ids,
  };
}

/**
 * Identifies cashflow projections that will be affected by recurring sync.
 *
 * When recurring items change, cashflow projections need recalculation.
 */
async function resolve_affected_cashflow_projections(
  _db: FirebaseFirestore.Firestore,
  user_id: string,
  _family_id: string | null
): Promise<DependencyResult> {
  // `cashflow_projections` was never built (a planned derived node) — the old per-sync queries here
  // (user + family) ALWAYS returned 0 docs = pure wasted reads on every recurring sync. The only
  // real dependency is the user_summary marker.
  return batch_dependencies([`user_summary:${user_id}`], "medium");
}

/**
 * Resolves merge suggestions for new recurring items.
 *
 * This is a convenience function that combines the resolver data
 * with domain service functions for merge detection.
 */
export function has_potential_merges(
  dependencies: RecurringSyncDependencies
): boolean {
  return (
    dependencies.existing_manual_inflows.length > 0 ||
    dependencies.existing_manual_outflows.length > 0
  );
}

/**
 * Gets IDs of items that need stale detection.
 *
 * Stale detection: If a Plaid stream was previously synced but is no longer
 * returned by Plaid, it may have ended and should be marked inactive.
 */
export function get_stale_candidates(
  dependencies: RecurringSyncDependencies,
  current_plaid_inflow_ids: string[],
  current_plaid_outflow_ids: string[]
): {
  stale_inflow_ids: string[];
  stale_outflow_ids: string[];
} {
  // Inflows that were previously synced but not in current response
  const stale_inflow_ids = Array.from(dependencies.existing_plaid_inflow_ids)
    .filter(id => !current_plaid_inflow_ids.includes(id));

  // Outflows that were previously synced but not in current response
  const stale_outflow_ids = Array.from(dependencies.existing_plaid_outflow_ids)
    .filter(id => !current_plaid_outflow_ids.includes(id));

  return {
    stale_inflow_ids,
    stale_outflow_ids,
  };
}
