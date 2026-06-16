/**
 * @file account_removal.unit.test.ts
 * @description Unit tests for the pure domain logic behind account removal & restore.
 *
 * These cover the validation-matrix rows from the Plaid-Account-Removal-Migration
 * project that can be verified WITHOUT an emulator or device — i.e. the pure
 * decision logic in `account.service.ts`:
 *
 * | Matrix row                                  | Function under test            |
 * |---------------------------------------------|--------------------------------|
 * | Remove single account (others exist)        | determine_removal_type         |
 * | Remove last account for item                | determine_removal_type         |
 * | Owner removes own account                   | check_account_delete_access    |
 * | Group member / non-member tries to remove   | check_account_delete_access    |
 * | Remove with "keep history"                  | compute_account_removal        |
 * | Remove with "delete history"                | compute_account_removal        |
 * | Restorability (single vs full item)         | compute_account_removal        |
 * | Restore hidden account                      | validate_account_restore       |
 * | Restore after full item removal (denied)    | validate_account_restore       |
 * | Idempotent removal                          | is_account_already_deleted     |
 *
 * Cascade, webhook filtering, Plaid API failure, and the end-to-end restore flow
 * require the emulator / a device and are tracked separately in the project's
 * validation matrix.
 */

import {
  AccountAccessData,
  UserAccessContext,
  check_account_delete_access,
  determine_removal_type,
  compute_account_removal,
  validate_account_restore,
  is_account_already_deleted,
} from "../account.service";

// ============================================================================
// FIXTURES
// ============================================================================

const OWNER_ID = "user_owner";
const OTHER_ID = "user_other";
const NOW = new Date("2026-06-09T00:00:00.000Z");

const active_account = (overrides: Partial<AccountAccessData> = {}): AccountAccessData => ({
  user_id: OWNER_ID,
  is_active: true,
  is_deleted: false,
  access: { owner_id: OWNER_ID, group_ids: ["group_1"], is_private: false },
  ...overrides,
});

const owner: UserAccessContext = { user_id: OWNER_ID, group_ids: ["group_1"] };
const group_member: UserAccessContext = { user_id: OTHER_ID, group_ids: ["group_1"] };
const non_member: UserAccessContext = { user_id: OTHER_ID, group_ids: ["group_99"] };

// ============================================================================
// determine_removal_type — single account vs full item
// ============================================================================

describe("determine_removal_type", () => {
  it("returns single_account and does NOT call Plaid when other accounts exist", () => {
    const result = determine_removal_type({
      account_id: "acc_1",
      item_id: "item_1",
      other_active_accounts_count: 2,
    });

    expect(result.entity?.removal_type).toBe("single_account");
    expect(result.entity?.should_call_plaid).toBe(false);
  });

  it("returns full_item and calls Plaid when removing the last account", () => {
    const result = determine_removal_type({
      account_id: "acc_1",
      item_id: "item_1",
      other_active_accounts_count: 0,
    });

    expect(result.entity?.removal_type).toBe("full_item");
    expect(result.entity?.should_call_plaid).toBe(true);
  });

  it("validates required fields", () => {
    expect(
      determine_removal_type({ account_id: "", item_id: "item_1", other_active_accounts_count: 0 })
        .validation_errors
    ).toContain("account_id is required");

    expect(
      determine_removal_type({ account_id: "acc_1", item_id: "", other_active_accounts_count: 0 })
        .validation_errors
    ).toContain("item_id is required");

    expect(
      determine_removal_type({ account_id: "acc_1", item_id: "item_1", other_active_accounts_count: -1 })
        .validation_errors
    ).toContain("other_active_accounts_count cannot be negative");
  });
});

// ============================================================================
// check_account_delete_access — permissions
// ============================================================================

describe("check_account_delete_access", () => {
  it("allows the owner to delete their own account", () => {
    const result = check_account_delete_access(active_account(), owner);
    expect(result.entity?.has_access).toBe(true);
    expect(result.entity?.reason).toBe("owner");
  });

  it("denies a group member who is not the owner", () => {
    const result = check_account_delete_access(active_account(), group_member);
    expect(result.entity?.has_access).toBe(false);
    expect(result.entity?.reason).toBe("not_owner");
    expect(result.validation_errors).toContain("Only the account owner can delete this account");
  });

  it("denies a non-member", () => {
    const result = check_account_delete_access(active_account(), non_member);
    expect(result.entity?.has_access).toBe(false);
    expect(result.entity?.reason).toBe("not_owner");
  });

  it("treats an already-deleted account as idempotently accessible to the owner", () => {
    const result = check_account_delete_access(
      active_account({ is_active: false, is_deleted: true }),
      owner
    );
    expect(result.entity?.has_access).toBe(true);
    expect(result.entity?.reason).toBe("already_deleted");
  });
});

// ============================================================================
// compute_account_removal — history modes & restorability
// ============================================================================

describe("compute_account_removal", () => {
  const base = {
    account_id: "acc_1",
    account_user_id: OWNER_ID,
    item_id: "item_1",
    now: NOW,
  };

  it("keep_history does NOT exclude transactions from budgets", () => {
    const result = compute_account_removal({
      ...base,
      removal_mode: "keep_history",
      removal_type: "single_account",
    });

    expect(result.entity?.exclude_transactions_from_budgets).toBe(false);
    expect(result.entity?.account_state.removal_mode).toBe("keep_history");
  });

  it("delete_history excludes transactions from budgets", () => {
    const result = compute_account_removal({
      ...base,
      removal_mode: "delete_history",
      removal_type: "single_account",
    });

    expect(result.entity?.exclude_transactions_from_budgets).toBe(true);
    expect(result.entity?.account_state.removal_mode).toBe("delete_history");
  });

  it("single_account removal is restorable and does NOT remove the Plaid item", () => {
    const result = compute_account_removal({
      ...base,
      removal_mode: "keep_history",
      removal_type: "single_account",
    });

    expect(result.entity?.account_state.is_restorable).toBe(true);
    expect(result.entity?.should_remove_plaid_item).toBe(false);
  });

  it("full_item removal is NOT restorable and removes the Plaid item", () => {
    const result = compute_account_removal({
      ...base,
      removal_mode: "keep_history",
      removal_type: "full_item",
    });

    expect(result.entity?.account_state.is_restorable).toBe(false);
    expect(result.entity?.should_remove_plaid_item).toBe(true);
  });

  it("full_item removal without a Plaid item does NOT attempt Plaid removal", () => {
    const result = compute_account_removal({
      ...base,
      item_id: null,
      removal_mode: "keep_history",
      removal_type: "full_item",
    });

    expect(result.entity?.should_remove_plaid_item).toBe(false);
  });

  it("always soft-deletes (is_active false) and stamps removed_at", () => {
    const result = compute_account_removal({
      ...base,
      removal_mode: "keep_history",
      removal_type: "single_account",
    });

    expect(result.entity?.account_state.is_active).toBe(false);
    expect(result.entity?.account_state.removed_at).toEqual(NOW);
    expect(result.entity?.should_cascade).toBe(true);
  });
});

// ============================================================================
// validate_account_restore — restore eligibility
// ============================================================================

describe("validate_account_restore", () => {
  it("allows restoring a soft-deleted, restorable account whose item is still active", () => {
    const result = validate_account_restore(false, true, true);
    expect(result.entity?.can_restore).toBe(true);
  });

  it("denies restoring an account that is already active", () => {
    const result = validate_account_restore(true, true, true);
    expect(result.entity?.can_restore).toBe(false);
    expect(result.entity?.reason).toContain("already active");
  });

  it("denies restoring after a full item removal (not restorable)", () => {
    const result = validate_account_restore(false, false, null);
    expect(result.entity?.can_restore).toBe(false);
    expect(result.entity?.reason).toContain("fully removed");
  });

  it("denies restoring when the Plaid item is no longer active", () => {
    const result = validate_account_restore(false, true, false);
    expect(result.entity?.can_restore).toBe(false);
    expect(result.entity?.reason).toContain("no longer active");
  });
});

// ============================================================================
// is_account_already_deleted — idempotency guard
// ============================================================================

describe("is_account_already_deleted", () => {
  it("is false for a live account", () => {
    expect(is_account_already_deleted(active_account())).toBe(false);
  });

  it("is true when inactive", () => {
    expect(is_account_already_deleted(active_account({ is_active: false }))).toBe(true);
  });

  it("is true when flagged deleted", () => {
    expect(is_account_already_deleted(active_account({ is_deleted: true }))).toBe(true);
  });
});

// ============================================================================
// Determinism — domain services must be pure
// ============================================================================

describe("domain purity", () => {
  it("compute_account_removal is deterministic for the same input", () => {
    const input = {
      account_id: "acc_1",
      account_user_id: OWNER_ID,
      item_id: "item_1",
      removal_mode: "delete_history" as const,
      removal_type: "full_item" as const,
      now: NOW,
    };
    expect(compute_account_removal(input)).toEqual(compute_account_removal(input));
  });
});
