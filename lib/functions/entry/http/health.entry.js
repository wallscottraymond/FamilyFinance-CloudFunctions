"use strict";
/**
 * Health Check HTTP Endpoint
 *
 * GET /health - Returns system health status
 *
 * @module entry/http/health
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.health = void 0;
const https_1 = require("firebase-functions/v2/https");
const health_1 = require("../../infrastructure/health");
/**
 * Health check endpoint for monitoring systems.
 *
 * Returns:
 * - 200: System healthy or degraded
 * - 503: System unhealthy
 *
 * Response body includes individual component status.
 */
exports.health = (0, https_1.onRequest)({
    memory: "256MiB",
    timeoutSeconds: 30, // eslint-disable-line @typescript-eslint/naming-convention
    // No auth required for health checks
}, async (req, res) => {
    // Only allow GET requests
    if (req.method !== "GET") {
        res.status(405).json({ error: "Method not allowed" });
        return;
    }
    try {
        const health_response = await (0, health_1.perform_health_check)();
        const http_status = (0, health_1.get_health_http_status)(health_response.status);
        res.status(http_status).json(health_response);
    }
    catch (error) {
        // If health check itself fails, return unhealthy
        res.status(503).json({
            status: "unhealthy",
            timestamp: new Date().toISOString(),
            error: error instanceof Error ? error.message : "Health check failed",
        });
    }
});
//# sourceMappingURL=health.entry.js.map