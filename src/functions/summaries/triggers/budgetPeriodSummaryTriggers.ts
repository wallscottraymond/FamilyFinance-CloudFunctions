import { onDocumentCreated, onDocumentUpdated, onDocumentDeleted } from "firebase-functions/v2/firestore";
import { BudgetPeriodDocument } from "../../../types";
import { updateUserPeriodSummary } from "../orchestration/updateUserPeriodSummary";

/**
 * Trigger: Update user period summary when a budget period is created
 *
 * When a new budget_period is created, this trigger recalculates the
 * user period summary for the corresponding period.
 */
export const onBudgetPeriodCreatedPeriodSummary = onDocumentCreated(
  "budget_periods/{budgetPeriodId}",
  async (event) => {
    const budgetPeriod = event.data?.data() as BudgetPeriodDocument;

    if (!budgetPeriod) {
      console.error("[onBudgetPeriodCreatedSummary] No budget period data");
      return;
    }

    console.log(
      `[onBudgetPeriodCreatedPeriodSummary] Budget period created: ${budgetPeriod.id}`
    );

    // Check if userId exists
    if (!budgetPeriod.userId) {
      console.error("[onBudgetPeriodCreatedPeriodSummary] No userId found in budget period");
      return;
    }

    try {
      // Update the user period summary for this period
      await updateUserPeriodSummary(
        budgetPeriod.userId,
        String(budgetPeriod.periodType), // Convert enum to string
        budgetPeriod.sourcePeriodId,
        false // Don't include detailed entries in triggers
      );

      console.log(
        `[onBudgetPeriodCreatedSummary] Successfully updated summary for period: ${budgetPeriod.sourcePeriodId}`
      );
    } catch (error) {
      console.error(
        `[onBudgetPeriodCreatedSummary] Error updating summary:`,
        error
      );
      // Don't throw - we don't want to fail the budget period creation
    }
  }
);

/**
 * Trigger: Update user period summary when a budget period is updated
 *
 * When a budget_period is updated, this trigger recalculates the
 * user period summary for the corresponding period.
 */
export const onBudgetPeriodUpdatedPeriodSummary = onDocumentUpdated(
  "budget_periods/{budgetPeriodId}",
  async (event) => {
    const budgetPeriod = event.data?.after.data() as BudgetPeriodDocument;

    if (!budgetPeriod) {
      console.error("[onBudgetPeriodUpdatedSummary] No budget period data");
      return;
    }

    console.log(
      `[onBudgetPeriodUpdatedPeriodSummary] Budget period updated: ${budgetPeriod.id}`
    );

    // Check if userId exists
    if (!budgetPeriod.userId) {
      console.error("[onBudgetPeriodUpdatedPeriodSummary] No userId found in budget period");
      return;
    }

    try {
      // Update the user period summary for this period
      await updateUserPeriodSummary(
        budgetPeriod.userId,
        String(budgetPeriod.periodType), // Convert enum to string
        budgetPeriod.sourcePeriodId,
        false // Don't include detailed entries in triggers
      );

      console.log(
        `[onBudgetPeriodUpdatedSummary] Successfully updated summary for period: ${budgetPeriod.sourcePeriodId}`
      );
    } catch (error) {
      console.error(
        `[onBudgetPeriodUpdatedSummary] Error updating summary:`,
        error
      );
      // Don't throw - we don't want to fail the budget period update
    }
  }
);

/**
 * Trigger: Update user period summary when a budget period is deleted
 *
 * When a budget_period is deleted, this trigger recalculates the
 * user period summary for the corresponding period.
 */
export const onBudgetPeriodDeletedPeriodSummary = onDocumentDeleted(
  "budget_periods/{budgetPeriodId}",
  async (event) => {
    const budgetPeriod = event.data?.data() as BudgetPeriodDocument;

    if (!budgetPeriod) {
      console.error("[onBudgetPeriodDeletedSummary] No budget period data");
      return;
    }

    console.log(
      `[onBudgetPeriodDeletedPeriodSummary] Budget period deleted: ${budgetPeriod.id}`
    );

    // Check if userId exists
    if (!budgetPeriod.userId) {
      console.error("[onBudgetPeriodDeletedPeriodSummary] No userId found in budget period");
      return;
    }

    try {
      // Update the user period summary for this period
      await updateUserPeriodSummary(
        budgetPeriod.userId,
        String(budgetPeriod.periodType), // Convert enum to string
        budgetPeriod.sourcePeriodId,
        false // Don't include detailed entries in triggers
      );

      console.log(
        `[onBudgetPeriodDeletedSummary] Successfully updated summary for period: ${budgetPeriod.sourcePeriodId}`
      );
    } catch (error) {
      console.error(
        `[onBudgetPeriodDeletedSummary] Error updating summary:`,
        error
      );
      // Don't throw - we don't want to fail the budget period deletion
    }
  }
);
