/**
 * Health Check HTTP Endpoint
 *
 * GET /health - Returns system health status
 *
 * @module entry/http/health
 */
/**
 * Health check endpoint for monitoring systems.
 *
 * Returns:
 * - 200: System healthy or degraded
 * - 503: System unhealthy
 *
 * Response body includes individual component status.
 */
export declare const health: import("firebase-functions/v2/https").HttpsFunction;
//# sourceMappingURL=health.entry.d.ts.map