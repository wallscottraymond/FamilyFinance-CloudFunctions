import { onDocumentUpdated, onDocumentDeleted } from "firebase-functions/v2/firestore";
import { OutflowPeriod } from "../../../types";
import { updateUserPeriodSummary } from "../orchestration/updateUserPeriodSummary";

/**
 * Trigger: Update user period summary when an outflow period is created
 *
 * DISABLED: This trigger has been disabled to prevent duplicate summary updates
 * when outflows are created. The onOutflowCreated trigger now handles batch
 * summary updates for all periods after they are created.
 *
 * This trigger is commented out but preserved for reference. If you need to
 * re-enable individual period creation updates, uncomment the export below.
 */
/* DISABLED - Batch updates handled by onOutflowCreated
export const onOutflowPeriodCreatedPeriodSummary = onDocumentCreated(
  "outflow_periods/{outflowPeriodId}",
  async (event) => {
    const outflowPeriod = event.data?.data() as OutflowPeriod;

    if (!outflowPeriod) {
      console.error("[onOutflowPeriodCreatedSummary] No outflow period data");
      return;
    }

    console.log(
      `[onOutflowPeriodCreatedSummary] Outflow period created: ${outflowPeriod.id}`
    );

    try {
      // Update the user period summary for this period
      await updateUserPeriodSummary(
        outflowPeriod.ownerId,
        String(outflowPeriod.periodType), // Convert enum to string
        outflowPeriod.sourcePeriodId,
        false // Don't include detailed entries in triggers
      );

      console.log(
        `[onOutflowPeriodCreatedSummary] Successfully updated summary for period: ${outflowPeriod.sourcePeriodId}`
      );
    } catch (error) {
      console.error(
        `[onOutflowPeriodCreatedSummary] Error updating summary:`,
        error
      );
      // Don't throw - we don't want to fail the outflow period creation
    }
  }
);
*/ // END DISABLED

/**
 * Trigger: Update user period summary when an outflow period is updated
 *
 * When an outflow_period is updated, this trigger recalculates the
 * user period summary for the corresponding period.
 */
export const onOutflowPeriodUpdatedPeriodSummary = onDocumentUpdated(
  "outflow_periods/{outflowPeriodId}",
  async (event) => {
    const outflowPeriod = event.data?.after.data() as OutflowPeriod;

    if (!outflowPeriod) {
      console.error("[onOutflowPeriodUpdatedSummary] No outflow period data");
      return;
    }

    console.log(
      `[onOutflowPeriodUpdatedSummary] Outflow period updated: ${outflowPeriod.id}`
    );

    try {
      // Update the user period summary for this period
      await updateUserPeriodSummary(
        outflowPeriod.ownerId,
        String(outflowPeriod.periodType), // Convert enum to string
        outflowPeriod.sourcePeriodId,
        false // Don't include detailed entries in triggers
      );

      console.log(
        `[onOutflowPeriodUpdatedSummary] Successfully updated summary for period: ${outflowPeriod.sourcePeriodId}`
      );
    } catch (error) {
      console.error(
        `[onOutflowPeriodUpdatedSummary] Error updating summary:`,
        error
      );
      // Don't throw - we don't want to fail the outflow period update
    }
  }
);

/**
 * Trigger: Update user period summary when an outflow period is deleted
 *
 * When an outflow_period is deleted, this trigger recalculates the
 * user period summary for the corresponding period.
 */
export const onOutflowPeriodDeletedPeriodSummary = onDocumentDeleted(
  "outflow_periods/{outflowPeriodId}",
  async (event) => {
    const outflowPeriod = event.data?.data() as OutflowPeriod;

    if (!outflowPeriod) {
      console.error("[onOutflowPeriodDeletedSummary] No outflow period data");
      return;
    }

    console.log(
      `[onOutflowPeriodDeletedSummary] Outflow period deleted: ${outflowPeriod.id}`
    );

    try {
      // Update the user period summary for this period
      await updateUserPeriodSummary(
        outflowPeriod.ownerId,
        String(outflowPeriod.periodType), // Convert enum to string
        outflowPeriod.sourcePeriodId,
        false // Don't include detailed entries in triggers
      );

      console.log(
        `[onOutflowPeriodDeletedSummary] Successfully updated summary for period: ${outflowPeriod.sourcePeriodId}`
      );
    } catch (error) {
      console.error(
        `[onOutflowPeriodDeletedSummary] Error updating summary:`,
        error
      );
      // Don't throw - we don't want to fail the outflow period deletion
    }
  }
);
