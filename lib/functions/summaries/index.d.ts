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
export * from "./api/getUserPeriodSummary";
export * from "./api/recalculateUserPeriodSummary";
export * from "./triggers/outflowPeriodSummaryTriggers";
export * from "./triggers/budgetPeriodSummaryTriggers";
export * from "./triggers/inflowPeriodSummaryTriggers";
export * from "./types";
//# sourceMappingURL=index.d.ts.map