"use strict";
/**
 * migrate_budget_categories (admin) — canon A2 one-time migration, dry run first.
 *
 *   { dry_run: true }                          → report in `_migration_reports/{run_id}`
 *   { dry_run: false, reviewed_run_id: "…" }   → apply exactly the reviewed plan
 *
 * Requires the `admin` custom claim. Returns counts + the run id.
 *
 * @module entry/callable/migrate_budget_categories
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.migrate_budget_categories = void 0;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const observability_1 = require("../../observability");
const migrate_budget_categories_orchestrator_1 = require("../../orchestrators/budgets/migrate_budget_categories.orchestrator");
const input_schema = zod_1.z.object({
    dry_run: zod_1.z.boolean(),
    reviewed_run_id: zod_1.z.string().min(1).optional(),
});
exports.migrate_budget_categories = (0, https_1.onCall)(
// eslint-disable-next-line @typescript-eslint/naming-convention
{ region: "us-central1", memory: "512MiB", timeoutSeconds: 300 }, async (request) => {
    var _a, _b;
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    if (((_a = request.auth.token) === null || _a === void 0 ? void 0 : _a.admin) !== true) {
        throw new https_1.HttpsError("permission-denied", "Admins only");
    }
    const parsed = input_schema.safeParse((_b = request.data) !== null && _b !== void 0 ? _b : {});
    if (!parsed.success) {
        throw new https_1.HttpsError("invalid-argument", parsed.error.issues.map((i) => i.message).join("; "));
    }
    const trace_id = (0, observability_1.generate_id)();
    try {
        return await (0, migrate_budget_categories_orchestrator_1.migrate_budget_categories_orchestrator)({ trace_id, span_id: trace_id }, parsed.data);
    }
    catch (error) {
        throw new https_1.HttpsError("failed-precondition", error instanceof Error ? error.message : "Migration failed", { trace_id });
    }
});
//# sourceMappingURL=migrate_budget_categories.entry.js.map