/**
 * Source Period Repository
 *
 * Read-only access to the canonical `source_periods` collection. Source periods
 * are the system-wide calendar buckets (monthly / weekly / bi_monthly) that
 * budget periods are generated against.
 *
 * @module repositories/source_period
 */

import { getFirestore, Timestamp } from "firebase-admin/firestore";
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

/* eslint-disable @typescript-eslint/naming-convention */
interface LegacySourcePeriodDoc {
  periodId: string;
  type: string;
  startDate: Timestamp;
  endDate: Timestamp;
  year: number;
  index: number;
  metadata?: {
    month?: number;
    biMonthlyHalf?: 1 | 2;
  };
}
/* eslint-enable @typescript-eslint/naming-convention */

const COLLECTION = "source_periods";

function map_to_entity(id: string, doc: LegacySourcePeriodDoc): SourcePeriodEntity {
  return {
    id,
    period_id: doc.periodId ?? id,
    period_type: (doc.type as SourcePeriodEntity["period_type"]) ?? "monthly",
    start_date: doc.startDate,
    end_date: doc.endDate,
    year: doc.year,
    index: doc.index,
    month: doc.metadata?.month,
    bi_monthly_half: doc.metadata?.biMonthlyHalf,
  };
}

export const source_period_repo = {
  /**
   * Gets a single source period by ID.
   */
  async get_by_id(
    _ctx: TraceContext,
    period_id: string
  ): Promise<SourcePeriodEntity | null> {
    const snap = await getFirestore().collection(COLLECTION).doc(period_id).get();
    if (!snap.exists) {
      return null;
    }
    return map_to_entity(snap.id, snap.data() as LegacySourcePeriodDoc);
  },

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
  async get_by_start_date_range(
    _ctx: TraceContext,
    start: Timestamp,
    end: Timestamp
  ): Promise<SourcePeriodEntity[]> {
    const snapshot = await getFirestore()
      .collection(COLLECTION)
      .where("startDate", ">=", start)
      .where("startDate", "<=", end)
      .orderBy("startDate", "asc")
      .get();
    return snapshot.docs.map((doc) =>
      map_to_entity(doc.id, doc.data() as LegacySourcePeriodDoc)
    );
  },

  async get_overlapping(
    _ctx: TraceContext,
    anchor: Timestamp,
    end: Timestamp
  ): Promise<SourcePeriodEntity[]> {
    const buffer_ms = 31 * 24 * 60 * 60 * 1000;
    const lower = Timestamp.fromMillis(anchor.toMillis() - buffer_ms);

    const snapshot = await getFirestore()
      .collection(COLLECTION)
      .where("startDate", ">=", lower)
      .where("startDate", "<=", end)
      .orderBy("startDate", "asc")
      .get();

    return snapshot.docs
      .map((doc) => map_to_entity(doc.id, doc.data() as LegacySourcePeriodDoc))
      .filter((p) => p.end_date.toMillis() >= anchor.toMillis());
  },
};
