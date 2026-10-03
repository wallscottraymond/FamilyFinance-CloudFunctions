/**
 * Widget Snapshot Orchestrator ([[iOS-Home-Screen-Widgets]] Phases 2–3)
 *
 * Serves the iOS widgets' self-fetch (every ~30 min with the app closed, or immediately when
 * the running app asks WidgetKit to reload). The backend is the single source of widget data:
 *   1. token → sha256 → user + current data version (2 reads)
 *   2. widget already has this version → "unchanged" (done)
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
    kind: "left" | "summary" | "bills";
    cadence: WidgetCadence;
    lookahead_days: number;
    /** The data version the widget already has (skip work when unchanged). */
    have_version: number | null;
    now_ms: number;
}
export type WidgetSnapshotOutcome = {
    status: "unauthorized";
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