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

// API callables + admin — RETIRED (Derive-Everywhere-Consistency). `user_summaries` is no longer
// built or read (period nav = `source_periods`, financials = derive-on-read), so these deployed
// endpoints had NO live caller (getUserPeriodSummary/recalculate/regenerate were only reachable via
// the retired FE service + a devtool button; backfill was a one-off). Files deleted; un-deployed via
// `firebase functions:delete`. The 3 period-summary triggers were already un-exported (build is off).
// Reversible: restore from git + the enqueue chokepoint in update_user_summary.orchestrator.

// Export types
export * from "./types";
