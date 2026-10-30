"use strict";
/**
 * Update Budget Period Amount
 *
 * Callable behind the budget period amount editor. Every mode is defined against THE period
 * page's allocation rule (domain/budgets/period_allocation_view): the page builds every view's
 * allocation from the budget's MONTHLY `budget_periods` docs, so that is where edits land.
 *
 * - 'this_period' ("This Period Only"), any budget cadence, any edited period type: the page's
 *   current amount for the edited period (excluding its own earlier adjustment) is compared with
 *   the typed amount and the difference is stored as ONE adjustment
 *   `{ periodId, startMs, endMs, amount }` in `periodAdjustments` on the monthly doc(s) the
 *   period overlaps (split by overlap days, cents-exact, when it spans two months). Re-editing the
 *   same period REPLACES its adjustment (sets, never accumulates). The edited period's own doc
 *   gets `hasPeriodAdjustment` — the app's "custom amount" marker (a separate field, NOT
 *   `isModified`, so the legacy modifiedAmount sync trigger never fires and a stale legacy
 *   `modifiedAmount` can't be revived).
 * - `reset: true` ("Reset to Original"): removes the edited period's adjustment(s) and clears a
 *   legacy `modifiedAmount` / `isModified` on the edited doc.
 * - 'all_forward' ("All Periods Forward"): the budget's amount becomes typed ÷ the edited
 *   period's page share (domain/budgets/period_share), every override / adjustment from the edited
 *   period on is cleared, and the periods are re-allocated with the shared domain
 *   `compute_reallocated_periods` — so the edited period then shows what was typed.
 *
 * Past periods (ended before today, UTC) can't be edited. Every write path bumps the owner's
 * derive version AFTER writing (derive caches live 24h).
 *
 * Memory: 512MiB, Timeout: 60s
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
exports.updateBudgetPeriodAmount = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("../../../../types");
const auth_1 = require("../../../../utils/auth");
const observability_1 = require("../../../observability");
const sharing_1 = require("../../../repositories/sharing");
const budget_period_repo_1 = require("../../../repositories/budget_period.repo");
const derive_version_repo_1 = require("../../../repositories/derive_version.repo");
const job_queue_1 = require("../../../infrastructure/job_queue");
const budget_view_service_1 = require("../../../domain/sharing/budget_view.service");
const period_share_service_1 = require("../../../domain/budgets/period_share.service");
const period_override_service_1 = require("../../../domain/budgets/period_override.service");
const period_allocation_view_service_1 = require("../../../domain/budgets/period_allocation_view.service");
const period_generation_service_1 = require("../../../domain/budgets/period_generation.service");
const COLLECTION = "budget_periods";
const DAY_MS = 86400000;
// ============================================================================
// HELPERS
// ============================================================================
/** Today's date at midnight UTC, epoch ms. */
function today_utc_ms() {
    const now = new Date();
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}
/** Past = the period ended before today (UTC). */
function is_past_period(period_end) {
    return period_end.toMillis() < today_utc_ms();
}
const ms_of = (v) => v.toMillis();
/** The stored adjustments on a doc (malformed entries dropped). */
function stored_adjustments(data) {
    var _a;
    const raw = (_a = data.periodAdjustments) !== null && _a !== void 0 ? _a : [];
    return raw.filter((a) => a &&
        typeof a.periodId === "string" &&
        typeof a.startMs === "number" &&
        typeof a.endMs === "number" &&
        typeof a.amount === "number");
}
/** A monthly doc as THE page reads it (base amounts + adjustments), minus one periodId's. */
function to_monthly_for_derivation(data, exclude_period_id) {
    var _a, _b, _c;
    const base = (_b = (_a = (0, period_override_service_1.direct_period_override)(data)) !== null && _a !== void 0 ? _a : data.allocatedAmount) !== null && _b !== void 0 ? _b : 0;
    const rolled = (_c = data.rolledOverAmount) !== null && _c !== void 0 ? _c : 0;
    return {
        allocated_amount: base,
        effective_amount: base + rolled,
        start_ms: ms_of(data.periodStart),
        end_ms: ms_of(data.periodEnd),
        adjustments: stored_adjustments(data)
            .filter((a) => a.periodId !== exclude_period_id)
            .map((a) => ({
            period_id: a.periodId,
            start_ms: a.startMs,
            end_ms: a.endMs,
            amount: a.amount,
        })),
    };
}
/** `remaining` for a doc once `changes` are applied (allocation incl. adjustments + rollover). */
function remaining_after(data, changes) {
    var _a, _b;
    const next = Object.assign(Object.assign({}, data), changes);
    const rolled = (_a = next.rolledOverAmount) !== null && _a !== void 0 ? _a : 0;
    const spent = (_b = next.spent) !== null && _b !== void 0 ? _b : 0;
    return (0, period_allocation_view_service_1.round2)((0, period_override_service_1.period_allocation)(next) + rolled - spent);
}
/** Months (by UTC day) of [start, end] no monthly doc covers, as "YYYY-MM". */
function uncovered_months(start_ms, end_ms, months) {
    const missing = new Set();
    for (let day = (0, period_allocation_view_service_1.utc_day_index)(start_ms); day <= (0, period_allocation_view_service_1.utc_day_index)(end_ms); day++) {
        const covered = months.some((m) => (0, period_allocation_view_service_1.utc_day_index)(ms_of(m.periodStart)) <= day && (0, period_allocation_view_service_1.utc_day_index)(ms_of(m.periodEnd)) >= day);
        if (!covered)
            missing.add(new Date(day * DAY_MS).toISOString().slice(0, 7));
    }
    return [...missing];
}
// ============================================================================
// MAIN FUNCTION
// ============================================================================
exports.updateBudgetPeriodAmount = (0, https_1.onCall)({
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 60,
}, async (request) => {
    var _a;
    const { budgetPeriodId, cascadeScope } = request.data;
    const reset = request.data.reset === true;
    const warnings = [];
    try {
        // ========================================================================
        // VALIDATION
        // ========================================================================
        if (!budgetPeriodId) {
            throw new https_1.HttpsError("invalid-argument", "budgetPeriodId is required");
        }
        const raw_amount = request.data.newAmount;
        if (!reset) {
            if (typeof raw_amount !== "number" || !Number.isFinite(raw_amount)) {
                throw new https_1.HttpsError("invalid-argument", "newAmount must be a valid number");
            }
            if (raw_amount < 0) {
                throw new https_1.HttpsError("invalid-argument", "newAmount cannot be negative");
            }
            if (!cascadeScope || !["this_period", "all_forward"].includes(cascadeScope)) {
                throw new https_1.HttpsError("invalid-argument", "cascadeScope must be \"this_period\" or \"all_forward\"");
            }
        }
        const new_amount = (0, period_allocation_view_service_1.round2)(raw_amount !== null && raw_amount !== void 0 ? raw_amount : 0);
        // ========================================================================
        // AUTHENTICATION
        // ========================================================================
        const { user, userData } = await (0, auth_1.authenticateRequest)(request, types_1.UserRole.VIEWER);
        if (!user || !userData) {
            throw new https_1.HttpsError("unauthenticated", "Authentication required");
        }
        const db = admin.firestore();
        console.log(`[updateBudgetPeriodAmount] User ${user.uid} period ${budgetPeriodId}: ` +
            (reset ? "reset" : `$${new_amount} (scope: ${cascadeScope})`));
        // ========================================================================
        // GET BUDGET PERIOD & BUDGET
        // ========================================================================
        const periodDoc = await db.collection(COLLECTION).doc(budgetPeriodId).get();
        if (!periodDoc.exists) {
            throw new https_1.HttpsError("not-found", "Budget period not found");
        }
        const period = Object.assign({ id: periodDoc.id }, periodDoc.data());
        const budgetDoc = await db.collection("budgets").doc(period.budgetId).get();
        if (!budgetDoc.exists) {
            throw new https_1.HttpsError("not-found", "Parent budget not found");
        }
        const budget = Object.assign({ id: budgetDoc.id }, budgetDoc.data());
        // Ownership: the parent budget's CURRENT view (userId) — the caller's Me, or a group
        // they're in (Account-Rooted-Sharing PD6). Not createdBy, and no role bypass: every
        // user is an EDITOR, so a role check let anyone edit anyone's period. The admin SDK
        // skips rules, so this is the only guard.
        const owner_key = (_a = budget.userId) !== null && _a !== void 0 ? _a : "";
        const owner_gid = (0, budget_view_service_1.group_id_of_key)(owner_key);
        const owner_group = owner_gid
            ? await sharing_1.group_repo.get((0, observability_1.create_trace_context)(false), owner_gid)
            : null;
        if (period.budgetId !== budget.id || !(0, budget_view_service_1.can_manage_budget)(owner_key, user.uid, owner_group)) {
            throw new https_1.HttpsError("not-found", "Budget period not found");
        }
        if (is_past_period(period.periodEnd)) {
            throw new https_1.HttpsError("failed-precondition", "Cannot edit past/historical periods. Only current and future periods can be modified.");
        }
        if (budget.isSystemEverythingElse) {
            throw new https_1.HttpsError("failed-precondition", "Cannot edit \"Everything Else\" system budget");
        }
        const spent = period.spent || 0;
        if (!reset && new_amount < spent) {
            warnings.push(`Warning: New amount ($${new_amount.toFixed(2)}) is less than spent ` +
                `($${spent.toFixed(2)}). This will show as overspent.`);
        }
        // ========================================================================
        // EXECUTE UPDATE
        // ========================================================================
        let periodsUpdated = 0;
        let budgetUpdated = false;
        if (reset || cascadeScope === "this_period") {
            periodsUpdated = await set_this_period_amount(db, period, reset ? null : new_amount);
        }
        else {
            periodsUpdated = await set_all_periods_forward(db, budget.id, period, new_amount);
            budgetUpdated = true;
        }
        // Derive caches live 24h — invalidate AFTER the writes landed (`periodAdjustments` isn't a
        // field the period-edit trigger watches, so nothing else bumps for it).
        await (0, derive_version_repo_1.bump_derive_version)(owner_key).catch(() => { });
        // The amount changed → a rollover budget's chain (allocation − spent carried forward) is
        // stale. Same async, deduped recompute the spend pipeline enqueues. Non-fatal.
        if (budget.rolloverEnabled) {
            await (0, job_queue_1.create_job_if_not_exists)("recalculate_rollover", { user_id: owner_key, budget_id: budget.id, deduplication_key: budget.id }, { trace_id: `update_budget_period_amount_${budget.id}` }).catch((e) => console.error("[updateBudgetPeriodAmount] rollover enqueue failed:", e));
        }
        console.log(`[updateBudgetPeriodAmount] ✓ ${periodsUpdated} periods updated, budget updated: ` +
            `${budgetUpdated}`);
        return { success: true, periodsUpdated, budgetUpdated, warnings };
    }
    catch (error) {
        console.error("[updateBudgetPeriodAmount] Error:", error);
        if (error instanceof https_1.HttpsError) {
            throw error;
        }
        const message = error === null || error === void 0 ? void 0 : error.message;
        throw new https_1.HttpsError("internal", message || "Failed to update budget period amount");
    }
});
// ============================================================================
// THIS PERIOD ONLY / RESET
// ============================================================================
/**
 * "This Period Only" (`new_amount`) or "Reset to Original" (`null`) for the edited period, any
 * type, any budget cadence — in ONE transaction (the monthly docs are re-read inside it).
 * Returns the number of docs written.
 */
async function set_this_period_amount(db, period, new_amount) {
    const start_ms = period.periodStart.toMillis();
    const end_ms = period.periodEnd.toMillis();
    const edited_pid = period.periodId || period.sourcePeriodId;
    const edited_ref = db.collection(COLLECTION).doc(period.id);
    const months_query = db
        .collection(COLLECTION)
        .where("budgetId", "==", period.budgetId)
        .where("periodType", "==", "monthly");
    return db.runTransaction(async (tx) => {
        const edited_snap = await tx.get(edited_ref);
        const months_snap = await tx.get(months_query);
        if (!edited_snap.exists) {
            throw new https_1.HttpsError("not-found", "Budget period not found");
        }
        const edited = edited_snap.data();
        // The budget's monthly docs the edited period overlaps (derive's home for every view).
        const months = months_snap.docs.filter((d) => {
            const m = d.data();
            return (0, period_allocation_view_service_1.overlap_days)(ms_of(m.periodStart), ms_of(m.periodEnd), start_ms, end_ms) > 0;
        });
        // Every changed doc's fields, merged per doc id (the edited doc may be a monthly one).
        const writes = new Map();
        const write = (ref, data) => {
            var _a;
            const cur = writes.get(ref.id);
            writes.set(ref.id, { ref, data: Object.assign(Object.assign({}, ((_a = cur === null || cur === void 0 ? void 0 : cur.data) !== null && _a !== void 0 ? _a : {})), data) });
        };
        const now = firestore_1.Timestamp.now();
        let parts = [];
        if (new_amount !== null) {
            const missing = uncovered_months(start_ms, end_ms, months.map((d) => d.data()));
            if (missing.length > 0) {
                throw new https_1.HttpsError("failed-precondition", `This budget has no monthly period for ${missing.join(", ")} yet, so this period's ` +
                    "amount can't be set. Try again after its periods are generated.");
            }
            // What the page shows for this period now, without this period's own earlier adjustment.
            const current = (0, period_allocation_view_service_1.bucket_allocation)(months.map((d) => to_monthly_for_derivation(d.data(), edited_pid)), start_ms, end_ms).allocated;
            const delta = (0, period_allocation_view_service_1.round2)(new_amount - current);
            if (delta !== 0) {
                parts = (0, period_allocation_view_service_1.split_adjustment_by_month)(edited_pid, start_ms, end_ms, delta, months.map((d) => ({
                    start_ms: ms_of(d.data().periodStart),
                    end_ms: ms_of(d.data().periodEnd),
                })));
            }
            console.log(`[updateBudgetPeriodAmount] This Period Only ${edited_pid}: page $${current} → ` +
                `$${new_amount} (adjustment ${delta} over ${parts.length} month(s))`);
        }
        // Replace this period's adjustment on every monthly doc it overlaps (sets, never accumulates).
        months.forEach((d, i) => {
            const data = d.data();
            const existing = stored_adjustments(data);
            const kept = existing.filter((a) => a.periodId !== edited_pid);
            /* eslint-disable @typescript-eslint/naming-convention */
            const added = parts
                .filter((p) => p.month_index === i)
                .map((p) => ({
                periodId: p.adjustment.period_id,
                startMs: p.adjustment.start_ms,
                endMs: p.adjustment.end_ms,
                amount: p.adjustment.amount,
            }));
            /* eslint-enable @typescript-eslint/naming-convention */
            if (kept.length === existing.length && added.length === 0)
                return;
            const next = [...kept, ...added];
            /* eslint-disable @typescript-eslint/naming-convention */
            const changes = { periodAdjustments: next };
            write(d.ref, {
                periodAdjustments: next.length > 0 ? next : firestore_1.FieldValue.delete(),
                remaining: remaining_after(data, changes),
                updatedAt: now,
            });
            /* eslint-enable @typescript-eslint/naming-convention */
        });
        // The edited doc: the "custom" marker (+ on reset, clear a legacy override).
        /* eslint-disable @typescript-eslint/naming-convention */
        if (new_amount !== null) {
            // (Never `isModified` / `lastModifiedAt`: those decide whether a legacy `modifiedAmount`
            // on the doc counts — direct_period_override — and `isModified` fires the legacy sync.)
            write(edited_ref, { hasPeriodAdjustment: parts.length > 0, updatedAt: now });
        }
        else {
            const clear = { hasPeriodAdjustment: false, updatedAt: now };
            if (edited.modifiedAmount !== undefined || edited.isModified === true) {
                // Legacy "This Period Only" on the doc itself.
                clear.modifiedAmount = firestore_1.FieldValue.delete();
                clear.isModified = false;
            }
            write(edited_ref, clear);
        }
        /* eslint-enable @typescript-eslint/naming-convention */
        for (const { ref, data } of writes.values()) {
            tx.update(ref, data);
        }
        return writes.size;
    });
}
// ============================================================================
// ALL PERIODS FORWARD
// ============================================================================
/**
 * "All Periods Forward", in ONE Firestore transaction that re-reads the budget and its periods
 * (so a "This Period Only" landing meanwhile is never overwritten, and a failure leaves nothing
 * half-written — the transaction is all-or-nothing and retried on contention):
 *  - budget amount = typed ÷ the edited period's page share;
 *  - "forward" resets custom amounts: every legacy override on a period ending in / after the
 *    edited period's month, and every adjustment reaching that month (all of a straddling
 *    period's parts together), are cleared;
 *  - periods are re-allocated with the shared domain rule (as process_budget_updated does), and
 *    the adjustments it does NOT clear (earlier custom periods inside the re-allocated range) are
 *    rebased so they keep showing what the user typed (rebase_reallocated_periods).
 * Only the fields that change are written. Returns the number of period docs written.
 */
async function set_all_periods_forward(db, budget_id, period, new_amount) {
    const start_ms = period.periodStart.toMillis();
    const edited_start_day_ms = (0, period_allocation_view_service_1.utc_day_index)(start_ms) * DAY_MS;
    const sd = new Date(edited_start_day_ms);
    const month_start_ms = Date.UTC(sd.getUTCFullYear(), sd.getUTCMonth(), 1);
    // Cutoff = the start of the edited period's month — "forward" from the period edited, never
    // earlier months (editing June on Mar 15 leaves March–May as they are). The page spreads each
    // monthly home evenly over its days, so every prime feeding the edited period's month (e.g.
    // this month's weeks that already ended) must take the new amount or the edited period shows
    // a blend. (The budget write below only bumps the derive version via on_budget_written;
    // process_budget_updated is not enqueued by this callable.)
    const cutoff = firestore_1.Timestamp.fromMillis(month_start_ms);
    const budget_ref = db.collection("budgets").doc(budget_id);
    const periods_query = db.collection(COLLECTION).where("budgetId", "==", budget_id);
    return db.runTransaction(async (tx) => {
        var _a, _b;
        const budget_snap = await tx.get(budget_ref);
        const snap = await tx.get(periods_query);
        if (!budget_snap.exists)
            throw new https_1.HttpsError("not-found", "Parent budget not found");
        const budget = budget_snap.data();
        const cadence = String(budget.period || "monthly").toLowerCase();
        const share = (0, period_share_service_1.page_share)(start_ms, period.periodEnd.toMillis(), cadence);
        const new_budget_amount = share > 0 ? (0, period_allocation_view_service_1.round2)(new_amount / share) : new_amount;
        console.log(`[updateBudgetPeriodAmount] All Periods Forward ${period.periodId}: share ` +
            `${share.toFixed(6)} → budget $${budget.amount} → $${new_budget_amount}`);
        // Every period whose adjustment reaches the edited period's month.
        const cleared_pids = new Set();
        for (const d of snap.docs) {
            for (const a of stored_adjustments(d.data())) {
                if (a.endMs >= month_start_ms)
                    cleared_pids.add(a.periodId);
            }
        }
        // 1. The clears — per doc, only the fields that change; `after` = the doc once cleared.
        const changes = new Map();
        const after = new Map();
        const change = (id, fields) => {
            var _a;
            changes.set(id, Object.assign(Object.assign({}, ((_a = changes.get(id)) !== null && _a !== void 0 ? _a : {})), fields));
        };
        /* eslint-disable @typescript-eslint/naming-convention */
        for (const d of snap.docs) {
            const data = d.data();
            const next = Object.assign({}, data);
            const in_or_after_month = ms_of(data.periodEnd) >= month_start_ms;
            if (in_or_after_month && (data.modifiedAmount != null || data.isModified === true)) {
                change(d.id, { modifiedAmount: firestore_1.FieldValue.delete(), isModified: false });
                delete next.modifiedAmount;
                next.isModified = false;
            }
            const adjustments = stored_adjustments(data);
            const kept = adjustments.filter((a) => !cleared_pids.has(a.periodId));
            if (kept.length !== adjustments.length) {
                change(d.id, { periodAdjustments: kept.length > 0 ? kept : firestore_1.FieldValue.delete() });
                next.periodAdjustments = kept;
            }
            const pid = String((_a = data.periodId) !== null && _a !== void 0 ? _a : "");
            if (data.hasPeriodAdjustment === true && (in_or_after_month || cleared_pids.has(pid))) {
                change(d.id, { hasPeriodAdjustment: false });
            }
            after.set(d.id, next);
        }
        /* eslint-enable @typescript-eslint/naming-convention */
        // 2. Re-allocate with the shared domain rule, rebasing the adjustments that remain.
        const computed = (0, period_generation_service_1.compute_reallocated_periods)({
            new_amount: new_budget_amount,
            budget_cadence: (0, period_generation_service_1.budget_cadence_to_instance)(cadence),
            cutoff,
            periods: snap.docs.map((d) => {
                var _a, _b, _c, _d;
                const data = d.data();
                return {
                    id: d.id,
                    period_id: String((_a = data.periodId) !== null && _a !== void 0 ? _a : ""),
                    period_type: data.periodType,
                    start_date: data.periodStart,
                    end_date: data.periodEnd,
                    spent: (_b = data.spent) !== null && _b !== void 0 ? _b : 0,
                    rolled_over_amount: (_c = data.rolledOverAmount) !== null && _c !== void 0 ? _c : 0,
                    daily_rate: (_d = data.dailyRate) !== null && _d !== void 0 ? _d : 0,
                };
            }),
        });
        if (computed.validation_errors) {
            throw new https_1.HttpsError("invalid-argument", computed.validation_errors.join("; "));
        }
        const updates = (0, period_allocation_view_service_1.rebase_reallocated_periods)(snap.docs.map((d) => {
            var _a, _b, _c, _d;
            const data = after.get(d.id);
            return {
                id: d.id,
                start_ms: ms_of(data.periodStart),
                end_ms: ms_of(data.periodEnd),
                override: (0, period_override_service_1.direct_period_override)(data),
                allocated_amount: (_a = data.allocatedAmount) !== null && _a !== void 0 ? _a : 0,
                adjustments: (_b = to_monthly_for_derivation(data, "").adjustments) !== null && _b !== void 0 ? _b : [],
                rolled_over_amount: (_c = data.rolledOverAmount) !== null && _c !== void 0 ? _c : 0,
                spent: (_d = data.spent) !== null && _d !== void 0 ? _d : 0,
            };
        }), (_b = computed.entities) !== null && _b !== void 0 ? _b : []);
        const now = firestore_1.Timestamp.now();
        for (const u of updates)
            change(u.id, (0, budget_period_repo_1.allocation_update_fields)(u, now));
        // 3. Write: the budget's new normal amount + each changed period, atomically.
        /* eslint-disable @typescript-eslint/naming-convention */
        tx.update(budget_ref, {
            amount: new_budget_amount,
            remaining: new_budget_amount - (budget.spent || 0),
            updatedAt: now,
        });
        for (const d of snap.docs) {
            const fields = changes.get(d.id);
            if (fields)
                tx.update(d.ref, Object.assign(Object.assign({}, fields), { updatedAt: now }));
        }
        /* eslint-enable @typescript-eslint/naming-convention */
        return changes.size;
    });
}
//# sourceMappingURL=updateBudgetPeriodAmount.js.map