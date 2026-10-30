"use strict";
/**
 * Convert-To-Recurring: plan a convert (and its preview) — PURE.
 *
 * The resolver loads facts (the transaction, the vendor's other payments, what already claims
 * them, the account's sharing); this decides: may it convert, what record, which past payments
 * link (D2 / D40 / D45 / D46), and what the sheet should suggest. Every refusal is a code the app
 * shows; nothing here touches IO.
 *
 * Refusals: NO_VENDOR (no usable name), NO_ACCOUNT (a manual / anonymous transaction has no Plaid
 * account), TRANSFER (an own-account move or edge money), CARD_PAYMENT (a card's "payment
 * received" credit isn't income, the classifier would hide it), PENDING (the vendor key may change
 * when it posts), ALREADY_TRACKED (a shown bill already claims it, D12 / D44), OUT_OF_VIEW (before
 * the account was shared into a group — it would count in Me while the bill is in the group view).
 *
 * @module domain/recurring/convert_plan
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.direction_of = direction_of;
exports.check_convertible = check_convertible;
exports.retro_floor_ms = retro_floor_ms;
exports.eligible_candidates = eligible_candidates;
exports.plan_convert = plan_convert;
exports.build_preview = build_preview;
const vendor_key_service_1 = require("../transactions/vendor_key.service");
const capture_rules_1 = require("./capture_rules");
const convert_recurring_service_1 = require("./convert_recurring.service");
const stream_membership_1 = require("./stream_membership");
const RETRO_BACK_MS = convert_recurring_service_1.RETRO_LINK_MONTHS * 31 * 24 * 60 * 60 * 1000;
/** The direction of money: out → bill, in → income. */
function direction_of(type) {
    if (type === "expense")
        return "outflow";
    if (type === "income")
        return "inflow";
    return null;
}
/** May this transaction be converted at all? (shared by the plan and the preview) */
function check_convertible(facts) {
    var _a, _b;
    const t = facts.txn;
    const direction = direction_of(t.type);
    if (!direction) {
        return { ok: false, code: "TRANSFER", message: "A transfer between your accounts can't be a bill or income" };
    }
    if (t.transfer_role === "internal" || (0, stream_membership_1.is_edge_money)(t.transfer_role)) {
        return { ok: false, code: "TRANSFER", message: "A transfer between your accounts can't be a bill or income" };
    }
    if (!t.vendor_key) {
        return { ok: false, code: "NO_VENDOR", message: "This transaction has no name to track" };
    }
    if (!t.account_id) {
        return { ok: false, code: "NO_ACCOUNT", message: "Only transactions from a linked account can be tracked this way" };
    }
    if (direction === "inflow" && (0, capture_rules_1.is_card_payment_inflow)(t.plaid_detailed_category)) {
        return { ok: false, code: "CARD_PAYMENT", message: "A credit-card payment received isn't income" };
    }
    if (t.is_pending) {
        return { ok: false, code: "PENDING", message: "Wait until this transaction posts, then make it a bill" };
    }
    if (facts.claimed_by) {
        return {
            ok: false, code: "ALREADY_TRACKED", message: `This is already part of ${facts.claimed_by.name}`,
            details: { id: facts.claimed_by.id, name: facts.claimed_by.name },
        };
    }
    // Before the account was shared into a group: it counts in Me while the bill lives in the group.
    const shared_from = (_b = (_a = facts.placement) === null || _a === void 0 ? void 0 : _a.shared_from_ms) !== null && _b !== void 0 ? _b : null;
    if (facts.placement && shared_from !== null && t.date_ms < shared_from) {
        return { ok: false, code: "OUT_OF_VIEW", message: "This payment is from before the account was shared" };
    }
    return null;
}
/** The date the retro-link reaches back to: 12 months, or the share date (D45) if later. */
function retro_floor_ms(facts) {
    var _a, _b;
    const back = facts.now_ms - RETRO_BACK_MS;
    const shared_from = (_b = (_a = facts.placement) === null || _a === void 0 ? void 0 : _a.shared_from_ms) !== null && _b !== void 0 ? _b : null;
    return shared_from !== null ? Math.max(back, shared_from) : back;
}
/**
 * The vendor's other payments a convert may link: same account + direction, single split, not
 * already linked to a bill / income or in a shown stream, not a transfer / pending / inactive. PURE.
 */
function eligible_candidates(facts) {
    const direction = direction_of(facts.txn.type);
    const floor = retro_floor_ms(facts);
    return facts.vendor_txns
        .filter((c) => c.doc_id !== facts.txn.doc_id &&
        c.is_active &&
        !c.is_pending &&
        c.account_id === facts.txn.account_id &&
        direction_of(c.type) === direction &&
        c.vendor_key === facts.txn.vendor_key &&
        c.date_ms >= floor &&
        c.date_ms <= facts.now_ms &&
        c.transfer_role !== "internal" && !(0, stream_membership_1.is_edge_money)(c.transfer_role) &&
        c.splits.length === 1 &&
        c.splits[0].outflow_id === null && c.splits[0].inflow_id === null &&
        !c.in_shown_stream)
        .map((c) => ({ id: c.doc_id, plaid_id: c.plaid_id, date_ms: c.date_ms, amount: Math.abs(c.amount) }));
}
/** Plan a convert. PURE. */
function plan_convert(facts, req, new_id) {
    var _a, _b, _c;
    const refusal = check_convertible(facts);
    if (refusal)
        return refusal;
    const t = facts.txn;
    const direction = direction_of(t.type);
    if (!convert_recurring_service_1.CONVERT_FREQUENCIES.includes(req.frequency)) {
        return { ok: false, code: "VALIDATION_ERROR", message: "Pick a schedule" };
    }
    const next_raw = (0, convert_recurring_service_1.parse_iso_date)(req.next_due_date);
    if (next_raw === null)
        return { ok: false, code: "VALIDATION_ERROR", message: "That due date isn't a real date" };
    const { next_due_ms, clamped } = (0, convert_recurring_service_1.clamp_next_due)(next_raw, req.frequency, facts.now_ms);
    const split_ids = req.split_id
        ? t.splits.filter((s) => s.split_id === req.split_id).map((s) => s.split_id)
        : t.splits.map((s) => s.split_id);
    if (split_ids.length === 0)
        return { ok: false, code: "NOT_FOUND", message: "That split doesn't exist" };
    const source_amount = Math.abs(t.amount);
    const source = { id: t.doc_id, plaid_id: t.plaid_id, date_ms: t.date_ms, amount: source_amount };
    const candidates = req.link_past ? eligible_candidates(facts) : [];
    const selection = (0, convert_recurring_service_1.select_retro_payments)({
        frequency: req.frequency, next_due_ms, payments: candidates, source, floor_ms: retro_floor_ms(facts), now_ms: facts.now_ms,
    });
    const first_date_ms = (0, convert_recurring_service_1.compute_first_date)({
        frequency: req.frequency, next_due_ms, selection, source_date_ms: t.date_ms, now_ms: facts.now_ms,
    });
    const retro = selection.chosen.filter((p) => p.id !== t.doc_id);
    const built = (0, convert_recurring_service_1.build_converted_recurring)({
        id: new_id, direction, user_id: facts.user_id, name: req.name, amount: req.amount, frequency: req.frequency,
        next_due_ms, first_date_ms, account_id: t.account_id, vendor_key: t.vendor_key, merchant_source: t.vendor_source,
        converted_from_txn_id: t.doc_id, converted_from_split_ids: split_ids, now_ms: facts.now_ms,
        plaid_primary_category: (_a = t.plaid_primary_category) !== null && _a !== void 0 ? _a : undefined,
        plaid_detailed_category: (_b = t.plaid_detailed_category) !== null && _b !== void 0 ? _b : undefined,
    });
    if (built.errors)
        return { ok: false, code: "VALIDATION_ERROR", message: built.errors.join("; ") };
    return {
        ok: true,
        direction,
        entity: ((_c = built.outflow) !== null && _c !== void 0 ? _c : built.inflow),
        vendor_key: t.vendor_key,
        next_due_ms,
        first_date_ms,
        source_split_ids: split_ids,
        selection,
        retro_plaid_ids: retro.map((p) => p.plaid_id).filter((x) => !!x),
        retro_doc_ids: retro.map((p) => p.id),
        next_due_clamped: clamped,
    };
}
/** What the "Make this a bill" sheet should offer for this transaction. PURE. */
function build_preview(facts) {
    var _a;
    const refusal = check_convertible(facts);
    if (refusal)
        return refusal;
    const t = facts.txn;
    const direction = direction_of(t.type);
    const candidates = eligible_candidates(facts);
    const dates = [t.date_ms, ...candidates.map((c) => c.date_ms)];
    const guess = (0, convert_recurring_service_1.guess_schedule)(dates, facts.now_ms);
    let linkable = null;
    let excluded = null;
    if (guess) {
        const sel = (0, convert_recurring_service_1.select_retro_payments)({
            frequency: guess.frequency, next_due_ms: guess.next_due_ms, payments: candidates,
            source: { id: t.doc_id, plaid_id: t.plaid_id, date_ms: t.date_ms, amount: Math.abs(t.amount) },
            floor_ms: retro_floor_ms(facts), now_ms: facts.now_ms,
        });
        linkable = sel.chosen.length - 1; // the source itself is not a "past payment"
        excluded = sel.excluded.length;
    }
    return {
        ok: true,
        direction,
        suggested_name: (0, vendor_key_service_1.clean_vendor_name)((_a = t.vendor_source) !== null && _a !== void 0 ? _a : ""),
        suggested_amount: Math.abs(t.amount),
        schedule_guess: guess,
        linkable_count: linkable,
        excluded_count: excluded,
        vendor_payment_count: candidates.length,
    };
}
//# sourceMappingURL=convert_plan.service.js.map