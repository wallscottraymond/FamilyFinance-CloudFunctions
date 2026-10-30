"use strict";
/**
 * The last payment of a bill / income for a merge's end date — READ-ONLY. Plaid's `last_date` goes
 * stale for payments linked by split or pin, so the later of it and the newest linked transaction
 * is used (one `array-contains` query).
 *
 * @module resolvers/recurring/last_payment
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolve_last_payment_ms = resolve_last_payment_ms;
const transaction_repo_1 = require("../../repositories/transaction.repo");
async function resolve_last_payment_ms(ctx, user_id, kind, id, last_date_ms) {
    const linked = await transaction_repo_1.transaction_repo.get_by_split_recurring_link(ctx, user_id, kind, id);
    const newest = linked.reduce((m, t) => { var _a, _b, _c; return Math.max(m, (_c = (_b = (_a = t.transactionDate) === null || _a === void 0 ? void 0 : _a.toMillis) === null || _b === void 0 ? void 0 : _b.call(_a)) !== null && _c !== void 0 ? _c : 0); }, 0);
    const best = Math.max(last_date_ms !== null && last_date_ms !== void 0 ? last_date_ms : 0, newest);
    return best > 0 ? best : null;
}
//# sourceMappingURL=last_payment.resolver.js.map