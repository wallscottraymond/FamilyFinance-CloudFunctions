/**
 * Health Check System
 *
 * Provides health check utilities for monitoring system status.
 * Returns structured health response with individual component status.
 *
 * @module infrastructure/health
 */

import { getFirestore, Timestamp } from "firebase-admin/firestore";

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
 * Current API version.
 * Update this when deploying new versions.
 */
const API_VERSION = "2.0.0";

/**
 * Checks Firestore connectivity by reading a test document.
 */
export async function check_firestore_connectivity(): Promise<ComponentHealth> {
  const start = Date.now();

  try {
    const db = getFirestore();
    // Read a small document to test connectivity
    await db.collection("_health").doc("ping").get();

    const latency_ms = Date.now() - start;

    // Warn if latency is high
    if (latency_ms > 1000) {
      return {
        status: "degraded",
        latency_ms,
        message: "High latency detected",
      };
    }

    return {
      status: "healthy",
      latency_ms,
    };
  } catch (error) {
    return {
      status: "unhealthy",
      latency_ms: Date.now() - start,
      message: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Checks external service status by reading circuit breaker state.
 *
 * @param service_name - Name of the service (e.g., "plaid")
 */
export async function check_external_service_status(
  service_name: string
): Promise<ComponentHealth> {
  try {
    const db = getFirestore();
    const doc = await db
      .collection("_circuit_breaker_state")
      .doc(service_name)
      .get();

    if (!doc.exists) {
      // No circuit breaker state means service hasn't been used or is new
      return {
        status: "healthy",
        message: "No circuit breaker state (service operational)",
      };
    }

    const state = doc.data() as {
      status: "closed" | "open" | "half-open";
      failure_count: number;
      last_failure: Timestamp | null;
    };

    switch (state.status) {
    case "closed":
      return {
        status: "healthy",
        details: { circuit_breaker: "closed", failure_count: state.failure_count },
      };

    case "half-open":
      return {
        status: "degraded",
        message: "Service recovering (circuit half-open)",
        details: { circuit_breaker: "half-open" },
      };

    case "open":
      return {
        status: "unhealthy",
        message: "Service unavailable (circuit open)",
        details: {
          circuit_breaker: "open",
          last_failure: state.last_failure?.toDate().toISOString(),
        },
      };

    default:
      return { status: "healthy" };
    }
  } catch {
    return {
      status: "degraded",
      message: "Could not check circuit breaker state",
    };
  }
}

/**
 * Checks Cloud Tasks queue health.
 * Note: This is a simplified check - full queue depth requires Cloud Tasks API.
 */
export async function check_queue_health(): Promise<ComponentHealth> {
  try {
    const db = getFirestore();

    // Check DLQ size as a proxy for queue health
    const dlq_snapshot = await db
      .collection("_dead_letter_queue")
      .limit(1)
      .get();

    if (!dlq_snapshot.empty) {
      // Count total DLQ entries
      const dlq_count_snapshot = await db
        .collection("_dead_letter_queue")
        .count()
        .get();
      const dlq_count = dlq_count_snapshot.data().count;

      if (dlq_count > 0) {
        return {
          status: "degraded",
          message: `${dlq_count} items in dead letter queue`,
          details: { dlq_size: dlq_count },
        };
      }
    }

    return {
      status: "healthy",
      details: { dlq_size: 0 },
    };
  } catch {
    return {
      status: "degraded",
      message: "Could not check queue health",
    };
  }
}

/**
 * Checks quota usage from monitoring data.
 */
export async function check_quota_status(): Promise<ComponentHealth> {
  try {
    const db = getFirestore();
    const doc = await db.collection("_quota_snapshots").doc("latest").get();

    if (!doc.exists) {
      return {
        status: "healthy",
        message: "No quota data available",
      };
    }

    const quota = doc.data() as {
      reads_percent: number;
      writes_percent: number;
      timestamp: Timestamp;
    };

    // Check thresholds
    const max_percent = Math.max(quota.reads_percent, quota.writes_percent);

    if (max_percent >= 95) {
      return {
        status: "unhealthy",
        message: "Quota critical (>= 95%)",
        details: {
          reads_percent: quota.reads_percent,
          writes_percent: quota.writes_percent,
        },
      };
    }

    if (max_percent >= 80) {
      return {
        status: "degraded",
        message: "Quota warning (>= 80%)",
        details: {
          reads_percent: quota.reads_percent,
          writes_percent: quota.writes_percent,
        },
      };
    }

    return {
      status: "healthy",
      details: {
        reads_percent: quota.reads_percent,
        writes_percent: quota.writes_percent,
      },
    };
  } catch {
    return {
      status: "healthy",
      message: "Could not check quota (assuming healthy)",
    };
  }
}

/**
 * Performs a full health check of all components.
 */
export async function perform_health_check(): Promise<HealthCheckResponse> {
  // Run all checks in parallel
  const [firestore, plaid, cloud_tasks, quota] = await Promise.all([
    check_firestore_connectivity(),
    check_external_service_status("plaid"),
    check_queue_health(),
    check_quota_status(),
  ]);

  // Determine overall status (worst of all components)
  const statuses = [firestore, plaid, cloud_tasks, quota];
  let overall_status: HealthStatus = "healthy";

  for (const component of statuses) {
    if (component.status === "unhealthy") {
      overall_status = "unhealthy";
      break;
    }
    if (component.status === "degraded") {
      overall_status = "degraded";
    }
  }

  return {
    status: overall_status,
    timestamp: new Date().toISOString(),
    version: API_VERSION,
    components: {
      firestore,
      plaid,
      cloud_tasks,
      quota,
    },
  };
}

/**
 * Returns HTTP status code for health check response.
 */
export function get_health_http_status(status: HealthStatus): number {
  switch (status) {
  case "healthy":
    return 200;
  case "degraded":
    return 200; // Still operational, just degraded
  case "unhealthy":
    return 503; // Service unavailable
  }
}
