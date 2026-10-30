"use strict";
/**
 * Preview Convert Orchestrator (Convert-To-Recurring Phase 2): what the "Make this a bill" sheet
 * should show for a transaction — READ-ONLY. Reads: the transaction, the user's bills / income, the
 * accounts, the inactive records of the vendor, and the vendor's payments (one doc per payment
 * returned, paged at 600 rows up to 3000; a source without a stored vendorKey adds up to 1500 for
 * the account-window fallback). Typically ~100–200, bounded by the vendor's payment count. A refusal is DATA here (`refusal`), not an error:
 * the sheet explains it. The owner is checked first; flag off → `{enabled: false}` and nothing is
 * read.
 *
 * @module orchestrators/recurring/preview_convert_transaction
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
exports.preview_convert_transaction_orchestrator = preview_convert_transaction_orchestrator;
const types_1 = require("../../types");
const observability_1 = require("../../observability");
const feature_flags_1 = require("../../infrastructure/feature_flags");
const convert_resolver_1 = require("../../resolvers/recurring/convert.resolver");
const convert_plan_service_1 = require("../../domain/recurring/convert_plan.service");
async function preview_convert_transaction_orchestrator(ctx, user_id, input, now_ms) {
    var _a;
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "preview_convert_transaction");
    (0, observability_1.log_operation_start)(span, user_id);
    try {
        if (!(await (0, feature_flags_1.is_convert_to_recurring_enabled)(user_id)))
            return { enabled: false };
        const r = await (0, convert_resolver_1.resolve_convert_facts)(ctx, user_id, input.transaction_id, now_ms, input.split_id);
        if (!r.ok) {
            if (r.reason === "not_found")
                throw new types_1.NotFoundError("transaction", input.transaction_id);
            throw new types_1.PermissionDeniedError("preview_convert_transaction", input.transaction_id);
        }
        if ((_a = r.existing_conversion) === null || _a === void 0 ? void 0 : _a.live) {
            return { enabled: true, already_converted: { id: r.existing_conversion.id, name: r.existing_conversion.name, unfinished: !r.existing_conversion.retro_done } };
        }
        // A conversion that was removed: convert refuses it, so the preview says so too.
        if (r.existing_conversion) {
            const message = (0, convert_plan_service_1.direction_of)(r.facts.txn.type) === "inflow" ? "This was already made into income" : "This was already made into a bill";
            return { enabled: true, refusal: { code: "ALREADY_TRACKED", message, details: { id: r.existing_conversion.id, name: r.existing_conversion.name } } };
        }
        const preview = (0, convert_plan_service_1.build_preview)(r.facts);
        (0, observability_1.log_operation_success)(span, user_id);
        if (!preview.ok) {
            return { enabled: true, refusal: Object.assign({ code: preview.code, message: preview.message }, (preview.details ? { details: preview.details } : {})) };
        }
        const { ok: _ok } = preview, rest = __rest(preview, ["ok"]);
        void _ok;
        return Object.assign({ enabled: true }, rest);
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id });
        throw error;
    }
}
//# sourceMappingURL=preview_convert_transaction.orchestrator.js.map