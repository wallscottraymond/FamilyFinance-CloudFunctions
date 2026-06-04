"use strict";
/**
 * Link Plaid Account Types
 *
 * Types for the link_plaid_account flow in the 5-layer architecture.
 * This combines the full Plaid Link flow:
 * 1. Exchange public token for access token
 * 2. Save Plaid item
 * 3. Link accounts
 *
 * @module types/plaid/link_plaid_account
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LINK_PLAID_ACCOUNT_BUDGET = void 0;
// ============================================================================
// Constants
// ============================================================================
/**
 * Performance budget for link_plaid_account orchestrator.
 */
exports.LINK_PLAID_ACCOUNT_BUDGET = {
    max_reads: 10,
    max_writes: 15, // Item + multiple accounts
    max_time_ms: 30000, // Plaid API calls can be slow
};
//# sourceMappingURL=link_plaid_account.types.js.map