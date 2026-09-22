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
const scheduler_1 = require("firebase-functions/v2/scheduler");
const admin = __importStar(require("firebase-admin"));
const createOutflowPeriods_1 = require("../crud/createOutflowPeriods");
/** How far ahead to keep outflow periods materialized (matches onOutflowCreated's horizon). */
const MONTHS_FORWARD = 15;
exports.extendRecurringOutflowPeriods = (0, scheduler_1.onSchedule)({
    // eslint-disable-next-line @typescript-eslint/naming-convention
    schedule: "0 3 1 * *", // 03:00 UTC on the 1st of each month
    timeZone: "UTC",
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 540,
}, async () => {
    console.log("[extendRecurringOutflowPeriods] Starting scheduled outflow period extension...");
    const db = admin.firestore();
    // All active outflows across users. (Bounded read; NOT the period collection.)
    const activeOutflowsSnapshot = await db
        .collection("outflows")
        .where("isActive", "==", true)
        .get();
    if (activeOutflowsSnapshot.empty) {
        console.log("[extendRecurringOutflowPeriods] No active outflows to maintain");
        return;
    }
    console.log(`[extendRecurringOutflowPeriods] Maintaining ${activeOutflowsSnapshot.size} active outflows`);
    const now = new Date();
    const endDate = new Date(now);
    endDate.setMonth(endDate.getMonth() + MONTHS_FORWARD);
    let outflowsProcessed = 0;
    let periodsCreated = 0;
    let errors = 0;
    for (const outflowDoc of activeOutflowsSnapshot.docs) {
        const outflow = outflowDoc.data();
        try {
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
                // Resume the day after the latest materialized period ends.
                startDate = latestSnapshot.docs[0].data().periodEndDate.toDate();
                startDate.setDate(startDate.getDate() + 1);
            }
            // Already covered to the horizon — nothing to add for this outflow.
            if (startDate >= endDate) {
                outflowsProcessed++;
                continue;
            }
            const result = await (0, createOutflowPeriods_1.createOutflowPeriodsFromSource)(db, outflowDoc.id, outflow, startDate, endDate);
            outflowsProcessed++;
            periodsCreated += result.periodsCreated;
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
});
//# sourceMappingURL=extendRecurringOutflowPeriods.js.map