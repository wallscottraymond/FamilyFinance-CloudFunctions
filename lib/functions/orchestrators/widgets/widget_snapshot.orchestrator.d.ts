/**
 * Widget Snapshot Orchestrator ([[iOS-Home-Screen-Widgets]] Phases 2–3)
 *
 * Serves the iOS widgets' self-fetch (every ~30 min with the app closed, or immediately when
 * the running app asks WidgetKit to reload). The backend is the single source of widget data:
 *   1. token → sha256 → user; then the view version (Me or group — membership checked: not a
 *      member → "not_member"), combined with the UTC day into the widget's version
 *   2. widget already has this version → "unchanged" (done). The day is part of it because the
 *      payload is day-relative (current period, `overdue`): a widget refetches once per UTC day
 *   3. else only the derives this widget KIND needs (same windows the app derives, so they
 *      share the derived-period cache) → pure builders that mirror the app's formulas.
 *
 * Read-only. Never writes.
 *
 * @module orchestrators/widgets/widget_snapshot
 */
import { TraceContext } from "../../types";
import { WidgetData } from "../../domain/widgets/widget_snapshot.service";
export type WidgetCadence = "monthly" | "weekly" | "bi_monthly";
export interface WidgetSnapshotInput {
    /** Raw bearer token from the widget (hashed here; never stored or logged). */
    token: string;
    kind: "left" | "summary" | "bills" | "budget_txns" | "recent";
    /** kind=budget_txns: the budget whose recent transactions to return. */
    budget_id: string | null;
    cadence: WidgetCadence;
    lookahead_days: number;
    /** Account-Rooted-Sharing: the group this widget shows (Edit Widget → Show); null = Me. */
    group_id: string | null;
    /** The data version the widget already has (skip work when unchanged). */
    have_version: number | null;
    now_ms: number;
}
export type WidgetSnapshotOutcome = {
    status: "unauthorized";
} | {
    status: "not_member";
} | {
    status: "unchanged";
    version: number;
} | {
    status: "no_period";
    version: number;
} | {
    status: "data";
    version: number;
    data: WidgetData;
};
export declare function widget_snapshot_orchestrator(ctx: TraceContext, input: WidgetSnapshotInput): Promise<WidgetSnapshotOutcome>;
//# sourceMappingURL=widget_snapshot.orchestrator.d.ts.map