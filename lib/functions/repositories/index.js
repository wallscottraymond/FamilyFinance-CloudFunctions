"use strict";
/**
 * Repository Layer
 *
 * Pure persistence layer with no business logic.
 * All writes are automatically audited.
 *
 * @module repositories
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.link_token_event_repo = exports.category_repo = exports.user_repo = exports.source_period_repo = exports.budget_period_repo = exports.budget_repo = exports.outflow_repo = exports.inflow_repo = exports.inflow_period_repo = exports.outflow_period_repo = exports.transaction_repo = exports.account_repo = void 0;
// Business domain repositories
var account_repo_1 = require("./account.repo");
Object.defineProperty(exports, "account_repo", { enumerable: true, get: function () { return account_repo_1.account_repo; } });
var transaction_repo_1 = require("./transaction.repo");
Object.defineProperty(exports, "transaction_repo", { enumerable: true, get: function () { return transaction_repo_1.transaction_repo; } });
var outflow_period_repo_1 = require("./outflow_period.repo");
Object.defineProperty(exports, "outflow_period_repo", { enumerable: true, get: function () { return outflow_period_repo_1.outflow_period_repo; } });
var inflow_period_repo_1 = require("./inflow_period.repo");
Object.defineProperty(exports, "inflow_period_repo", { enumerable: true, get: function () { return inflow_period_repo_1.inflow_period_repo; } });
var inflow_repo_1 = require("./inflow.repo");
Object.defineProperty(exports, "inflow_repo", { enumerable: true, get: function () { return inflow_repo_1.inflow_repo; } });
var outflow_repo_1 = require("./outflow.repo");
Object.defineProperty(exports, "outflow_repo", { enumerable: true, get: function () { return outflow_repo_1.outflow_repo; } });
var budget_repo_1 = require("./budget.repo");
Object.defineProperty(exports, "budget_repo", { enumerable: true, get: function () { return budget_repo_1.budget_repo; } });
var budget_period_repo_1 = require("./budget_period.repo");
Object.defineProperty(exports, "budget_period_repo", { enumerable: true, get: function () { return budget_period_repo_1.budget_period_repo; } });
var source_period_repo_1 = require("./source_period.repo");
Object.defineProperty(exports, "source_period_repo", { enumerable: true, get: function () { return source_period_repo_1.source_period_repo; } });
var user_repo_1 = require("./user.repo");
Object.defineProperty(exports, "user_repo", { enumerable: true, get: function () { return user_repo_1.user_repo; } });
var category_repo_1 = require("./category.repo");
Object.defineProperty(exports, "category_repo", { enumerable: true, get: function () { return category_repo_1.category_repo; } });
// Plaid repositories
var plaid_1 = require("./plaid");
Object.defineProperty(exports, "link_token_event_repo", { enumerable: true, get: function () { return plaid_1.link_token_event_repo; } });
// Infrastructure repositories (re-export)
__exportStar(require("./infrastructure"), exports);
//# sourceMappingURL=index.js.map