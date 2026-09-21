/**
 * Period-Centric Summary System
 *
 * This module exports all summary-related functions including:
 * - API callable functions for fetching and recalculating summaries
 * - Firestore triggers for automatic summary updates
 *
 * Architecture:
 * - user_summaries: One document per user per period containing ALL resources
 * - group_summaries: One document per group per period containing ALL resources
 *
 * Example Document ID: user123_monthly_2025-M11
 */

// Export API callable functions
export * from "./api/getUserPeriodSummary";
export * from "./api/recalculateUserPeriodSummary";
export * from "./api/regenerateAllUserSummaries";

// Firestore triggers — RETIRED. The `user_summaries` materialized build is disabled: the app
// reads period nav from `source_periods` and financials via the derive-on-read path. Un-exporting
// these 6 period-summary triggers removes them from the deployed set (they do no other work).
// Reversible: restore these exports + the enqueue chokepoint in update_user_summary.orchestrator.
// export * from "./triggers/outflowPeriodSummaryTriggers";
// export * from "./triggers/budgetPeriodSummaryTriggers";
// export * from "./triggers/inflowPeriodSummaryTriggers";

// Export types
export * from "./types";

// Export admin functions
export * from "./admin/backfillUserSummaries";
