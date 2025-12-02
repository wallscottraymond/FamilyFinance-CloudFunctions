"use strict";
/**
 * Outflow Periods Types
 *
 * Types related to outflow periods (bill occurrences in specific time periods).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.OutflowPeriodStatus = exports.PaymentType = void 0;
// =======================
// OUTFLOW PERIOD ENUMS
// =======================
/**
 * Payment Type Classification
 */
var PaymentType;
(function (PaymentType) {
    PaymentType["REGULAR"] = "regular";
    PaymentType["CATCH_UP"] = "catch_up";
    PaymentType["ADVANCE"] = "advance";
    PaymentType["EXTRA_PRINCIPAL"] = "extra_principal";
})(PaymentType || (exports.PaymentType = PaymentType = {}));
/**
 * Outflow Period Status
 */
var OutflowPeriodStatus;
(function (OutflowPeriodStatus) {
    OutflowPeriodStatus["PENDING"] = "pending";
    OutflowPeriodStatus["DUE_SOON"] = "due_soon";
    OutflowPeriodStatus["PARTIAL"] = "partial";
    OutflowPeriodStatus["PAID"] = "paid";
    OutflowPeriodStatus["PAID_EARLY"] = "paid_early";
    OutflowPeriodStatus["OVERDUE"] = "overdue";
})(OutflowPeriodStatus || (exports.OutflowPeriodStatus = OutflowPeriodStatus = {}));
//# sourceMappingURL=index.js.map