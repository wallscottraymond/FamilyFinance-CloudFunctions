"use strict";
/**
 * Refresh Plaid Data Types
 *
 * Types for the combined balance + transaction sync flow
 * triggered by pull-to-refresh in the mobile app.
 *
 * @module types/plaid/refresh_plaid_data
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.REFRESH_PLAID_DATA_BUDGET = void 0;
/**
 * Performance budget for the refresh operation.
 */
exports.REFRESH_PLAID_DATA_BUDGET = {
    /** Maximum Firestore read operations */
    max_reads: 75,
    /** Maximum Firestore write operations */
    max_writes: 150,
    /** Maximum execution time in milliseconds (60 seconds for callable) */
    max_time_ms: 60000,
};
//# sourceMappingURL=refresh_plaid_data.types.js.map