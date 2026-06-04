/**
 * Plaid Item Repository
 *
 * Handles persistence for Plaid item entities.
 * All writes are audited automatically.
 *
 * NOTE: This repository uses snake_case internally but maps to/from
 * the legacy camelCase Firestore documents for backwards compatibility.
 *
 * @module repositories/plaid/plaid_item
 */

import { getFirestore, Timestamp, FieldValue } from "firebase-admin/firestore";
import {
  TraceContext,
  WriteResult,
  create_write_result,
  PlaidItem,
  PlaidItemStatus,
} from "../../types";
import { TransientItemToRetry } from "../../types/plaid/transient_error_retry.types";
import { record_audit_entry_async } from "../../audit";

/**
 * Firestore collection name.
 */
const COLLECTION = "plaid_items";

/**
 * Gets the Firestore instance.
 */
function get_db() {
  return getFirestore();
}

/**
 * Gets a document reference.
 */
function doc_ref(id: string) {
  return get_db().collection(COLLECTION).doc(id);
}

/**
 * Legacy Firestore document structure (camelCase).
 * Used for reading/writing to maintain backwards compatibility.
 */
/* eslint-disable @typescript-eslint/naming-convention */
interface LegacyPlaidItemDoc {
  id: string;
  plaidItemId: string;
  userId: string;
  groupIds: string[];
  institutionId: string;
  institutionName: string;
  institutionLogo: string | null;
  accessToken: string;
  cursor: string | null;
  products: string[];
  status: PlaidItemStatus;
  error: string | null;
  lastWebhookReceived: Timestamp | null;
  lastSyncError?: string | null;
  lastSyncErrorAt?: Timestamp | null;
  lastSyncedAt?: Timestamp | null;
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
/* eslint-enable @typescript-eslint/naming-convention */

/**
 * Maps legacy Firestore document to PlaidItem entity.
 */
function map_to_entity(doc: LegacyPlaidItemDoc): PlaidItem {
  return {
    id: doc.id,
    plaid_item_id: doc.plaidItemId,
    user_id: doc.userId,
    group_ids: doc.groupIds ?? [],
    institution_id: doc.institutionId,
    institution_name: doc.institutionName,
    institution_logo: doc.institutionLogo,
    access_token: doc.accessToken,
    cursor: doc.cursor,
    products: doc.products ?? ["transactions"],
    status: doc.status,
    error: doc.error,
    last_webhook_received: doc.lastWebhookReceived,
    last_sync_error: doc.lastSyncError ?? null,
    last_sync_error_at: doc.lastSyncErrorAt ?? null,
    last_synced_at: doc.lastSyncedAt ?? null,
    is_active: doc.isActive,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  };
}

/**
 * Maps PlaidItem entity to legacy Firestore document.
 */
function map_to_doc(entity: PlaidItem): LegacyPlaidItemDoc {
  /* eslint-disable @typescript-eslint/naming-convention */
  return {
    id: entity.id,
    plaidItemId: entity.plaid_item_id,
    userId: entity.user_id,
    groupIds: entity.group_ids,
    institutionId: entity.institution_id,
    institutionName: entity.institution_name,
    institutionLogo: entity.institution_logo,
    accessToken: entity.access_token,
    cursor: entity.cursor,
    products: entity.products,
    status: entity.status,
    error: entity.error,
    lastWebhookReceived: entity.last_webhook_received,
    lastSyncError: entity.last_sync_error,
    lastSyncErrorAt: entity.last_sync_error_at,
    lastSyncedAt: entity.last_synced_at,
    isActive: entity.is_active,
    createdAt: entity.created_at,
    updatedAt: entity.updated_at,
  };
  /* eslint-enable @typescript-eslint/naming-convention */
}

/**
 * Plaid Item Repository
 *
 * Provides methods for CRUD operations on Plaid items.
 * All write operations automatically create audit entries.
 */
export const plaid_item_repo = {
  /**
   * Gets a Plaid item by ID.
   *
   * @param ctx - Trace context
   * @param id - Plaid item ID
   * @returns PlaidItem entity or null if not found
   */
  async get_by_id(ctx: TraceContext, id: string): Promise<PlaidItem | null> {
    const doc = await doc_ref(id).get();

    if (!doc.exists) {
      return null;
    }

    return map_to_entity(doc.data() as LegacyPlaidItemDoc);
  },

  /**
   * Gets all Plaid items for a user.
   *
   * @param ctx - Trace context
   * @param user_id - User ID
   * @param include_inactive - Include inactive items
   * @returns Array of PlaidItem entities
   */
  async get_by_user_id(
    ctx: TraceContext,
    user_id: string,
    include_inactive = false
  ): Promise<PlaidItem[]> {
    const db = get_db();
    let query = db.collection(COLLECTION).where("userId", "==", user_id);

    if (!include_inactive) {
      query = query.where("isActive", "==", true);
    }

    const snapshot = await query.get();
    return snapshot.docs.map((doc) =>
      map_to_entity(doc.data() as LegacyPlaidItemDoc)
    );
  },

  /**
   * Gets all ACTIVE items currently in one of the given (transient) statuses,
   * across all users. Used by the auto-retry scheduled job.
   *
   * Queries by `status in [...]` (single-field index — no composite index
   * needed) and filters `isActive` in memory.
   *
   * @param ctx - Trace context
   * @param statuses - Status values to match (max 10 for an `in` query)
   * @returns Lightweight rows describing items to retry
   */
  async get_in_transient_state(
    ctx: TraceContext,
    statuses: string[]
  ): Promise<TransientItemToRetry[]> {
    if (statuses.length === 0) {
      return [];
    }
    const db = get_db();
    const snapshot = await db
      .collection(COLLECTION)
      .where("status", "in", statuses)
      .get();

    const rows: TransientItemToRetry[] = [];
    for (const doc of snapshot.docs) {
      const legacy = doc.data() as LegacyPlaidItemDoc;
      const raw = doc.data() as Record<string, unknown>;
      if (raw.isActive === false) {
        continue;
      }
      rows.push({
        item_doc_id: doc.id,
        plaid_item_id: legacy.plaidItemId,
        user_id: legacy.userId,
        status: legacy.status,
        error_code: legacy.error ?? null,
        transient_since: (raw.transientSince as Timestamp | null) ?? null,
      });
    }
    return rows;
  },

  /**
   * Gets a Plaid item by user and institution.
   *
   * @param ctx - Trace context
   * @param user_id - User ID
   * @param institution_id - Institution ID
   * @returns PlaidItem entity or null if not found
   */
  async get_by_user_and_institution(
    ctx: TraceContext,
    user_id: string,
    institution_id: string
  ): Promise<PlaidItem | null> {
    const db = get_db();
    const snapshot = await db
      .collection(COLLECTION)
      .where("userId", "==", user_id)
      .where("institutionId", "==", institution_id)
      .where("isActive", "==", true)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return null;
    }

    return map_to_entity(snapshot.docs[0].data() as LegacyPlaidItemDoc);
  },

  /**
   * Saves a Plaid item (create or update).
   *
   * @param ctx - Trace context
   * @param entity - PlaidItem entity to save
   * @returns WriteResult
   */
  async save(ctx: TraceContext, entity: PlaidItem): Promise<WriteResult> {
    // Structural validation
    if (!entity.id) {
      throw new Error("Plaid item ID is required");
    }
    if (!entity.user_id) {
      throw new Error("User ID is required");
    }

    // Get before state for audit
    const before_doc = await doc_ref(entity.id).get();
    const before = before_doc.exists
      ? (before_doc.data() as LegacyPlaidItemDoc)
      : null;

    // Ensure updated_at is set
    const entity_to_save: PlaidItem = {
      ...entity,
      updated_at: Timestamp.now(),
    };

    // Convert to legacy format and save
    const doc_data = map_to_doc(entity_to_save);
    await doc_ref(entity.id).set(doc_data);

    // Create audit entry (async, non-blocking)
    record_audit_entry_async({
      user_id: entity.user_id,
      action: before ? "update" : "create",
      entity_type: "plaid_item",
      entity_id: entity.id,
      before: before as Record<string, unknown> | null,
      after: doc_data as unknown as Record<string, unknown>,
      trace_id: ctx.trace_id,
      metadata: { source: "api" },
    });

    return create_write_result(
      "plaid_item",
      entity.id,
      "replace",
      before,
      doc_data
    );
  },

  /**
   * Soft-deletes a Plaid item (sets isActive = false).
   *
   * @param ctx - Trace context
   * @param id - Plaid item ID
   * @param user_id - User performing the delete
   * @returns WriteResult
   */
  async soft_delete(
    ctx: TraceContext,
    id: string,
    user_id: string
  ): Promise<WriteResult> {
    const before_doc = await doc_ref(id).get();

    if (!before_doc.exists) {
      throw new Error(`Plaid item ${id} not found`);
    }

    const before = before_doc.data() as LegacyPlaidItemDoc;
    /* eslint-disable @typescript-eslint/naming-convention */
    const after: LegacyPlaidItemDoc = {
      ...before,
      isActive: false,
      updatedAt: Timestamp.now(),
    };
    /* eslint-enable @typescript-eslint/naming-convention */

    await doc_ref(id).set(after);

    // Audit entry (async)
    record_audit_entry_async({
      user_id,
      action: "delete",
      entity_type: "plaid_item",
      entity_id: id,
      before: before as unknown as Record<string, unknown>,
      after: after as unknown as Record<string, unknown>,
      trace_id: ctx.trace_id,
      metadata: { source: "api" },
    });

    return create_write_result("plaid_item", id, "replace", before, after);
  },

  /**
   * Updates the sync cursor for a Plaid item.
   *
   * @param ctx - Trace context
   * @param id - Plaid item ID
   * @param cursor - New cursor value
   */
  async update_cursor(
    ctx: TraceContext,
    id: string,
    cursor: string
  ): Promise<void> {
    /* eslint-disable @typescript-eslint/naming-convention */
    await doc_ref(id).update({
      cursor,
      lastSyncedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    /* eslint-enable @typescript-eslint/naming-convention */
  },

  /**
   * Updates the status of a Plaid item.
   *
   * @param ctx - Trace context
   * @param id - Plaid item ID
   * @param status - New status
   * @param error - Error message (if status indicates error)
   */
  async update_status(
    ctx: TraceContext,
    id: string,
    status: PlaidItemStatus,
    error: string | null = null
  ): Promise<void> {
    /* eslint-disable @typescript-eslint/naming-convention */
    await doc_ref(id).update({
      status,
      error,
      updatedAt: FieldValue.serverTimestamp(),
    });
    /* eslint-enable @typescript-eslint/naming-convention */
  },

  /**
   * Updates the last synced timestamp for a Plaid item.
   *
   * @param ctx - Trace context
   * @param id - Plaid item document ID
   */
  async update_last_synced_at(
    ctx: TraceContext,
    id: string
  ): Promise<void> {
    /* eslint-disable @typescript-eslint/naming-convention */
    await doc_ref(id).update({
      lastSyncedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    /* eslint-enable @typescript-eslint/naming-convention */

    console.log(`[${ctx.trace_id}] Updated lastSyncedAt for item ${id}`);
  },

  /**
   * Checks if a Plaid item exists.
   *
   * @param ctx - Trace context
   * @param id - Plaid item ID
   * @returns Whether the item exists
   */
  async exists(ctx: TraceContext, id: string): Promise<boolean> {
    const doc = await doc_ref(id).get();
    return doc.exists;
  },

  /**
   * Updates the last recurring sync timestamp for a Plaid item.
   *
   * This is separate from lastSyncedAt which tracks transaction sync.
   *
   * @param ctx - Trace context
   * @param id - Plaid item document ID
   */
  async update_last_recurring_sync_at(
    ctx: TraceContext,
    id: string
  ): Promise<void> {
    /* eslint-disable @typescript-eslint/naming-convention */
    await doc_ref(id).update({
      lastRecurringSyncAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    /* eslint-enable @typescript-eslint/naming-convention */

    console.log(`[${ctx.trace_id}] Updated lastRecurringSyncAt for item ${id}`);
  },
};
