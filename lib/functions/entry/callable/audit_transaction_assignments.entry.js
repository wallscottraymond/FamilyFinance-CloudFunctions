"use strict";
/**
 * audit_transaction_assignments (admin) — Transaction-Integrity-Review 3-A, on demand.
 *
 * "Stored == derived" audit for one user (or every user): a DRY RUN of the bounded re-assign
 * engine (reassign_user) — read-only; the report (counts, budget moves, samples) lands in
 * `_reassign_runs/{run_id}`. Why that measures stored vs. the PERIOD PAGE: the engine and the page
 * build the same budget set (domain/budgets/match_budgets), resolve categories with the same
 * function and match with the same matcher, and a property test
 * (stored_equals_derived.property.test) proves they give the same answer; so any stored field that
 * differs from the engine's fresh answer is a stored ≠ page mismatch. Transfer roles are the one
 * input the dry run takes as stored — the transfer classifier keeps them fresh. Replaces the deleted
 * `auditTransactionAssignments` HTTP endpoint (unauthenticated, with a `?fix=true` write path).
 *
 * @module entry/callable/audit_transaction_assignments
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.audit_transaction_assignments = void 0;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const observability_1 = require("../../observability");
const reassign_fanout_orchestrator_1 = require("../../orchestrators/transactions/reassign_fanout.orchestrator");
const input_schema = zod_1.z.object({
    user_id: zod_1.z.string().min(1).optional(),
    all_users: zod_1.z.boolean().optional(),
});
exports.audit_transaction_assignments = (0, https_1.onCall)(
// eslint-disable-next-line @typescript-eslint/naming-convention
{ region: "us-central1", memory: "256MiB", timeoutSeconds: 120 }, async (request) => {
    var _a, _b;
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    if (((_a = request.auth.token) === null || _a === void 0 ? void 0 : _a.admin) !== true)
        throw new https_1.HttpsError("permission-denied", "Admins only");
    const parsed = input_schema.safeParse((_b = request.data) !== null && _b !== void 0 ? _b : {});
    if (!parsed.success || (!parsed.data.user_id && !parsed.data.all_users)) {
        throw new https_1.HttpsError("invalid-argument", "Pass user_id or all_users: true");
    }
    const trace_id = (0, observability_1.generate_id)();
    const queued = await (0, reassign_fanout_orchestrator_1.enqueue_audits)({ trace_id, span_id: trace_id }, parsed.data.all_users ? "all" : [parsed.data.user_id]);
    return { success: true, queued, trace_id };
});
//# sourceMappingURL=audit_transaction_assignments.entry.js.map