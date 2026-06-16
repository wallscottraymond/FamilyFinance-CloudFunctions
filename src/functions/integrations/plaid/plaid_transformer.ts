/**
 * Plaid Transformer
 *
 * PURE functions that convert Plaid data formats to domain formats.
 * NO async, NO IO, NO side effects.
 *
 * @module integrations/plaid/plaid_transformer
 */

import { Timestamp } from "firebase-admin/firestore";
import { AccountBase } from "plaid";
import { DomainResult } from "../../types";
import { PlaidInstitutionInfo } from "./plaid_client";

/**
 * Account data in the snake_case domain-input shape the downstream
 * transformers + `account_repo` consume. Produced by `plaid_accounts_to_data`
 * from the RAW Plaid SDK `AccountBase` (the client never maps).
 */
export interface PlaidAccountData {
  account_id: string;
  name: string;
  official_name: string | null;
  type: string;
  subtype: string | null;
  mask: string | null;
  balances: {
    current: number | null;
    available: number | null;
    limit: number | null;
    iso_currency_code: string | null;
  };
}

/**
 * PURE: map raw Plaid SDK accounts to the domain-input shape. No IO.
 */
export function plaid_accounts_to_data(
  accounts: AccountBase[]
): PlaidAccountData[] {
  return accounts.map((account) => ({
    account_id: account.account_id,
    name: account.name,
    official_name: account.official_name,
    type: account.type,
    subtype: account.subtype,
    mask: account.mask,
    balances: {
      current: account.balances.current,
      available: account.balances.available,
      limit: account.balances.limit,
      iso_currency_code: account.balances.iso_currency_code,
    },
  }));
}

/**
 * Account entity ready for persistence.
 * Matches the structure expected by account_repo.
 */
export interface AccountForPersistence {
  id: string;
  user_id: string;
  group_ids: string[];
  is_active: boolean;
  is_deleted: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
  account_id: string;
  item_id: string;
  name: string;
  mask?: string;
  official_name?: string;
  account_type: string;
  account_subtype: string;
  balances: {
    current: number;
    available?: number;
    limit?: number;
    iso_currency_code?: string;
    last_updated: Timestamp;
  };
  institution: {
    id: string;
    name: string;
    logo?: string;
  };
  is_sync_enabled: boolean;
  last_synced_at?: Timestamp;
  access: {
    owner_id: string;
    created_by: string;
    group_ids: string[];
    is_private: boolean;
  };
}

/**
 * Context for transforming Plaid accounts.
 */
export interface TransformContext {
  user_id: string;
  item_id: string;
  institution: PlaidInstitutionInfo;
  group_ids: string[];
  now: Timestamp;
}

/**
 * Transforms Plaid accounts to domain entities.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param plaid_accounts - Raw accounts from Plaid API
 * @param context - Transformation context
 * @returns Domain result with entities or validation errors
 */
export function transform_plaid_accounts_to_domain(
  plaid_accounts: PlaidAccountData[],
  context: TransformContext
): DomainResult<AccountForPersistence> {
  const validation_errors: string[] = [];
  const entities: AccountForPersistence[] = [];

  for (const plaid_account of plaid_accounts) {
    // Validate required fields
    if (!plaid_account.account_id) {
      validation_errors.push("Account missing account_id");
      continue;
    }

    if (!plaid_account.type) {
      validation_errors.push(`Account ${plaid_account.account_id} missing type`);
      continue;
    }

    // Transform to domain entity
    const entity: AccountForPersistence = {
      // Identity
      id: plaid_account.account_id,
      user_id: context.user_id,
      group_ids: context.group_ids,
      is_active: true,
      is_deleted: false,
      created_at: context.now,
      updated_at: context.now,

      // Plaid identifiers
      account_id: plaid_account.account_id,
      item_id: context.item_id,

      // Account details
      name: plaid_account.name || "Unnamed Account",
      mask: plaid_account.mask ?? undefined,
      official_name: plaid_account.official_name ?? undefined,
      account_type: plaid_account.type,
      account_subtype: plaid_account.subtype || "other",

      // Balances
      balances: {
        current: plaid_account.balances.current ?? 0,
        available: plaid_account.balances.available ?? undefined,
        limit: plaid_account.balances.limit ?? undefined,
        iso_currency_code: plaid_account.balances.iso_currency_code ?? "USD",
        last_updated: context.now,
      },

      // Institution
      institution: {
        id: context.institution.institution_id,
        name: context.institution.name,
      },

      // Sync settings
      is_sync_enabled: true,
      last_synced_at: context.now,

      // Access control
      access: {
        owner_id: context.user_id,
        created_by: context.user_id,
        group_ids: context.group_ids,
        is_private: context.group_ids.length === 0,
      },
    };

    entities.push(entity);
  }

  if (validation_errors.length > 0) {
    return { entities, validation_errors };
  }

  return { entities };
}

/**
 * Transforms Plaid balance data to update existing accounts.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param plaid_accounts - Accounts with fresh balances from Plaid
 * @param now - Current timestamp
 * @returns Map of account_id to balance updates
 */
export function transform_plaid_balances_to_updates(
  plaid_accounts: PlaidAccountData[],
  now: Timestamp
): Map<string, { current: number; available?: number; limit?: number }> {
  const updates = new Map<string, {
    current: number;
    available?: number;
    limit?: number;
  }>();

  for (const plaid_account of plaid_accounts) {
    if (!plaid_account.account_id) continue;

    updates.set(plaid_account.account_id, {
      current: plaid_account.balances.current ?? 0,
      available: plaid_account.balances.available ?? undefined,
      limit: plaid_account.balances.limit ?? undefined,
    });
  }

  return updates;
}

/**
 * Maps Plaid account type to display-friendly category.
 *
 * PURE FUNCTION.
 */
export function get_account_category(
  account_type: string,
  account_subtype: string | null
): string {
  const type_lower = account_type.toLowerCase();
  const subtype_lower = account_subtype?.toLowerCase() || "";

  if (type_lower === "depository") {
    if (subtype_lower === "checking") return "checking";
    if (subtype_lower === "savings") return "savings";
    return "bank";
  }

  if (type_lower === "credit") {
    return "credit_card";
  }

  if (type_lower === "loan") {
    if (subtype_lower === "mortgage") return "mortgage";
    if (subtype_lower === "auto") return "auto_loan";
    if (subtype_lower === "student") return "student_loan";
    return "loan";
  }

  if (type_lower === "investment") {
    if (subtype_lower === "401k" || subtype_lower === "401a") return "retirement";
    if (subtype_lower === "ira" || subtype_lower === "roth") return "retirement";
    return "investment";
  }

  return "other";
}
