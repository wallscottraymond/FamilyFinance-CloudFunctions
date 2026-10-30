"use strict";
/**
 * Create Manual Inflow Orchestrator (Convert-To-Recurring D43, flag on): Add Income through the
 * shared builder — v2 stamp, `source: "manual"`, the caller's own account verified, a D1 key only
 * from a real transaction, never a retro-link. Created stamped with its periods generated inline
 * and one derive bump (no trigger fan-out). The flag-off path stays in the legacy callable,
 * byte-identical.
 *
 * @module orchestrators/recurring/create_manual_inflow
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
exports.create_manual_inflow_orchestrator = create_manual_inflow_orchestrator;
const crypto_1 = require("crypto");
const types_1 = require("../../types");
const observability_1 = require("../../observability");
const inflow_repo_1 = require("../../repositories/inflow.repo");
const derive_version_repo_1 = require("../../repositories/derive_version.repo");
const manual_source_resolver_1 = require("../../resolvers/recurring/manual_source.resolver");
const manual_inflow_service_1 = require("../../domain/recurring/manual_inflow.service");
const generate_periods_inline_1 = require("./generate_periods_inline");
async function create_manual_inflow_orchestrator(ctx, user_id, input) {
    var _b;
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "create_manual_inflow");
    (0, observability_1.log_operation_start)(span, user_id);
    try {
        const src = await (0, manual_source_resolver_1.resolve_manual_source)(ctx, user_id, input);
        if (!src.ok) {
            throw new types_1.ConvertRefusedError(src.reason === "account_not_yours" ? "ACCOUNT_NOT_YOURS" : "SOURCE_NOT_YOURS", "That account or transaction isn't yours");
        }
        const id = `manual_${(0, crypto_1.randomUUID)()}`;
        const now_ms = Date.now();
        const { account_id: _a, source_transaction_id: _s } = input, rest = __rest(input, ["account_id", "source_transaction_id"]);
        void _a;
        void _s;
        const built = (0, manual_inflow_service_1.build_manual_inflow)(Object.assign(Object.assign({}, rest), { id, user_id, account_id: src.account_id, vendor_key: src.account_id ? src.vendor_key : null, now_ms }));
        if (built.errors || !built.inflow)
            throw new types_1.ValidationError((_b = built.errors) !== null && _b !== void 0 ? _b : ["Invalid income"]);
        const run_id = `manual_${(0, crypto_1.randomUUID)()}`;
        const entity = built.inflow.vendor_key ? Object.assign(Object.assign({}, built.inflow), { converted_at_ms: now_ms }) : built.inflow;
        const saved = await inflow_repo_1.inflow_repo.save_batch(ctx, [entity], run_id);
        await (0, generate_periods_inline_1.generate_periods_inline)(ctx, user_id, saved.written.filter((w) => w.created));
        await (0, derive_version_repo_1.bump_derive_version)(user_id).catch(() => { });
        (0, observability_1.log_operation_success)(span, user_id);
        return { inflow_id: id };
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id });
        throw error;
    }
}
//# sourceMappingURL=create_manual_inflow.orchestrator.js.map