"use strict";
/**
 * A budget's checklist (Manual-Budgets, AF-02): what you plan to buy, with an estimate each. A tick
 * means bought; the budget's spent still comes from its transactions, so nothing here affects any
 * number. The total of the estimates only suggests a budget amount.
 *
 * `carry` is the user's choice per budget. On: the items and estimates carry, and each period has
 * its own ticks. Off: an item belongs to the period it was added in.
 *
 * PURE. @module domain/budgets/budget_checklist
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EMPTY_CHECKLIST = exports.CHECKLIST_MAX_TICK_PERIODS = exports.CHECKLIST_MAX_ITEMS = void 0;
exports.apply_checklist_op = apply_checklist_op;
exports.CHECKLIST_MAX_ITEMS = 100;
/** Older periods' ticks are dropped, so the map stays bounded. */
exports.CHECKLIST_MAX_TICK_PERIODS = 24;
exports.EMPTY_CHECKLIST = { carry: true, items: [], ticks: {} };
/** Apply one edit to the stored list. An edit to an item someone else just removed does nothing. PURE. */
function apply_checklist_op(current, op) {
    var _a;
    switch (op.op) {
        case "add": {
            const name = op.name.trim();
            if (!name)
                return { errors: ["Give the item a name"] };
            if (current.items.some((i) => i.id === op.id))
                return { checklist: current };
            if (current.items.length >= exports.CHECKLIST_MAX_ITEMS) {
                return { errors: [`A checklist can hold up to ${exports.CHECKLIST_MAX_ITEMS} items`] };
            }
            return {
                checklist: Object.assign(Object.assign({}, current), { items: [...current.items, {
                            id: op.id,
                            name,
                            estimate: Math.round(op.estimate * 100) / 100,
                            period_key: current.carry ? null : op.period_key,
                        }] }),
            };
        }
        case "remove": {
            const ticks = {};
            for (const [k, ids] of Object.entries(current.ticks)) {
                const kept = ids.filter((x) => x !== op.id);
                if (kept.length)
                    ticks[k] = kept;
            }
            return { checklist: Object.assign(Object.assign({}, current), { items: current.items.filter((i) => i.id !== op.id), ticks }) };
        }
        case "tick": {
            if (!current.items.some((i) => i.id === op.id))
                return { checklist: current };
            const now = (_a = current.ticks[op.period_key]) !== null && _a !== void 0 ? _a : [];
            const next = op.ticked ? [...new Set([...now, op.id])] : now.filter((x) => x !== op.id);
            const ticks = Object.assign({}, current.ticks);
            if (next.length)
                ticks[op.period_key] = next;
            else
                delete ticks[op.period_key];
            // Older periods' ticks drop off, so the map stays bounded.
            const keep = Object.keys(ticks).sort().slice(-exports.CHECKLIST_MAX_TICK_PERIODS);
            return { checklist: Object.assign(Object.assign({}, current), { ticks: Object.fromEntries(keep.map((k) => [k, ticks[k]])) }) };
        }
        case "carry":
            return {
                checklist: Object.assign(Object.assign({}, current), { carry: op.carry, 
                    // Turning carrying off keeps the items in the period in view.
                    items: current.items.map((i) => { var _a; return (Object.assign(Object.assign({}, i), { period_key: op.carry ? null : (_a = i.period_key) !== null && _a !== void 0 ? _a : op.period_key })); }) }),
            };
    }
}
//# sourceMappingURL=budget_checklist.service.js.map