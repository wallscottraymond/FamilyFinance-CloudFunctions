"use strict";
/**
 * Split edit — what a split edit from the app turns into, before it's written (PURE).
 *
 *   - Each incoming split is MERGED onto the stored split with the same id: the app re-sends the
 *     whole array, and an older build may leave fields out (spendStatus, tags, tax flag, a manual
 *     bill pin, per-lens budgets) — omission must never erase them.
 *   - Fields only the ENGINE sets (per-lens budgets + names + sources, source periods, auto bill /
 *     income links, the legacy budget alias) always come from the STORED split: the app echoes
 *     whatever it last read, which may be older than a re-assign that landed since. From the app
 *     we take only the user's intents — a new budget pin, and status / amount / tags / notes / tax
 *     flag (bill pins go through `assign_split_to_outflow`; a new budget pin takes the split off a
 *     manually pinned bill — canon A4). A new split takes the app's fields
 *     (the engine runs on it).
 *   - Category fields come from the one edit rule (split_category_edit: pick / "use auto" / an old
 *     build's bare categoryId; Plaid codes immutable; `internal*` null).
 *   - Totals + the refund / ignored summaries are recomputed from the final splits.
 *   - `assignment_relevant`: did anything the assignment engine decides on change (split set,
 *     category, amount, budget / bill pins)? A status / note edit doesn't — it only moves spend.
 *   - `category_changed`: a category moved (it can form or break a matched transfer pair).
 *
 * @module domain/transactions/split_edit
 */
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.build_split_edit = build_split_edit;
const budget_spend_service_1 = require("../budgets/budget_spend.service");
const split_category_edit_service_1 = require("./split_category_edit.service");
const id_of = (s) => (s.splitId || s.id || "");
const category_key = (s) => { var _a, _b, _c; return `${(_a = s.categorySource) !== null && _a !== void 0 ? _a : ""}|${(_b = s.firstCategoryId) !== null && _b !== void 0 ? _b : ""}|${(_c = s.secondCategoryId) !== null && _c !== void 0 ? _c : ""}`; };
/** What the engine decides on, per split (besides the transaction's own date / account). The
 *  amount is in it: the bill / income matcher scores on the split's amount. */
const assignment_key = (s) => {
    var _a, _b, _c, _d, _e, _f;
    return [
        category_key(s),
        Math.abs(Number(s.amount) || 0).toFixed(2),
        (_a = s.budgetAssignmentSource) !== null && _a !== void 0 ? _a : "category",
        s.budgetAssignmentSource === "manual" ? (_b = s.budgetId) !== null && _b !== void 0 ? _b : "" : "",
        (_c = s.outflowAssignmentSource) !== null && _c !== void 0 ? _c : "auto",
        s.outflowAssignmentSource === "manual" ? (_d = s.outflowId) !== null && _d !== void 0 ? _d : "" : "",
        (_e = s.inflowAssignmentSource) !== null && _e !== void 0 ? _e : "auto",
        s.inflowAssignmentSource === "manual" ? (_f = s.inflowId) !== null && _f !== void 0 ? _f : "" : "",
    ].join("#");
};
const status_of = (s) => (0, budget_spend_service_1.split_spend_status)(s);
/** The engine's per-split outputs — never taken from the app for an existing split. */
const ENGINE_FIELDS = [
    "monthlyBudgetId", "weeklyBudgetId", "biWeeklyBudgetId",
    "monthlyBudgetName", "weeklyBudgetName", "biWeeklyBudgetName",
    "monthlyBudgetSource", "weeklyBudgetSource", "biWeeklyBudgetSource",
    "monthlyPeriodId", "weeklyPeriodId", "biWeeklyPeriodId",
    "budgetName", "inflowId",
];
/* eslint-disable @typescript-eslint/naming-convention */
/** Engine-owned fields from the stored split, except where the app states a user intent. */
function engine_owned_fields(split, before) {
    var _a, _b, _c, _d, _e, _f, _g;
    const out = {};
    for (const f of ENGINE_FIELDS)
        out[f] = (_a = before[f]) !== null && _a !== void 0 ? _a : null;
    // Budget: only a NEW manual pin (or a pin to a different budget) is the user's — the app sends
    // `budgetAssignmentSource: "manual"` + the budget when the user picks one. It never sends an
    // unpin, so anything else is an echo: keep the stored budget + source.
    const pin_now = split.budgetAssignmentSource === "manual";
    const pin_before = before.budgetAssignmentSource === "manual";
    if (split.budgetUnpin === true && pin_before) {
        // The user REMOVED the pin ("None" on a pinned split — canon A4: a pin lasts until the user
        // removes it): back to category matching; the engine re-decides the budget.
        out.budgetId = (_b = before.budgetId) !== null && _b !== void 0 ? _b : null;
        out.budgetAssignmentSource = "category";
    }
    else if (pin_now && (!pin_before || split.budgetId !== before.budgetId)) {
        out.budgetId = split.budgetId;
        out.budgetAssignmentSource = "manual";
    }
    else {
        out.budgetId = (_c = before.budgetId) !== null && _c !== void 0 ? _c : null;
        out.budgetAssignmentSource = (_d = before.budgetAssignmentSource) !== null && _d !== void 0 ? _d : "category";
    }
    // Bill links: pinned / detached / cleared only through `assign_split_to_outflow`; a split edit
    // never sets them — except that a NEW budget pin takes the split off its bill (canon A4: a
    // budget pin detaches recurring; the app warns "will remove it from bill tracking"). A manual
    // bill pin would otherwise win over the budget pin's detach in the engine.
    const new_budget_pin = out.budgetAssignmentSource === "manual" && !(pin_before && before.budgetId === out.budgetId);
    if (new_budget_pin && before.outflowAssignmentSource === "manual") {
        // A manual DETACH (manual + no bill) — never "auto", which would let Plaid stream membership
        // re-link it (and an existing detach stays a detach).
        out.outflowId = null;
        out.outflowAssignmentSource = "manual";
        out.outflowPinnedPeriodId = null;
    }
    else {
        out.outflowId = (_e = before.outflowId) !== null && _e !== void 0 ? _e : null;
        out.outflowAssignmentSource = (_f = before.outflowAssignmentSource) !== null && _f !== void 0 ? _f : "auto";
        out.outflowPinnedPeriodId = (_g = before.outflowPinnedPeriodId) !== null && _g !== void 0 ? _g : null;
    }
    // Income pin (Convert-To-Recurring Phase 2): set only through `assign_split_to_inflow` (which
    // checks the credit, the owner and the view) — never taken from the app. A NEW budget pin
    // detaches it (canon A4), like a bill pin.
    if (before.inflowAssignmentSource === "manual" && !new_budget_pin) {
        out.inflowAssignmentSource = "manual";
    }
    else if (before.inflowAssignmentSource === "manual") {
        out.inflowAssignmentSource = "auto";
        out.inflowId = null;
    }
    else if (before.inflowAssignmentSource !== undefined) {
        out.inflowAssignmentSource = before.inflowAssignmentSource;
    }
    return out;
}
/** A client-sent income pin is never stored: strip it from whatever the app echoed or invented. */
function without_client_inflow_pin(fields, keep) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { inflowAssignmentSource: _client } = fields, rest = __rest(fields, ["inflowAssignmentSource"]);
    void keep;
    return rest;
}
function build_split_edit(incoming, txn, catalog, user_id, now, new_id) {
    var _a;
    const stored = new Map();
    for (const s of (_a = txn.splits) !== null && _a !== void 0 ? _a : []) {
        if (id_of(s))
            stored.set(id_of(s), s);
    }
    const splits = incoming.map((split, index) => {
        var _a, _b, _c, _d;
        const split_id = id_of(split) || new_id(index);
        const before = stored.get(split_id);
        const category = (0, split_category_edit_service_1.resolve_split_category_edit)(split, before, txn, catalog);
        // The unpin flag is an instruction, not data — never stored.
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { budgetUnpin: _unpin } = split, sent = __rest(split, ["budgetUnpin"]);
        // A client-sent income pin is stripped (also from a NEW split): pins come only from the callable.
        const fields = without_client_inflow_pin(sent, before);
        if (!before)
            delete fields.inflowId; // a new split's income link is the engine's to set
        return Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({}, (before !== null && before !== void 0 ? before : {})), fields), (before ? engine_owned_fields(split, before) : {})), { splitId: split_id, id: split_id }), category), { createdAt: (_b = (_a = split.createdAt) !== null && _a !== void 0 ? _a : before === null || before === void 0 ? void 0 : before.createdAt) !== null && _b !== void 0 ? _b : now, updatedAt: now, createdBy: (_d = (_c = split.createdBy) !== null && _c !== void 0 ? _c : before === null || before === void 0 ? void 0 : before.createdBy) !== null && _d !== void 0 ? _d : user_id });
    });
    const amount = (s) => Math.abs(Number(s.amount) || 0);
    const totals = {
        isSplit: splits.length > 1,
        totalAllocated: splits.reduce((sum, s) => sum + amount(s), 0),
        returnAmount: splits.reduce((sum, s) => sum + (status_of(s) === "refund" ? amount(s) : 0), 0),
        hasRefundSplits: splits.some((s) => status_of(s) === "refund"),
        hasIgnoredSplits: splits.some((s) => status_of(s) === "ignored"),
    };
    const before_ids = [...stored.keys()].sort().join(",");
    const after_ids = splits.map(id_of).sort().join(",");
    const assignment_relevant = before_ids !== after_ids ||
        splits.some((s) => { var _a; return assignment_key(s) !== assignment_key((_a = stored.get(id_of(s))) !== null && _a !== void 0 ? _a : {}); });
    const category_changed = splits.some((s) => { var _a; return category_key(s) !== category_key((_a = stored.get(id_of(s))) !== null && _a !== void 0 ? _a : {}); });
    return { splits, totals, assignment_relevant, category_changed };
}
/* eslint-enable @typescript-eslint/naming-convention */
//# sourceMappingURL=split_edit.service.js.map