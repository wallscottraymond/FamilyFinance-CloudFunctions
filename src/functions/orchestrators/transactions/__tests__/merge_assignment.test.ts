/**
 * merge_assignment_onto_raw_splits — Unit Tests
 *
 * Pure helper shared by `assign_transaction` and `assign_transactions_batch`.
 * These tests pin the merge / name-heal / split_budget_ids semantics so the two
 * call sites can't drift.
 */

import { Timestamp } from "firebase-admin/firestore";
import { merge_assignment_onto_raw_splits } from "../merge_assignment";
import { ResolvedAssignment } from "../../../resolvers/transactions/assignment_context.resolver";
import {
  AssignedSplit,
  TransactionAssignmentResult,
} from "../../../domain/transactions/compute_transaction_assignment.service";

const NOW = Timestamp.fromMillis(Date.UTC(2026, 5, 15));

/** Minimal assigned split with sensible defaults. */
function assigned(over: Partial<AssignedSplit> = {}): AssignedSplit {
  return {
    split_id: "s1",
    budget_id: "b_groceries",
    budget_assignment_source: "category",
    outflow_id: null,
    inflow_id: null,
    monthly_period_id: "2026M06",
    weekly_period_id: "2026W24",
    bi_weekly_period_id: null,
    reason: { budget: "category+date", tie: false, recurring: "none" },
    ...over,
  };
}

/** Build a ResolvedAssignment with the given raw splits + budget names. */
function resolved(
  raw_splits: Array<Record<string, unknown>>,
  budget_names: Record<string, string>
): ResolvedAssignment {
  return {
    transaction_doc_id: "txn1",
    raw_splits,
    splits_input: [],
    // `context` is unused by the merge — cast a minimal stub.
    context: {} as ResolvedAssignment["context"],
    budget_names,
  };
}

function result(splits: AssignedSplit[]): TransactionAssignmentResult {
  return {
    splits,
    touched_budget_ids: [...new Set(splits.map((s) => s.budget_id))],
    changed: true,
    any_unassigned: false,
  };
}

describe("merge_assignment_onto_raw_splits", () => {
  it("merges engine-owned fields + budgetName onto the raw split", () => {
    const r = resolved(
      [{ splitId: "s1", budgetId: "old", budgetName: "General", amount: 10 }],
      { b_groceries: "Groceries" }
    );
    const { updated_splits } = merge_assignment_onto_raw_splits(
      r,
      result([assigned()]),
      NOW
    );

    expect(updated_splits[0]).toMatchObject({
      splitId: "s1",
      budgetId: "b_groceries",
      budgetName: "Groceries",
      budgetAssignmentSource: "category",
      monthlyPeriodId: "2026M06",
      weeklyPeriodId: "2026W24",
      amount: 10, // non-engine field preserved
      updatedAt: NOW,
    });
  });

  it("flags name_changed only when budgetName drifts", () => {
    const same = merge_assignment_onto_raw_splits(
      resolved(
        [{ splitId: "s1", budgetName: "Groceries" }],
        { b_groceries: "Groceries" }
      ),
      result([assigned()]),
      NOW
    );
    expect(same.name_changed).toBe(false);

    const drifted = merge_assignment_onto_raw_splits(
      resolved(
        [{ splitId: "s1", budgetName: "General" }],
        { b_groceries: "Groceries" }
      ),
      result([assigned()]),
      NOW
    );
    expect(drifted.name_changed).toBe(true);
  });

  it("leaves a raw split with no computed assignment untouched", () => {
    const r = resolved(
      [
        { splitId: "s1", budgetName: "General" },
        { splitId: "orphan", budgetName: "Keep", foo: "bar" },
      ],
      { b_groceries: "Groceries" }
    );
    const { updated_splits } = merge_assignment_onto_raw_splits(
      r,
      result([assigned()]),
      NOW
    );
    // The orphan split (no matching AssignedSplit) is returned as-is.
    expect(updated_splits[1]).toEqual({ splitId: "orphan", budgetName: "Keep", foo: "bar" });
  });

  it("returns the distinct budget ids across all computed splits", () => {
    const r = resolved(
      [{ splitId: "s1" }, { splitId: "s2" }, { splitId: "s3" }],
      {}
    );
    const { split_budget_ids } = merge_assignment_onto_raw_splits(
      r,
      result([
        assigned({ split_id: "s1", budget_id: "b1" }),
        assigned({ split_id: "s2", budget_id: "b2" }),
        assigned({ split_id: "s3", budget_id: "b1" }),
      ]),
      NOW
    );
    expect(split_budget_ids.sort()).toEqual(["b1", "b2"]);
  });
});
