/**
 * Admin Function: Extend Outflow Periods
 *
 * Extends existing outflow periods by generating additional periods forward in time.
 * This is useful when existing outflows need periods extended beyond their current range.
 *
 * Usage:
 * POST https://us-central1-{project}.cloudfunctions.net/extendOutflowPeriods
 * Body: {
 *   "outflowId": "outflow_id_here",  // Optional: specific outflow
 *   "userId": "user_id_here",        // Optional: all outflows for user
 *   "monthsForward": 15              // Optional: default 15
 * }
 */
export declare const extendOutflowPeriods: import("firebase-functions/v2/https").HttpsFunction;
//# sourceMappingURL=extendOutflowPeriods.d.ts.map