"use strict";
/**
 * Budget CRUD Operations Index
 *
 * Create/Update/Delete are now handled by the v2 layered-architecture onCall
 * functions (create_budget / update_budget / delete_budget in entry/callable).
 * The legacy createBudget/updateBudget/deleteBudget handlers were removed
 * (2026-06-01) — they wrote budgets WITHOUT the v2 cascade and were a footgun.
 * Only the read (getBudget) remains here.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBudget = void 0;
var getBudget_1 = require("./getBudget");
Object.defineProperty(exports, "getBudget", { enumerable: true, get: function () { return getBudget_1.getBudget; } });
//# sourceMappingURL=index.js.map