/**
 * Admin HTTP Endpoint: Regenerate Inflow Periods
 *
 * Temporary admin function to regenerate inflow periods for data repair.
 * This is an HTTP function (not callable) that can be invoked directly.
 *
 * Security: Protected by a simple admin key in the request header.
 *
 * Usage:
 *   curl -X POST \
 *     -H "x-admin-key: family-finance-admin-2025" \
 *     https://us-central1-family-budget-app-cb59b.cloudfunctions.net/adminRegenerateInflowPeriods
 *
 * Or for a specific user:
 *   curl -X POST \
 *     -H "x-admin-key: family-finance-admin-2025" \
 *     -H "Content-Type: application/json" \
 *     -d '{"userId": "USER_ID_HERE"}' \
 *     https://us-central1-family-budget-app-cb59b.cloudfunctions.net/adminRegenerateInflowPeriods
 */
export declare const adminRegenerateInflowPeriods: import("firebase-functions/v2/https").HttpsFunction;
//# sourceMappingURL=adminRegenerateInflowPeriods.d.ts.map