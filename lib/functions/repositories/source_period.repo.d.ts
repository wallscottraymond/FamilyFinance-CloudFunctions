/**
 * Source Period Repository
 *
 * Read-only access to the canonical `source_periods` collection. Source periods
 * are the system-wide calendar buckets (monthly / weekly / bi_monthly) that
 * budget periods are generated against.
 *
 * @module repositories/source_period
 */
import { Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../types";
/**
 * A source period in snake_case.
 */
export interface SourcePeriodEntity {
    id: string;
    period_id: string;
    period_type: "weekly" | "monthly" | "bi_monthly";
    start_date: Timestamp;
    end_date: Timestamp;
    year: number;
    index: number;
    month?: number;
    bi_monthly_half?: 1 | 2;
}
/**
 * `get_overlapping` looks back this far on `startDate` (a period that STARTED up to a month before
 * the window can still overlap it). Exported so in-memory re-filtering of a wider load
 * (`shape_period_derivation_deps`) applies the IDENTICAL bound.
 */
export declare const SOURCE_PERIOD_OVERLAP_BUFFER_MS: number;
export declare const source_period_repo: {
    /**
     * Gets a single source period by ID.
     */
    get_by_id(_ctx: TraceContext, period_id: string): Promise<SourcePeriodEntity | null>;
    /**
     * Gets all source periods (every type: monthly, weekly, bi_monthly) that
     * OVERLAP the window [anchor, end] — i.e. periods that end on/after `anchor`
     * and start on/before `end`. This includes the partial period containing
     * `anchor` (matching the legacy generation semantics), so a budget whose
     * start date falls mid-period still gets that period.
     *
     * Implemented with a single-field `startDate` range (no composite index):
     * query `startDate >= anchor - 31d` (31d ≥ the longest source period) and
     * `startDate <= end`, then drop any period that already ended before `anchor`.
     */
    /**
     * Gets all source periods whose `startDate` falls in [start, end] (every
     * type), ordered by startDate. Used by period-generation resolvers.
     */
    get_by_start_date_range(_ctx: TraceContext, start: Timestamp, end: Timestamp): Promise<SourcePeriodEntity[]>;
    get_overlapping(_ctx: TraceContext, anchor: Timestamp, end: Timestamp): Promise<SourcePeriodEntity[]>;
};
//# sourceMappingURL=source_period.repo.d.ts.map