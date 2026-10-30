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
import { TraceContext } from "../../types";
/** Ensures the group's Everything Else budgets exist. Never throws. */
export declare function ensure_group_everything_else(ctx: TraceContext, group_id: string): Promise<void>;
//# sourceMappingURL=group_everything_else.d.ts.map