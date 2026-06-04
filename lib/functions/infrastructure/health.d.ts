/**
 * Health Check System
 *
 * Provides health check utilities for monitoring system status.
 * Returns structured health response with individual component status.
 *
 * @module infrastructure/health
 */
/**
 * Health status for a component.
 */
export type HealthStatus = "healthy" | "degraded" | "unhealthy";
/**
 * Individual component health check result.
 */
export interface ComponentHealth {
    status: HealthStatus;
    latency_ms?: number;
    message?: string;
    details?: Record<string, unknown>;
}
/**
 * Overall health check response.
 */
export interface HealthCheckResponse {
    /** Overall system status */
    status: HealthStatus;
    /** ISO timestamp of health check */
    timestamp: string;
    /** API version */
    version: string;
    /** Individual component statuses */
    components: {
        firestore: ComponentHealth;
        plaid?: ComponentHealth;
        cloud_tasks?: ComponentHealth;
        quota?: ComponentHealth;
    };
}
/**
 * Checks Firestore connectivity by reading a test document.
 */
export declare function check_firestore_connectivity(): Promise<ComponentHealth>;
/**
 * Checks external service status by reading circuit breaker state.
 *
 * @param service_name - Name of the service (e.g., "plaid")
 */
export declare function check_external_service_status(service_name: string): Promise<ComponentHealth>;
/**
 * Checks Cloud Tasks queue health.
 * Note: This is a simplified check - full queue depth requires Cloud Tasks API.
 */
export declare function check_queue_health(): Promise<ComponentHealth>;
/**
 * Checks quota usage from monitoring data.
 */
export declare function check_quota_status(): Promise<ComponentHealth>;
/**
 * Performs a full health check of all components.
 */
export declare function perform_health_check(): Promise<HealthCheckResponse>;
/**
 * Returns HTTP status code for health check response.
 */
export declare function get_health_http_status(status: HealthStatus): number;
//# sourceMappingURL=health.d.ts.map