import { onDocumentCreated, onDocumentUpdated, onDocumentDeleted } from "firebase-functions/v2/firestore";
import { InflowPeriod } from "../../../types";
import { updateUserPeriodSummary } from "../orchestration/updateUserPeriodSummary";

/**
 * Trigger: Update user period summary when an inflow period is created
 *
 * When a new inflow_period is created, this trigger recalculates the
 * user period summary for the corresponding period.
 */
export const onInflowPeriodCreatedPeriodSummary = onDocumentCreated(
  "inflow_periods/{inflowPeriodId}",
  async (event) => {
    const inflowPeriod = event.data?.data() as InflowPeriod;

    if (!inflowPeriod) {
      console.error("[onInflowPeriodCreatedSummary] No inflow period data");
      return;
    }

    console.log(
      `[onInflowPeriodCreatedSummary] Inflow period created: ${inflowPeriod.id}`
    );

    try {
      // Update the user period summary for this period
      await updateUserPeriodSummary(
        inflowPeriod.ownerId,
        String(inflowPeriod.periodType), // Convert enum to string
        inflowPeriod.sourcePeriodId,
        false // Don't include detailed entries in triggers
      );

      console.log(
        `[onInflowPeriodCreatedSummary] Successfully updated summary for period: ${inflowPeriod.sourcePeriodId}`
      );
    } catch (error) {
      console.error(
        `[onInflowPeriodCreatedSummary] Error updating summary:`,
        error
      );
      // Don't throw - we don't want to fail the inflow period creation
    }
  }
);

/**
 * Trigger: Update user period summary when an inflow period is updated
 *
 * When an inflow_period is updated, this trigger recalculates the
 * user period summary for the corresponding period.
 */
export const onInflowPeriodUpdatedPeriodSummary = onDocumentUpdated(
  "inflow_periods/{inflowPeriodId}",
  async (event) => {
    const inflowPeriod = event.data?.after.data() as InflowPeriod;

    if (!inflowPeriod) {
      console.error("[onInflowPeriodUpdatedSummary] No inflow period data");
      return;
    }

    console.log(
      `[onInflowPeriodUpdatedSummary] Inflow period updated: ${inflowPeriod.id}`
    );

    try {
      // Update the user period summary for this period
      await updateUserPeriodSummary(
        inflowPeriod.ownerId,
        String(inflowPeriod.periodType), // Convert enum to string
        inflowPeriod.sourcePeriodId,
        false // Don't include detailed entries in triggers
      );

      console.log(
        `[onInflowPeriodUpdatedSummary] Successfully updated summary for period: ${inflowPeriod.sourcePeriodId}`
      );
    } catch (error) {
      console.error(
        `[onInflowPeriodUpdatedSummary] Error updating summary:`,
        error
      );
      // Don't throw - we don't want to fail the inflow period update
    }
  }
);

/**
 * Trigger: Update user period summary when an inflow period is deleted
 *
 * When an inflow_period is deleted, this trigger recalculates the
 * user period summary for the corresponding period.
 */
export const onInflowPeriodDeletedPeriodSummary = onDocumentDeleted(
  "inflow_periods/{inflowPeriodId}",
  async (event) => {
    const inflowPeriod = event.data?.data() as InflowPeriod;

    if (!inflowPeriod) {
      console.error("[onInflowPeriodDeletedSummary] No inflow period data");
      return;
    }

    console.log(
      `[onInflowPeriodDeletedSummary] Inflow period deleted: ${inflowPeriod.id}`
    );

    try {
      // Update the user period summary for this period
      await updateUserPeriodSummary(
        inflowPeriod.ownerId,
        String(inflowPeriod.periodType), // Convert enum to string
        inflowPeriod.sourcePeriodId,
        false // Don't include detailed entries in triggers
      );

      console.log(
        `[onInflowPeriodDeletedSummary] Successfully updated summary for period: ${inflowPeriod.sourcePeriodId}`
      );
    } catch (error) {
      console.error(
        `[onInflowPeriodDeletedSummary] Error updating summary:`,
        error
      );
      // Don't throw - we don't want to fail the inflow period deletion
    }
  }
);
