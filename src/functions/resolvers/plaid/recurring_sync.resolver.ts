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
  no_dependencies,
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
}

// ============================================================================
// Resolver Function
// ============================================================================

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
  const user_context = await resolve_user_context(db, input.user_id, item_data.groupIds || []);

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
    } else {
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
    } else {
      existing_plaid_outflow_ids.add(outflow.id);
    }
  }

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
    },
    user_context,
    existing_manual_inflows,
    existing_manual_outflows,
    existing_plaid_inflow_ids,
    existing_plaid_outflow_ids,
    dependency_result,
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
  user_id: string,
  item_group_ids: string[]
): Promise<RecurringSyncUserContext> {
  let family_id: string | null = null;
  let currency = "USD";
  let group_ids: string[] = [...item_group_ids];

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

        // Add family group to group_ids if not already present
        if (!group_ids.includes(family_id)) {
          group_ids = [...group_ids, family_id];
        }
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
  db: FirebaseFirestore.Firestore,
  user_id: string,
  family_id: string | null
): Promise<DependencyResult> {
  // Find cashflow projections for this user/family
  const affected_ids: string[] = [];

  // User's personal cashflow projections
  const user_projections = await db.collection("cashflow_projections")
    .where("userId", "==", user_id)
    .where("isActive", "==", true)
    .get();

  user_projections.docs.forEach(doc => {
    affected_ids.push(doc.id);
  });

  // Family cashflow projections (if in a family)
  if (family_id) {
    const family_projections = await db.collection("cashflow_projections")
      .where("familyId", "==", family_id)
      .where("isActive", "==", true)
      .get();

    family_projections.docs.forEach(doc => {
      if (!affected_ids.includes(doc.id)) {
        affected_ids.push(doc.id);
      }
    });
  }

  // Also mark user_summary as affected (for monthly totals)
  affected_ids.push(`user_summary:${user_id}`);

  if (affected_ids.length === 0) {
    return no_dependencies();
  }

  return batch_dependencies(affected_ids, "medium");
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
