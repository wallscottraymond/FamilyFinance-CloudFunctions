"use strict";
/**
 * Budget Resolvers
 *
 * READ-ONLY impact analysis for budget CRUD.
 *
 * @module resolvers/budgets
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolve_delete_budget_dependencies = exports.resolve_update_budget_dependencies = exports.resolve_create_budget_dependencies = void 0;
var create_budget_resolver_1 = require("./create_budget.resolver");
Object.defineProperty(exports, "resolve_create_budget_dependencies", { enumerable: true, get: function () { return create_budget_resolver_1.resolve_create_budget_dependencies; } });
var update_budget_resolver_1 = require("./update_budget.resolver");
Object.defineProperty(exports, "resolve_update_budget_dependencies", { enumerable: true, get: function () { return update_budget_resolver_1.resolve_update_budget_dependencies; } });
var delete_budget_resolver_1 = require("./delete_budget.resolver");
Object.defineProperty(exports, "resolve_delete_budget_dependencies", { enumerable: true, get: function () { return delete_budget_resolver_1.resolve_delete_budget_dependencies; } });
//# sourceMappingURL=index.js.map