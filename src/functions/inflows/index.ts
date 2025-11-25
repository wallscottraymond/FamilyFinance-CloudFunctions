/**
 * Inflows Module - Cloud Functions
 *
 * This module provides inflow (recurring income) management for the Family Finance app,
 * including automatic inflow period generation and orchestration.
 *
 * Functions included:
 * - onInflowCreated: Automatic inflow period generation trigger
 *
 * Architecture:
 * - orchestration/triggers: Firestore triggers (Inflow period generation)
 * - utils: Shared utilities for inflow processing
 */

// ===== Orchestration Functions =====

// Triggers
export { onInflowCreated } from "./orchestration/triggers/onInflowCreated";

/**
 * Function Overview:
 *
 * onInflowCreated:
 * - Purpose: Automatically generate inflow_periods when inflow is created
 * - Triggers: When document created in inflows collection
 * - Memory: 512MiB, Timeout: 60s
 * - Location: orchestration/triggers/onInflowCreated.ts
 */
