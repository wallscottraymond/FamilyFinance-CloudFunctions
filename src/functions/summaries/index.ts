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

// Export Firestore triggers
export * from "./triggers/outflowPeriodSummaryTriggers";
export * from "./triggers/budgetPeriodSummaryTriggers";
export * from "./triggers/inflowPeriodSummaryTriggers";
