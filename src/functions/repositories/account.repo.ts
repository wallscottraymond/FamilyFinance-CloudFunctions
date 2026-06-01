/**
 * Account Repository
 *
 * Handles persistence for account entities.
 * All writes are audited automatically.
 *
 * NOTE: This repository uses snake_case internally but maps to/from
 * the legacy camelCase Firestore documents for backwards compatibility.
 *
 * @module repositories/account
 */

import { getFirestore, Timestamp } from "firebase-admin/firestore";
import {
  WriteResult,
  BatchWriteResult,
  ReadOptions,
  BaseEntity,
  AccessMetadata,
  create_write_result,
  chunk_for_batch,
  TraceContext,
} from "../types";
import { ClientAccountData } from "../types/plaid";
import { record_audit_entry_async } from "../audit";

/**
 * Firestore collection name.
 */
const COLLECTION = "accounts";

/**
 * Account entity in snake_case (new architecture).
 */
export interface Account extends BaseEntity {
  /** Plaid account ID */
  account_id: string;

  /** Reference to plaid_items */
  item_id: string;

  /** Account name from institution */
  name: string;

  /** Account number mask (e.g., "0000") */
  mask?: string;

  /** Official name from institution */
  official_name?: string;

  /** Account type (depository, credit, loan, investment, other) */
  account_type: string;

  /** Account subtype (checking, savings, credit_card, etc.) */
  account_subtype: string;

  /** Balance information */
  balances: {
    current: number;
    available?: number;
    limit?: number;
    iso_currency_code?: string;
    last_updated: Timestamp;
  };

  /** Institution information */
  institution: {
    id: string;
    name: string;
    logo?: string;
  };

  /** Sync settings */
  is_sync_enabled: boolean;
  last_synced_at?: Timestamp;

  /** Access control metadata */
  access: AccessMetadata;
}

/**
 * Legacy Firestore document structure (camelCase).
 * Used for reading/writing to maintain backwards compatibility.
 *
 * NOTE: camelCase is intentional - this interfaces with existing Firestore documents.
 */
/* eslint-disable @typescript-eslint/naming-convention */
interface LegacyAccountDoc {
  id: string;
  userId: string;
  groupIds?: string[];
  isActive: boolean;
  isDeleted?: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  accountId: string;
  plaidAccountId?: string; // Mobile app expects this field for transaction filtering
  itemId: string;
  name?: string;
  accountName?: string;
  mask?: string;
  officialName?: string;
  accountType: string;
  accountSubtype: string;
  currentBalance: number;
  availableBalance?: number;
  limit?: number;
  isoCurrencyCode?: string;
  lastBalanceUpdate?: Timestamp;
  institutionId: string;
  institutionName: string;
  isSyncEnabled?: boolean;
  lastSyncedAt?: Timestamp;
  access?: {
    ownerId: string;
    createdBy: string;
    groupIds: string[];
    isPrivate: boolean;
  };
}

/**
 * Maps legacy Firestore document to Account entity.
 */
function map_to_entity(doc: LegacyAccountDoc): Account {
  return {
    id: doc.id,
    user_id: doc.userId,
    group_ids: doc.groupIds ?? [],
    is_active: doc.isActive,
    is_deleted: doc.isDeleted,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
    account_id: doc.accountId,
    item_id: doc.itemId,
    name: doc.name ?? doc.accountName ?? "",
    mask: doc.mask,
    official_name: doc.officialName,
    account_type: doc.accountType,
    account_subtype: doc.accountSubtype,
    balances: {
      current: doc.currentBalance,
      available: doc.availableBalance,
      limit: doc.limit,
      iso_currency_code: doc.isoCurrencyCode,
      last_updated: doc.lastBalanceUpdate ?? doc.updatedAt,
    },
    institution: {
      id: doc.institutionId,
      name: doc.institutionName,
    },
    is_sync_enabled: doc.isSyncEnabled ?? true,
    last_synced_at: doc.lastSyncedAt,
    access: doc.access
      ? {
        owner_id: doc.access.ownerId,
        created_by: doc.access.createdBy,
        group_ids: doc.access.groupIds,
        is_private: doc.access.isPrivate,
      }
      : {
        owner_id: doc.userId,
        created_by: doc.userId,
        group_ids: doc.groupIds ?? [],
        is_private: (doc.groupIds ?? []).length === 0,
      },
  };
}

/**
 * Maps Account entity to legacy Firestore document.
 */
function map_to_doc(entity: Account): LegacyAccountDoc {
  return {
    id: entity.id,
    userId: entity.user_id,
    groupIds: entity.group_ids,
    isActive: entity.is_active,
    isDeleted: entity.is_deleted,
    createdAt: entity.created_at,
    updatedAt: entity.updated_at,
    accountId: entity.account_id,
    itemId: entity.item_id,
    name: entity.name,
    accountName: entity.name,
    mask: entity.mask,
    officialName: entity.official_name,
    accountType: entity.account_type,
    accountSubtype: entity.account_subtype,
    currentBalance: entity.balances.current,
    availableBalance: entity.balances.available,
    limit: entity.balances.limit,
    isoCurrencyCode: entity.balances.iso_currency_code,
    lastBalanceUpdate: entity.balances.last_updated,
    institutionId: entity.institution.id,
    institutionName: entity.institution.name,
    isSyncEnabled: entity.is_sync_enabled,
    lastSyncedAt: entity.last_synced_at,
    access: {
      ownerId: entity.access.owner_id,
      createdBy: entity.access.created_by,
      groupIds: entity.access.group_ids,
      isPrivate: entity.access.is_private,
    },
  };
}
/* eslint-enable @typescript-eslint/naming-convention */

/**
 * Gets Firestore document reference.
 */
function doc_ref(id: string): FirebaseFirestore.DocumentReference {
  return getFirestore().collection(COLLECTION).doc(id);
}

/**
 * Account Repository
 *
 * All write operations automatically create audit entries.
 */
export const account_repo = {
  /**
   * Gets an account by ID.
   *
   * @param _ctx - Trace context (for future observability)
   * @param id - Account ID
   * @param options - Read options
   * @returns Account entity or null if not found
   */
  async get_by_id(
    _ctx: TraceContext,
    id: string,
    options?: ReadOptions
  ): Promise<Account | null> {
    const doc = await doc_ref(id).get();

    if (!doc.exists) {
      return null;
    }

    const data = doc.data() as LegacyAccountDoc;

    // Filter deleted unless requested
    if (data.isDeleted && !options?.include_deleted) {
      return null;
    }

    return map_to_entity(data);
  },

  /**
   * Gets all accounts for a user.
   *
   * @param _ctx - Trace context
   * @param user_id - User ID
   * @param options - Read options
   * @returns Array of account entities
   */
  async get_by_user_id(
    _ctx: TraceContext,
    user_id: string,
    options?: ReadOptions
  ): Promise<Account[]> {
    const db = getFirestore();
    let query = db.collection(COLLECTION).where("userId", "==", user_id);

    // Filter deleted unless requested
    if (!options?.include_deleted) {
      query = query.where("isActive", "==", true);
    }

    if (options?.order_by) {
      query = query.orderBy(options.order_by, options.order_direction ?? "asc");
    }

    if (options?.limit) {
      query = query.limit(options.limit);
    }

    const snapshot = await query.get();
    return snapshot.docs.map((doc) => map_to_entity(doc.data() as LegacyAccountDoc));
  },

  /**
   * Gets accounts by item ID (all accounts linked to a Plaid item).
   *
   * @param _ctx - Trace context
   * @param item_id - Plaid item ID
   * @param options - Read options
   * @returns Array of account entities
   */
  async get_by_item_id(
    _ctx: TraceContext,
    item_id: string,
    options?: ReadOptions
  ): Promise<Account[]> {
    const db = getFirestore();
    let query = db.collection(COLLECTION).where("itemId", "==", item_id);

    if (!options?.include_deleted) {
      query = query.where("isActive", "==", true);
    }

    const snapshot = await query.get();
    return snapshot.docs.map((doc) => map_to_entity(doc.data() as LegacyAccountDoc));
  },

  /**
   * Saves an account (create or update).
   *
   * @param ctx - Trace context
   * @param entity - Account entity to save
   * @returns Write result
   */
  async save(ctx: TraceContext, entity: Account): Promise<WriteResult> {
    // Structural validation
    if (!entity.id) {
      throw new Error("Account ID is required");
    }
    if (!entity.user_id) {
      throw new Error("User ID is required");
    }

    // Get before state for audit
    const before_doc = await doc_ref(entity.id).get();
    const before = before_doc.exists ? (before_doc.data() as LegacyAccountDoc) : null;

    // Ensure updated_at is set
    const entity_to_save: Account = {
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
      entity_type: "account",
      entity_id: entity.id,
      before: before as Record<string, unknown> | null,
      after: doc_data as unknown as Record<string, unknown>,
      trace_id: ctx.trace_id,
      metadata: { source: "api" },
    });

    return create_write_result(
      "account",
      entity.id,
      "replace",
      before,
      doc_data
    );
  },

  /**
   * Saves multiple accounts in a batch.
   *
   * @param ctx - Trace context
   * @param entities - Account entities to save
   * @returns Batch write result
   */
  async save_batch(
    ctx: TraceContext,
    entities: Account[]
  ): Promise<BatchWriteResult> {
    if (entities.length === 0) {
      return { results: [], count: 0, success: true };
    }

    const db = getFirestore();
    const results: WriteResult[] = [];
    const chunks = chunk_for_batch(entities);

    for (const chunk of chunks) {
      const batch = db.batch();
      const before_states: Map<string, LegacyAccountDoc | null> = new Map();

      // Get before states and prepare batch
      for (const entity of chunk) {
        if (!entity.id) {
          throw new Error("Account ID is required");
        }

        const before_doc = await doc_ref(entity.id).get();
        const before = before_doc.exists ? (before_doc.data() as LegacyAccountDoc) : null;
        before_states.set(entity.id, before);

        const entity_to_save: Account = {
          ...entity,
          updated_at: Timestamp.now(),
        };
        const doc_data = map_to_doc(entity_to_save);
        batch.set(doc_ref(entity.id), doc_data);

        results.push(create_write_result(
          "account",
          entity.id,
          "replace",
          before,
          doc_data
        ));

        // Audit entry (async)
        record_audit_entry_async({
          user_id: entity.user_id,
          action: before ? "update" : "create",
          entity_type: "account",
          entity_id: entity.id,
          before: before as Record<string, unknown> | null,
          after: doc_data as unknown as Record<string, unknown>,
          trace_id: ctx.trace_id,
          metadata: { source: "api" },
        });
      }

      await batch.commit();
    }

    return {
      results,
      count: entities.length,
      success: true,
    };
  },

  /**
   * Soft-deletes an account.
   *
   * @param ctx - Trace context
   * @param id - Account ID
   * @param user_id - User performing the delete
   * @returns Write result
   */
  async soft_delete(
    ctx: TraceContext,
    id: string,
    user_id: string
  ): Promise<WriteResult> {
    const before_doc = await doc_ref(id).get();

    if (!before_doc.exists) {
      throw new Error(`Account ${id} not found`);
    }

    const before = before_doc.data() as LegacyAccountDoc;
    /* eslint-disable @typescript-eslint/naming-convention */
    const after: LegacyAccountDoc = {
      ...before,
      isActive: false,
      isDeleted: true,
      updatedAt: Timestamp.now(),
    };
    /* eslint-enable @typescript-eslint/naming-convention */

    await doc_ref(id).set(after);

    // Audit entry (async)
    record_audit_entry_async({
      user_id,
      action: "delete",
      entity_type: "account",
      entity_id: id,
      before: before as unknown as Record<string, unknown>,
      after: after as unknown as Record<string, unknown>,
      trace_id: ctx.trace_id,
      metadata: { source: "api" },
    });

    return create_write_result("account", id, "replace", before, after);
  },

  /**
   * Restores a soft-deleted account.
   *
   * @param ctx - Trace context
   * @param id - Account ID
   * @param user_id - User performing the restore
   * @returns Write result
   */
  async restore(
    ctx: TraceContext,
    id: string,
    user_id: string
  ): Promise<WriteResult> {
    const before_doc = await doc_ref(id).get();

    if (!before_doc.exists) {
      throw new Error(`Account ${id} not found`);
    }

    const before = before_doc.data() as LegacyAccountDoc;
    /* eslint-disable @typescript-eslint/naming-convention */
    const after: LegacyAccountDoc = {
      ...before,
      isActive: true,
      isDeleted: false,
      updatedAt: Timestamp.now(),
    };
    /* eslint-enable @typescript-eslint/naming-convention */

    await doc_ref(id).set(after);

    // Audit entry (async)
    record_audit_entry_async({
      user_id,
      action: "restore",
      entity_type: "account",
      entity_id: id,
      before: before as unknown as Record<string, unknown>,
      after: after as unknown as Record<string, unknown>,
      trace_id: ctx.trace_id,
      metadata: { source: "api" },
    });

    return create_write_result("account", id, "replace", before, after);
  },

  /**
   * Updates account balances.
   * Optimized update that only touches balance fields.
   *
   * @param ctx - Trace context
   * @param id - Account ID
   * @param balances - New balance information
   * @param user_id - User performing the update
   * @returns Write result
   */
  async update_balances(
    ctx: TraceContext,
    id: string,
    balances: {
      current: number;
      available?: number;
      limit?: number;
    },
    user_id: string
  ): Promise<WriteResult> {
    const before_doc = await doc_ref(id).get();

    if (!before_doc.exists) {
      throw new Error(`Account ${id} not found`);
    }

    const before = before_doc.data() as LegacyAccountDoc;
    const now = Timestamp.now();

    /* eslint-disable @typescript-eslint/naming-convention */
    const update_data = {
      currentBalance: balances.current,
      availableBalance: balances.available,
      limit: balances.limit,
      lastBalanceUpdate: now,
      updatedAt: now,
    };
    /* eslint-enable @typescript-eslint/naming-convention */

    await doc_ref(id).update(update_data);

    const after = { ...before, ...update_data };

    // Audit entry (async)
    record_audit_entry_async({
      user_id,
      action: "update",
      entity_type: "account",
      entity_id: id,
      before: before as unknown as Record<string, unknown>,
      after: after as unknown as Record<string, unknown>,
      trace_id: ctx.trace_id,
      metadata: { source: "api", context: { balance_update: true } },
    });

    return create_write_result("account", id, "merge", before, after);
  },

  /**
   * Counts accounts for a user.
   *
   * @param _ctx - Trace context
   * @param user_id - User ID
   * @param include_deleted - Include soft-deleted accounts
   * @returns Count of accounts
   */
  async count_by_user_id(
    _ctx: TraceContext,
    user_id: string,
    include_deleted = false
  ): Promise<number> {
    const db = getFirestore();
    let query = db.collection(COLLECTION).where("userId", "==", user_id);

    if (!include_deleted) {
      query = query.where("isActive", "==", true);
    }

    const snapshot = await query.count().get();
    return snapshot.data().count;
  },

  /**
   * Checks if an account exists.
   *
   * @param _ctx - Trace context
   * @param id - Account ID
   * @returns Whether the account exists
   */
  async exists(_ctx: TraceContext, id: string): Promise<boolean> {
    const doc = await doc_ref(id).get();
    return doc.exists;
  },

  /**
   * Gets an account by Plaid account ID.
   *
   * @param _ctx - Trace context
   * @param plaid_account_id - Plaid account ID
   * @param user_id - User ID for scoping query
   * @returns Account entity or null if not found
   */
  async get_by_plaid_account_id(
    _ctx: TraceContext,
    plaid_account_id: string,
    user_id: string
  ): Promise<Account | null> {
    const db = getFirestore();
    const snapshot = await db
      .collection(COLLECTION)
      .where("accountId", "==", plaid_account_id)
      .where("userId", "==", user_id)
      .where("isActive", "==", true)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return null;
    }

    return map_to_entity(snapshot.docs[0].data() as LegacyAccountDoc);
  },

  /**
   * Upserts accounts from Plaid data.
   *
   * For each account:
   * - If exists (by plaid_account_id): updates balances only
   * - If new: creates the full account
   *
   * This is the shared logic used by both initial sync and balance refresh.
   *
   * @param ctx - Trace context
   * @param plaid_accounts - Array of Plaid account data
   * @param item_id - Plaid item ID
   * @param user_id - User ID
   * @param institution - Institution info
   * @param group_id - Optional group ID for sharing
   * @returns Upsert results with created/updated counts
   */
  async upsert_from_plaid(
    ctx: TraceContext,
    plaid_accounts: Array<{
      account_id: string;
      name: string;
      official_name?: string | null;
      type: string;
      subtype?: string | null;
      mask?: string | null;
      balances: {
        current: number | null;
        available?: number | null;
        limit?: number | null;
        iso_currency_code?: string | null;
      };
    }>,
    item_id: string,
    user_id: string,
    institution: { id: string; name: string },
    group_id?: string
  ): Promise<{
    created: number;
    updated: number;
    results: Array<{
      plaid_account_id: string;
      doc_id: string;
      action: "created" | "updated";
      previous_balance?: number;
      new_balance: number;
    }>;
  }> {
    const db = getFirestore();
    const now = Timestamp.now();
    let created = 0;
    let updated = 0;
    const results: Array<{
      plaid_account_id: string;
      doc_id: string;
      action: "created" | "updated";
      previous_balance?: number;
      new_balance: number;
    }> = [];

    // Process in batches
    const chunks = chunk_for_batch(plaid_accounts);

    for (const chunk of chunks) {
      const batch = db.batch();

      for (const plaid_account of chunk) {
        // Check if account exists
        const existing = await this.get_by_plaid_account_id(
          ctx,
          plaid_account.account_id,
          user_id
        );

        const new_balance = plaid_account.balances.current ?? 0;

        if (existing) {
          // UPDATE: Only update balances
          const ref = doc_ref(existing.id);
          /* eslint-disable @typescript-eslint/naming-convention */
          const update_data = {
            currentBalance: new_balance,
            availableBalance: plaid_account.balances.available ?? undefined,
            limit: plaid_account.balances.limit ?? undefined,
            lastBalanceUpdate: now,
            updatedAt: now,
          };
          /* eslint-enable @typescript-eslint/naming-convention */
          batch.update(ref, update_data);

          results.push({
            plaid_account_id: plaid_account.account_id,
            doc_id: existing.id,
            action: "updated",
            previous_balance: existing.balances.current,
            new_balance,
          });
          updated++;

          // Audit entry
          record_audit_entry_async({
            user_id,
            action: "update",
            entity_type: "account",
            entity_id: existing.id,
            before: { currentBalance: existing.balances.current },
            after: { currentBalance: new_balance },
            trace_id: ctx.trace_id,
            metadata: { source: "api", context: { balance_update: true } },
          });
        } else {
          // CREATE: Full account creation
          const doc_id = db.collection(COLLECTION).doc().id;
          const ref = doc_ref(doc_id);

          const group_ids = group_id ? [group_id] : [];

          /* eslint-disable @typescript-eslint/naming-convention */
          const doc_data: LegacyAccountDoc = {
            id: doc_id,
            userId: user_id,
            groupIds: group_ids,
            isActive: true,
            isDeleted: false,
            createdAt: now,
            updatedAt: now,
            accountId: plaid_account.account_id,
            plaidAccountId: plaid_account.account_id, // Mobile app expects this field
            itemId: item_id,
            name: plaid_account.name,
            accountName: plaid_account.name,
            mask: plaid_account.mask ?? undefined,
            officialName: plaid_account.official_name ?? undefined,
            accountType: plaid_account.type,
            accountSubtype: plaid_account.subtype ?? "unknown",
            currentBalance: new_balance,
            availableBalance: plaid_account.balances.available ?? undefined,
            limit: plaid_account.balances.limit ?? undefined,
            isoCurrencyCode: plaid_account.balances.iso_currency_code ?? "USD",
            lastBalanceUpdate: now,
            institutionId: institution.id,
            institutionName: institution.name,
            isSyncEnabled: true,
            access: {
              ownerId: user_id,
              createdBy: user_id,
              groupIds: group_ids,
              isPrivate: group_ids.length === 0,
            },
          };
          /* eslint-enable @typescript-eslint/naming-convention */

          batch.set(ref, doc_data);

          results.push({
            plaid_account_id: plaid_account.account_id,
            doc_id,
            action: "created",
            new_balance,
          });
          created++;

          // Audit entry
          record_audit_entry_async({
            user_id,
            action: "create",
            entity_type: "account",
            entity_id: doc_id,
            before: null,
            after: doc_data as unknown as Record<string, unknown>,
            trace_id: ctx.trace_id,
            metadata: { source: "api" },
          });
        }
      }

      await batch.commit();
    }

    console.log(
      `[${ctx.trace_id}] upsert_from_plaid: created=${created}, updated=${updated}`
    );

    return { created, updated, results };
  },

  /**
   * Gets accounts for a user in client response format (camelCase).
   *
   * This method is used by orchestrators to return account data
   * directly to the entry layer without additional transformation.
   *
   * @param _ctx - Trace context
   * @param user_id - User ID
   * @param item_id - Optional: filter by Plaid item ID
   * @returns Array of accounts in client format
   */
  async get_for_client_response(
    _ctx: TraceContext,
    user_id: string,
    item_id?: string
  ): Promise<ClientAccountData[]> {
    const db = getFirestore();

    let query = db
      .collection(COLLECTION)
      .where("userId", "==", user_id)
      .where("isActive", "==", true);

    if (item_id) {
      query = query.where("itemId", "==", item_id);
    }

    const snapshot = await query.get();

    return snapshot.docs.map((doc) => {
      const data = doc.data() as LegacyAccountDoc;
      // Return in camelCase format expected by frontend
      return {
        id: doc.id,
        plaidAccountId: data.accountId,
        accountId: data.accountId,
        itemId: data.itemId,
        userId: data.userId,
        familyId: data.groupIds?.[0] || "",
        institutionId: data.institutionId,
        institutionName: data.institutionName,
        accountName: data.name || data.accountName || "",
        accountType: data.accountType,
        accountSubtype: data.accountSubtype,
        mask: data.mask,
        officialName: data.officialName,
        currentBalance: data.currentBalance,
        availableBalance: data.availableBalance,
        creditLimit: data.limit,
        isoCurrencyCode: data.isoCurrencyCode || "USD",
        isActive: data.isActive,
        isSyncEnabled: data.isSyncEnabled ?? true,
        lastBalanceUpdate: data.lastBalanceUpdate?.toDate?.(),
        lastUpdated: data.lastBalanceUpdate?.toDate?.() || data.updatedAt?.toDate?.(),
        createdAt: data.createdAt?.toDate?.(),
        updatedAt: data.updatedAt?.toDate?.(),
      };
    });
  },
};
