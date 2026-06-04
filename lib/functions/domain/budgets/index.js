"use strict";
/**
 * Budget Domain Services
 *
 * Pure business logic for budget CRUD.
 * NO async, NO IO, NO side effects.
 *
 * @module domain/budgets
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.compute_delete_budget = exports.compute_update_budget = exports.compute_create_budget = exports.compute_delete_transfer_plan = exports.compute_update_transfer_plan = exports.compute_create_transfer_plan = exports.compute_reallocated_periods = exports.compute_ee_coverage_start = exports.EE_HISTORY_BACKDATE_MONTHS = exports.build_self_provision_budget_created_payload = exports.compute_period_generation_end = exports.budget_cadence_to_instance = exports.compute_budget_periods = exports.compute_daily_rate = exports.compute_period_allocation = exports.days_in_month = exports.count_days_inclusive = void 0;
var period_generation_service_1 = require("./period_generation.service");
Object.defineProperty(exports, "count_days_inclusive", { enumerable: true, get: function () { return period_generation_service_1.count_days_inclusive; } });
Object.defineProperty(exports, "days_in_month", { enumerable: true, get: function () { return period_generation_service_1.days_in_month; } });
Object.defineProperty(exports, "compute_period_allocation", { enumerable: true, get: function () { return period_generation_service_1.compute_period_allocation; } });
Object.defineProperty(exports, "compute_daily_rate", { enumerable: true, get: function () { return period_generation_service_1.compute_daily_rate; } });
Object.defineProperty(exports, "compute_budget_periods", { enumerable: true, get: function () { return period_generation_service_1.compute_budget_periods; } });
Object.defineProperty(exports, "budget_cadence_to_instance", { enumerable: true, get: function () { return period_generation_service_1.budget_cadence_to_instance; } });
Object.defineProperty(exports, "compute_period_generation_end", { enumerable: true, get: function () { return period_generation_service_1.compute_period_generation_end; } });
Object.defineProperty(exports, "build_self_provision_budget_created_payload", { enumerable: true, get: function () { return period_generation_service_1.build_self_provision_budget_created_payload; } });
Object.defineProperty(exports, "EE_HISTORY_BACKDATE_MONTHS", { enumerable: true, get: function () { return period_generation_service_1.EE_HISTORY_BACKDATE_MONTHS; } });
Object.defineProperty(exports, "compute_ee_coverage_start", { enumerable: true, get: function () { return period_generation_service_1.compute_ee_coverage_start; } });
Object.defineProperty(exports, "compute_reallocated_periods", { enumerable: true, get: function () { return period_generation_service_1.compute_reallocated_periods; } });
var category_ownership_service_1 = require("./category_ownership.service");
Object.defineProperty(exports, "compute_create_transfer_plan", { enumerable: true, get: function () { return category_ownership_service_1.compute_create_transfer_plan; } });
Object.defineProperty(exports, "compute_update_transfer_plan", { enumerable: true, get: function () { return category_ownership_service_1.compute_update_transfer_plan; } });
Object.defineProperty(exports, "compute_delete_transfer_plan", { enumerable: true, get: function () { return category_ownership_service_1.compute_delete_transfer_plan; } });
var create_budget_service_1 = require("./create_budget.service");
Object.defineProperty(exports, "compute_create_budget", { enumerable: true, get: function () { return create_budget_service_1.compute_create_budget; } });
var update_budget_service_1 = require("./update_budget.service");
Object.defineProperty(exports, "compute_update_budget", { enumerable: true, get: function () { return update_budget_service_1.compute_update_budget; } });
var delete_budget_service_1 = require("./delete_budget.service");
Object.defineProperty(exports, "compute_delete_budget", { enumerable: true, get: function () { return delete_budget_service_1.compute_delete_budget; } });
//# sourceMappingURL=index.js.map