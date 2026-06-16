"use strict";
/**
 * Audit Transaction Assignments (read-only diagnostic)
 *
 * Dry-runs the Transaction Assignment Engine's pure category/budget matching
 * over EVERY active split and logs the ones whose CURRENT budget differs from
 * their natural category-home (the budget the engine would pick from category +
 * date alone, IGNORING any manual pin). This surfaces:
 *   - splits stuck in "Everything Else" whose category actually belongs to a
 *     real budget, and
 *   - whether each such split is a MANUAL PIN (budgetAssignmentSource ===
 *     "manual") — which the engine deliberately honors, so it will NOT re-home
 *     on its own.
 *
 * READ-ONLY: never writes. Logs one JSON line per mismatch (severity WARNING)
 * plus a summary line (severity NOTICE), so it stays well under log limits.
 *
 * Trigger (dev):
 *   GET https://us-central1-<project>.cloudfunctions.net/auditTransactionAssignments?userId=<uid>
 *
 * @module admin/auditTransactionAssignments
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.auditTransactionAssignments = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const match_budget_service_1 = require("../domain/transactions/match_budget.service");
const match_category_service_1 = require("../domain/transactions/match_category.service");
const job_queue_1 = require("../infrastructure/job_queue");
const observability_1 = require("../observability");
/* eslint-disable @typescript-eslint/naming-convention */
exports.auditTransactionAssignments = (0, https_1.onRequest)({ region: "us-central1", memory: "512MiB", timeoutSeconds: 120 }, async (req, res) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s;
    const userId = req.query.userId ||
        ((_a = req.body) === null || _a === void 0 ? void 0 : _a.userId);
    if (!userId) {
        res.status(400).json({ success: false, error: "userId is required" });
        return;
    }
    const db = (0, firestore_1.getFirestore)();
    // 1. Budgets (real + Everything Else), reduced to the matcher's shape.
    const budgetsSnap = await db
        .collection("budgets")
        .where("userId", "==", userId)
        .where("isActive", "==", true)
        .get();
    const realBudgets = [];
    const budgetNames = new Map();
    let everythingElseId = null;
    for (const doc of budgetsSnap.docs) {
        const d = doc.data();
        budgetNames.set(doc.id, (_b = d.name) !== null && _b !== void 0 ? _b : "(unnamed)");
        if (d.isSystemEverythingElse) {
            everythingElseId = doc.id;
            continue;
        }
        const endTs = ((_c = d.budgetEndDate) !== null && _c !== void 0 ? _c : d.endDate);
        realBudgets.push({
            id: doc.id,
            category_ids: (_d = d.categoryIds) !== null && _d !== void 0 ? _d : [],
            start_ms: d.startDate.toMillis(),
            end_ms: d.isOngoing ? null : (_e = endTs === null || endTs === void 0 ? void 0 : endTs.toMillis()) !== null && _e !== void 0 ? _e : null,
            is_ongoing: !!d.isOngoing,
        });
    }
    // 2. Category upgrade rules (merchant / keyword), keyed by detailed enum.
    const catSnap = await db
        .collection("categories")
        .where("isActive", "==", true)
        .get();
    const categoryRules = catSnap.docs.map((doc) => {
        var _a, _b;
        const c = doc.data();
        return {
            category: doc.id,
            merchants: (_a = c.merchants) !== null && _a !== void 0 ? _a : [],
            keywords: (_b = c.keywords) !== null && _b !== void 0 ? _b : [],
        };
    });
    // 3. All of the user's transactions.
    const txnSnap = await db
        .collection("transactions")
        .where("userId", "==", userId)
        .get();
    let totalTxns = 0;
    let totalSplits = 0;
    let mismatches = 0;
    let pinnedMismatches = 0;
    let noDate = 0;
    for (const doc of txnSnap.docs) {
        const d = doc.data();
        if (d.isActive === false) {
            continue;
        }
        totalTxns++;
        const txnDate = ((_f = d.transactionDate) !== null && _f !== void 0 ? _f : d.dateTransacted);
        if (!(txnDate === null || txnDate === void 0 ? void 0 : txnDate.toMillis)) {
            noDate++;
            continue;
        }
        const txnDateMs = txnDate.toMillis();
        const merchant = (_g = d.merchantName) !== null && _g !== void 0 ? _g : null;
        const name = (_h = d.name) !== null && _h !== void 0 ? _h : null;
        const splits = (_j = d.splits) !== null && _j !== void 0 ? _j : [];
        for (const s of splits) {
            totalSplits++;
            const plaidCat = (_k = s.plaidDetailedCategory) !== null && _k !== void 0 ? _k : "OTHER_EXPENSE";
            const internalCat = (_l = s.internalDetailedCategory) !== null && _l !== void 0 ? _l : null;
            const currentBudget = (_m = s.budgetId) !== null && _m !== void 0 ? _m : "unassigned";
            const source = (_o = s.budgetAssignmentSource) !== null && _o !== void 0 ? _o : "category";
            // Effective category (may upgrade OTHER_EXPENSE via merchant/keyword).
            const resolvedCat = (0, match_category_service_1.match_category)({ plaid_match_category: plaidCat, merchant_name: merchant, name }, categoryRules).category;
            // Natural category-home, IGNORING any manual pin.
            const natural = (0, match_budget_service_1.match_budget)({ internal_match_category: internalCat, plaid_match_category: resolvedCat }, txnDateMs, realBudgets, everythingElseId);
            if (natural.budget_id !== currentBudget) {
                mismatches++;
                if (source === "manual") {
                    pinnedMismatches++;
                }
                console.log(JSON.stringify({
                    severity: "WARNING",
                    message: "split misplaced vs category-home",
                    userId,
                    transaction_id: doc.id,
                    merchant: merchant !== null && merchant !== void 0 ? merchant : name,
                    txn_date: new Date(txnDateMs).toISOString().slice(0, 10),
                    split_id: (_p = s.splitId) !== null && _p !== void 0 ? _p : null,
                    plaidDetailedCategory: plaidCat,
                    internalDetailedCategory: internalCat,
                    resolved_category: resolvedCat,
                    current_budget: currentBudget,
                    current_budget_name: (_q = budgetNames.get(currentBudget)) !== null && _q !== void 0 ? _q : null,
                    current_source: source,
                    expected_budget: natural.budget_id,
                    expected_budget_name: (_r = budgetNames.get(natural.budget_id)) !== null && _r !== void 0 ? _r : null,
                    expected_reason: natural.reason,
                    pinned: source === "manual",
                }));
            }
        }
    }
    // Opt-in repair: enqueue the assignment backfill for this user. Re-runs the
    // engine on EVERY transaction; un-pinned splits re-home to their category
    // budgets. Manual pins (pinnedMismatches) are intentionally left in place.
    const fix = req.query.fix === "true" || ((_s = req.body) === null || _s === void 0 ? void 0 : _s.fix) === true;
    let backfillEnqueued = false;
    if (fix) {
        const trace_id = (0, observability_1.generate_id)();
        await (0, job_queue_1.create_job)("backfill_assignments", { user_id: userId }, { trace_id });
        backfillEnqueued = true;
        console.log(JSON.stringify({
            severity: "NOTICE",
            message: "backfill enqueued from audit",
            userId,
            trace_id,
        }));
    }
    const summary = {
        severity: "NOTICE",
        message: "audit summary",
        userId,
        realBudgets: realBudgets.length,
        everythingElseId,
        totalTxns,
        totalSplits,
        mismatches,
        pinnedMismatches,
        categoryMismatches: mismatches - pinnedMismatches,
        txnsMissingDate: noDate,
        backfillEnqueued,
    };
    console.log(JSON.stringify(summary));
    res.status(200).json(Object.assign({ success: true }, summary));
});
/* eslint-enable @typescript-eslint/naming-convention */
//# sourceMappingURL=auditTransactionAssignments.js.map