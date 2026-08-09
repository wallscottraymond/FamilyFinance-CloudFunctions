/**
 * List Suppressed Recurring Orchestrator
 *
 * READ-ONLY: the user's currently removed/paused recurring items (bills + income)
 * for the recovery screen. Suppression state is computed SERVER-SIDE from each
 * item's `removal_intervals` (single source of truth) — so a pause that has
 * auto-resumed is correctly excluded without any write. Active items are omitted.
 *
 * @module orchestrators/recurring/list_suppressed_recurring
 */
import { TraceContext } from "../../types";
export interface SuppressedRecurringItem {
    kind: "outflow" | "inflow";
    id: string;
    name: string;
    status: "removed" | "paused";
    /** For `paused`: when it auto-resumes. */
    resume_ms: number | null;
}
export interface ListSuppressedRecurringResult {
    items: SuppressedRecurringItem[];
}
export declare function list_suppressed_recurring_orchestrator(ctx: TraceContext, user_id: string, now_ms: number): Promise<ListSuppressedRecurringResult>;
//# sourceMappingURL=list_suppressed_recurring.orchestrator.d.ts.map