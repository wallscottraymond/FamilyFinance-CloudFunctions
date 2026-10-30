"use strict";
/**
 * The source periods a recurring record's periods are generated in.
 *
 * Normally: the periods that START in [start, end]. A record made in the app (`source: "manual"`,
 * from a convert or Add Bill) starts on a payment's date, i.e. mid-period, so the periods that
 * CONTAIN its first date are taken too. Without them the first payment's month / week / half-month
 * had no period doc, and its bill tile opened "Bill not found". Plaid records keep the old window
 * (byte-identical), and an explicit start is never widened.
 *
 * @module resolvers/periods/generation_source_periods
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.get_generation_source_periods = get_generation_source_periods;
const firestore_1 = require("firebase-admin/firestore");
const repositories_1 = require("../../repositories");
/** Longer than any source period (a month is at most 31 days). */
const CONTAINING_LOOKBACK_MS = 32 * 24 * 60 * 60 * 1000;
async function get_generation_source_periods(ctx, start, end, opts) {
    const widen = opts.source === "manual" && !opts.explicit_start;
    const from = widen ? new Date(start.getTime() - CONTAINING_LOOKBACK_MS) : start;
    const periods = await repositories_1.source_period_repo.get_by_start_date_range(ctx, firestore_1.Timestamp.fromDate(from), firestore_1.Timestamp.fromDate(end));
    return widen ? periods.filter((p) => p.end_date.toMillis() >= start.getTime()) : periods;
}
//# sourceMappingURL=generation_source_periods.resolver.js.map