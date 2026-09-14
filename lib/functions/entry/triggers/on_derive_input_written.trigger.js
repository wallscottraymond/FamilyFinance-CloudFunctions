"use strict";
/**
 * On Derive-Input Written (Triggers) — derived-period cache invalidation
 *
 * `derive_period` reads 7 sources; five are already covered by their own triggers
 * (transactions, outflows, inflows, budget_periods). This file closes the remaining
 * OWNER-SCOPED gaps — `budgets` and `goals` — by bumping the user's derive-input version
 * so their cached periods recompute on the next read ([[Firestore-Read-Cost-Reduction]]).
 *
 * These are thin invalidation-only triggers (no orchestrator, no cascade): extract the
 * owner, fire-and-forget a version bump, done. `bump_derive_version` writes only to
 * `user_data_versions` (no trigger there), so there is no loop.
 *
 * NOT covered here: `source_periods` is a GLOBAL, non-owner-scoped calendar that changes
 * rarely (period generation extends the horizon) — a per-user version can't target it, so
 * it relies on the cache's TTL backstop (minutes) to pick up new period definitions.
 *
 * @module entry/triggers/on_derive_input_written
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.on_goal_written = exports.on_budget_written = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const derive_version_repo_1 = require("../../repositories/derive_version.repo");
/** Owner of a derive-input doc, across the app's naming conventions. */
function owner_of(before, after) {
    var _a, _b, _c;
    const d = (_a = after !== null && after !== void 0 ? after : before) !== null && _a !== void 0 ? _a : {};
    return ((_c = (_b = d.userId) !== null && _b !== void 0 ? _b : d.ownerId) !== null && _c !== void 0 ? _c : d.createdBy);
}
const TRIGGER_OPTS = {
    region: "us-central1",
    memory: "256MiB",
    // eslint-disable-next-line @typescript-eslint/naming-convention
    timeoutSeconds: 30,
};
exports.on_budget_written = (0, firestore_1.onDocumentWritten)(Object.assign(Object.assign({}, TRIGGER_OPTS), { document: "budgets/{budgetId}" }), async (event) => {
    var _a, _b, _c, _d, _e, _f;
    const owner = owner_of((_c = (_b = (_a = event.data) === null || _a === void 0 ? void 0 : _a.before) === null || _b === void 0 ? void 0 : _b.data()) !== null && _c !== void 0 ? _c : null, (_f = (_e = (_d = event.data) === null || _d === void 0 ? void 0 : _d.after) === null || _e === void 0 ? void 0 : _e.data()) !== null && _f !== void 0 ? _f : null);
    if (owner)
        void (0, derive_version_repo_1.bump_derive_version)(owner).catch(() => { });
});
exports.on_goal_written = (0, firestore_1.onDocumentWritten)(Object.assign(Object.assign({}, TRIGGER_OPTS), { document: "goals/{goalId}" }), async (event) => {
    var _a, _b, _c, _d, _e, _f;
    const owner = owner_of((_c = (_b = (_a = event.data) === null || _a === void 0 ? void 0 : _a.before) === null || _b === void 0 ? void 0 : _b.data()) !== null && _c !== void 0 ? _c : null, (_f = (_e = (_d = event.data) === null || _d === void 0 ? void 0 : _d.after) === null || _e === void 0 ? void 0 : _e.data()) !== null && _f !== void 0 ? _f : null);
    if (owner)
        void (0, derive_version_repo_1.bump_derive_version)(owner).catch(() => { });
});
//# sourceMappingURL=on_derive_input_written.trigger.js.map