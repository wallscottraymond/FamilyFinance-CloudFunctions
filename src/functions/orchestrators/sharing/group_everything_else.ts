/**
 * Group Everything Else (D6, PD6)
 *
 * Each view has its own Everything Else budgets (one per cadence). For a group
 * the owner key is "group:<id>". Provisioning is idempotent (the shared helper
 * skips cadences that already exist), so it's safe to call whenever a budget
 * enters a group; group creation calls it first.
 *
 * @module orchestrators/sharing/group_everything_else
 */

import { getFirestore } from "firebase-admin/firestore";
import { TraceContext } from "../../types";
import { createEverythingElseBudget } from "../../budgets/utils/createEverythingElseBudget";
import { group_view_key } from "../../domain/sharing/budget_view.service";

/** Ensures the group's Everything Else budgets exist. Never throws. */
export async function ensure_group_everything_else(
  ctx: TraceContext,
  group_id: string
): Promise<void> {
  try {
    await createEverythingElseBudget(getFirestore(), group_view_key(group_id));
  } catch (error) {
    console.error(
      `[${ctx.trace_id}] ensure_group_everything_else(${group_id}) failed:`,
      error instanceof Error ? error.message : error
    );
  }
}
