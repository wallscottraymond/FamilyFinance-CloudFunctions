/**
 * Widget Snapshot Orchestrator ([[iOS-Home-Screen-Widgets]] Phase 2)
 *
 * Serves the iOS widget's self-fetch (every ~30 min, app closed):
 *   1. token → sha256 → user + current data version (2 reads)
 *   2. widget already has this version → "unchanged" (done; ~2 reads total)
 *   3. else current source period for the cadence → derive_period (same window the app uses,
 *      so it shares the derived-period cache) → pure snapshot (same math as the Home card).
 *
 * Read-only. Never writes.
 *
 * @module orchestrators/widgets/widget_snapshot
 */
import { TraceContext } from "../../types";
import { WidgetSnapshotPayload } from "../../domain/widgets/widget_snapshot.service";
export interface WidgetSnapshotInput {
    /** Raw bearer token from the widget (hashed here; never stored or logged). */
    token: string;
    cadence: "monthly" | "weekly" | "bi_monthly";
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
    status: "snapshot";
    version: number;
    snapshot: WidgetSnapshotPayload;
};
export declare function widget_snapshot_orchestrator(ctx: TraceContext, input: WidgetSnapshotInput): Promise<WidgetSnapshotOutcome>;
//# sourceMappingURL=widget_snapshot.orchestrator.d.ts.map