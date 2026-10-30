"use strict";
/**
 * Scheduled: Extend Recurring Outflow Periods
 *
 * Maintains a rolling forward window of outflow_periods so users always see upcoming bills,
 * mirroring the proven `extendRecurringInflowPeriods` / `extendRecurringBudgetPeriods` jobs
 * (outflows were the only pillar without a scheduled extender — they relied on a manual,
 * unauthenticated HTTP endpoint, now retired).
 *
 * COST NOTE (deliberate): this must NEVER scan the whole outflow_periods collection (~14K docs).
 * Per outflow it reads only the SINGLE latest period (`outflowId ==` + `orderBy periodEndDate desc`
 * + `limit(1)`) to find how far it's already materialized, then generates only BEYOND that up to
 * the rolling horizon. Reads/run ≈ (active outflows) + 1 per outflow — bounded, never the full set.
 *
 * Runs monthly on the 1st at 3:00 AM UTC (offset from the inflow job at 2:00 AM).
 *
 * @module outflows/outflow_periods/scheduled/extendRecurringOutflowPeriods
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.extendRecurringOutflowPeriods = void 0;
exports.run_outflow_period_extension = run_outflow_period_extension;
exports.extendOutflowPeriodsFor = extendOutflowPeriodsFor;
const scheduler_1 = require("firebase-functions/v2/scheduler");
const admin = __importStar(require("firebase-admin"));
const createOutflowPeriods_1 = require("../crud/createOutflowPeriods");
/** How far ahead to keep outflow periods materialized (matches onOutflowCreated's horizon). */
const MONTHS_FORWARD = 15;
/**
 * Re-cover this many days before the latest materialized period's end. The latest period can be of
 * any type (a weekly one usually ends after the last monthly one), and the creator only keeps
 * source periods that START inside the window — so the window must reach back past the start of
 * every type's next period. Existing periods in the window are skipped (`skip_existing`), so this
 * only fills what is missing. (Before 2026-10-16 the window began the day after the latest END at
 * 23:59:59.999, which excluded every period starting at 00:00 that day: monthly periods were never
 * extended.)
 */
const LOOKBACK_DAYS = 40;
const DAY_MS = 24 * 60 * 60 * 1000;
const start_of_utc_day = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
/**
 * One pass over every active outflow (exported for the emulator test). Returns counts.
 */
async function run_outflow_period_extension(db, now = new Date(), 
// Test-only scoping: the emulator is shared by parallel suites, so a test passes its own owner
// and the run never touches (or races) other suites' outflows. Production omits it.
opts = {}) {
    // All active outflows across users. (Bounded read; NOT the period collection.)
    let activeQuery = db.collection("outflows").where("isActive", "==", true);
    if (opts.owner_id)
        activeQuery = activeQuery.where("ownerId", "==", opts.owner_id);
    const activeOutflowsSnapshot = await activeQuery.get();
    if (activeOutflowsSnapshot.empty) {
        console.log("[extendRecurringOutflowPeriods] No active outflows to maintain");
        return { outflowsProcessed: 0, periodsCreated: 0, errors: 0 };
    }
    console.log(`[extendRecurringOutflowPeriods] Maintaining ${activeOutflowsSnapshot.size} active outflows`);
    const endDate = new Date(now);
    endDate.setUTCMonth(endDate.getUTCMonth() + MONTHS_FORWARD);
    let outflowsProcessed = 0;
    let periodsCreated = 0;
    let errors = 0;
    for (const outflowDoc of activeOutflowsSnapshot.docs) {
        try {
            const created = await extendOutflowPeriodsFor(db, outflowDoc, endDate);
            outflowsProcessed++;
            periodsCreated += created;
        }
        catch (error) {
            errors++;
            console.error(`[extendRecurringOutflowPeriods] Failed to extend outflow ${outflowDoc.id}: ` +
                `${error instanceof Error ? error.message : "Unknown error"}`);
        }
    }
    console.log(JSON.stringify({
        severity: "INFO",
        message: "Outflow period extension completed",
        outflowsProcessed,
        periodsCreated,
        errors,
        monthsForward: MONTHS_FORWARD,
    }));
    return { outflowsProcessed, periodsCreated, errors };
}
exports.extendRecurringOutflowPeriods = (0, scheduler_1.onSchedule)({
    // eslint-disable-next-line @typescript-eslint/naming-convention
    schedule: "0 3 1 * *", // 03:00 UTC on the 1st of each month
    timeZone: "UTC",
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 540,
}, async () => {
    console.log("[extendRecurringOutflowPeriods] Starting scheduled outflow period extension...");
    await run_outflow_period_extension(admin.firestore());
});
/**
 * Extend ONE outflow's materialized periods to `endDate` (the per-outflow body of the monthly job;
 * exported for tests). Returns the number of periods created.
 *
 * Look-back: re-covers LOOKBACK_DAYS before the latest period's end (never before the bill's first
 * date) and skips periods that already exist (`skip_existing`), so existing paid periods are never
 * overwritten.
 *
 * Removal windows (Convert-To-Recurring X20 / D27): a bill can be kept active while it is removed,
 * paused or ENDED going forward ("It ended" = a removal interval). `createOutflowPeriodsFromSource`
 * creates every new period with the intervals already applied (the same month rule
 * `apply_period_suppression` and the derive use, old and v2 records alike), so nothing is flipped
 * afterwards — the stored periods never drift from the derive.
 */
async function extendOutflowPeriodsFor(db, outflowDoc, endDate) {
    var _a, _b;
    const outflow = outflowDoc.data();
    // Find ONLY the latest existing period (1 read) — the forward watermark. This is what
    // keeps the job off the full-collection scan.
    const latestSnapshot = await db
        .collection("outflow_periods")
        .where("outflowId", "==", outflowDoc.id)
        .orderBy("periodEndDate", "desc")
        .limit(1)
        .get();
    let startDate;
    if (latestSnapshot.empty) {
        // No periods yet (rare for an active outflow) — materialize from its first occurrence.
        startDate = outflow.firstDate.toDate();
    }
    else {
        // Look back from the latest period's end (see LOOKBACK_DAYS), never before the bill began.
        const latestEnd = latestSnapshot.docs[0].data().periodEndDate.toDate();
        startDate = new Date(start_of_utc_day(latestEnd).getTime() - LOOKBACK_DAYS * DAY_MS);
        const first = (_b = (_a = outflow.firstDate) === null || _a === void 0 ? void 0 : _a.toDate) === null || _b === void 0 ? void 0 : _b.call(_a);
        if (first && start_of_utc_day(first) > startDate)
            startDate = start_of_utc_day(first);
    }
    // Already covered to the horizon — nothing to add for this outflow.
    if (startDate >= endDate) {
        return 0;
    }
    // Creation applies the removal windows itself (no second pass over the bill's periods).
    const result = await (0, createOutflowPeriods_1.createOutflowPeriodsFromSource)(db, outflowDoc.id, outflow, startDate, endDate, { skip_existing: true });
    return result.periodsCreated;
}
//# sourceMappingURL=extendRecurringOutflowPeriods.js.map