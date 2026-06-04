"use strict";
/**
 * Link Token Types
 *
 * Types for the create_link_token flow in the 5-layer architecture.
 *
 * @module types/plaid/link_token
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CREATE_LINK_TOKEN_BUDGET = exports.LINK_TOKEN_CACHE_TTL_HOURS = void 0;
// ============================================================================
// Constants
// ============================================================================
/**
 * Cache TTL for link tokens in hours.
 * Tokens are valid for 4 hours; we cache for 3 to ensure validity.
 */
exports.LINK_TOKEN_CACHE_TTL_HOURS = 3;
/**
 * Performance budget for create_link_token orchestrator.
 */
exports.CREATE_LINK_TOKEN_BUDGET = {
    max_reads: 5,
    max_writes: 1,
    max_time_ms: 5000,
};
//# sourceMappingURL=link_token.types.js.map