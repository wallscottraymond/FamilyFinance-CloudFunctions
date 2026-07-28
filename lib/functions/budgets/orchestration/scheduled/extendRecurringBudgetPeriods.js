"use strict";
/**
 * Scheduled Budget Period Maintenance (v2 Prime/Non-Prime generator)
 *
 * Runs monthly to maintain a rolling ~1-year window of budget periods for
 * recurring, ongoing budgets. As of 2026-07-27 this uses the SAME v2 generator
 * as budget creation (`compute_budget_periods`) instead of the legacy
 * `getPrimePeriodType` path — so prime-cadence mapping has ONE source of truth
 * and `bi_monthly` budgets extend with real bi_monthly PRIME periods (the legacy
 * path silently clamped bi_monthly → monthly).
 *
 * Safety: `budget_period_repo.save_batch` OVERWRITES (set) and would reset a
 * period's `spent`, so we persist ONLY periods that don't already exist. The
 * source-period window is widened behind `today` so the current prime is present
 * for accurate non-prime derivation at the near boundary.
 *
 * Runs on the 1st of each month at 2:00 AM UTC. Memory: 512MiB, Timeout: 300s.
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
exports.extendRecurringBudgetPeriods = void 0;
exports.run_recurring_budget_period_extension = run_recurring_budget_period_extension;
const scheduler_1 = require("firebase-functions/v2/scheduler");
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-admin/firestore");
const uuid_1 = require("uuid");
const budgets_1 = require("../../../domain/budgets");
const source_period_repo_1 = require("../../../repositories/source_period.repo");
const budget_period_repo_1 = require("../../../repositories/budget_period.repo");
const summaries_1 = require("../../../orchestrators/summaries");
/** How far BEHIND today to fetch source periods, so the current prime is present
 *  for accurate non-prime derivation at the near boundary (days). */
const WINDOW_LOOKBACK_DAYS = 45;
/** Rolling horizon ahead of today (months). */
const WINDOW_HORIZON_MONTHS = 12;
exports.extendRecurringBudgetPeriods = (0, scheduler_1.onSchedule)({
    schedule: '0 2 1 * *',
    timeZone: 'UTC',
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 300,
}, async () => {
    await run_recurring_budget_period_extension(admin.firestore(), firestore_1.Timestamp.now());
});
/**
 * Core of the scheduled extension, extracted so it can be driven directly in
 * integration tests. Returns a summary for logging/assertions.
 */
async function run_recurring_budget_period_extension(db, now) {
    var _a, _b, _c, _d;
    console.log('🚀 Starting scheduled budget period extension (v2 generator)...');
    const ctx = { trace_id: (0, uuid_1.v4)(), span_id: (0, uuid_1.v4)() };
    try {
        const recurringBudgetsSnapshot = await db
            .collection('budgets')
            .where('budgetType', '==', 'recurring')
            .where('isOngoing', '==', true)
            .where('isActive', '==', true)
            .get();
        if (recurringBudgetsSnapshot.empty) {
            console.log('✅ No recurring budgets found to maintain');
            return { budgetsProcessed: 0, totalPeriodsCreated: 0 };
        }
        console.log(`📊 Found ${recurringBudgetsSnapshot.size} recurring budgets to maintain`);
        // Rolling window: [today - lookback, today + horizon].
        const today = new Date();
        const windowStart = new Date(today);
        windowStart.setUTCDate(windowStart.getUTCDate() - WINDOW_LOOKBACK_DAYS);
        const windowEnd = new Date(today);
        windowEnd.setUTCMonth(windowEnd.getUTCMonth() + WINDOW_HORIZON_MONTHS);
        console.log(`🎯 Window: ${windowStart.toISOString()} → ${windowEnd.toISOString()}`);
        // Source periods for the window — one read, reused across every budget. The
        // v2 generator derives non-prime allocations from the primes in this set.
        const sourceEntities = await source_period_repo_1.source_period_repo.get_overlapping(ctx, firestore_1.Timestamp.fromDate(windowStart), firestore_1.Timestamp.fromDate(windowEnd));
        if (sourceEntities.length === 0) {
            console.warn('⚠️ No source periods in window — source-period generation may be needed');
            return { budgetsProcessed: 0, totalPeriodsCreated: 0 };
        }
        const source_periods = sourceEntities.map((p) => ({
            id: p.id,
            period_id: p.period_id,
            period_type: p.period_type,
            start_date: p.start_date,
            end_date: p.end_date,
        }));
        console.log(`📋 ${source_periods.length} source periods in window`);
        let totalPeriodsCreated = 0;
        let budgetsProcessed = 0;
        for (const budgetDoc of recurringBudgetsSnapshot.docs) {
            const budget = Object.assign({ id: budgetDoc.id }, budgetDoc.data());
            try {
                // Existing periods for this budget — anything already present is NOT
                // rewritten (guards `spent`/rollover).
                const existingSnap = await db
                    .collection('budget_periods')
                    .where('budgetId', '==', budget.id)
                    .get();
                const existingIds = new Set(existingSnap.docs.map((d) => d.id));
                const user_id = ((_a = budget.access) === null || _a === void 0 ? void 0 : _a.createdBy) || budget.createdBy;
                if (!user_id) {
                    console.warn(`  ⚠️ Skipping ${budget.id}: no owner (createdBy) to attribute periods`);
                    continue;
                }
                const group_ids = (_b = budget.groupIds) !== null && _b !== void 0 ? _b : (budget.groupId ? [budget.groupId] : []);
                // v2 generation — ONE cadence→prime source of truth (bi_monthly passes
                // through instead of being clamped to monthly).
                const computed = (0, budgets_1.compute_budget_periods)({
                    budget_id: budget.id,
                    user_id,
                    group_ids,
                    budget_amount: budget.amount,
                    budget_cadence: (0, budgets_1.budget_cadence_to_instance)(budget.period),
                    category_ids: (_c = budget.categoryIds) !== null && _c !== void 0 ? _c : [],
                    source_periods,
                    now,
                });
                if (computed.validation_errors) {
                    console.warn(`  ⚠️ Skipping ${budget.id}: ${computed.validation_errors.join('; ')}`);
                    continue;
                }
                // Persist ONLY periods that don't already exist (never overwrite spend).
                const newEntities = ((_d = computed.entities) !== null && _d !== void 0 ? _d : []).filter((e) => !existingIds.has(e.id));
                if (newEntities.length === 0) {
                    console.log(`  ✅ No new periods needed for ${budget.id}`);
                    budgetsProcessed++;
                    continue;
                }
                await budget_period_repo_1.budget_period_repo.save_batch(ctx, newEntities, budget.name);
                await db.collection('budgets').doc(budget.id).update({ lastExtended: now });
                console.log(`  ✅ Extended ${budget.id} with ${newEntities.length} new periods`);
                if (user_id) {
                    try {
                        await (0, summaries_1.enqueue_user_summary_updates_from_budget_periods)(ctx, user_id, newEntities.map((e) => e.id));
                    }
                    catch (summaryError) {
                        console.error(`  ⚠️ Summary enqueue failed for ${budget.id} (non-fatal):`, summaryError);
                    }
                }
                totalPeriodsCreated += newEntities.length;
                budgetsProcessed++;
            }
            catch (error) {
                console.error(`❌ Error processing budget ${budget.id}:`, error);
                // Continue with the other budgets.
            }
        }
        console.log(`🎯 Maintenance complete: ${budgetsProcessed} budgets, ${totalPeriodsCreated} periods created`);
        return { budgetsProcessed, totalPeriodsCreated };
    }
    catch (error) {
        console.error('❌ Fatal error in scheduled budget period extension:', error);
        throw error;
    }
}
//# sourceMappingURL=extendRecurringBudgetPeriods.js.map