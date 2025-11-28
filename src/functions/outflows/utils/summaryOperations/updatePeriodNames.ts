import { OutflowPeriodEntry } from "../../../../types";

/**
 * Update merchant and userCustomName for all entries of a specific outflow
 *
 * This function is called when:
 * - outflow.merchantName changes
 * - outflow.userCustomName changes
 * - outflow.description changes (fallback for merchant)
 *
 * It updates the denormalized merchant/userCustomName fields across all
 * period entries for the given outflow, preserving all other data.
 *
 * @param params - Update parameters
 * @returns Updated periods object ready for batch write
 */
export function updatePeriodNames(params: {
  currentPeriods: { [sourcePeriodId: string]: OutflowPeriodEntry[] };
  outflowId: string;
  merchant: string;
  userCustomName: string;
}): { [sourcePeriodId: string]: OutflowPeriodEntry[] } {
  const { currentPeriods, outflowId, merchant, userCustomName } = params;

  console.log(`🔄 Updating period names for outflow ${outflowId}:`, {
    merchant,
    userCustomName
  });

  let updatedCount = 0;
  const updatedPeriods = { ...currentPeriods };

  // Iterate through all period groups
  for (const sourcePeriodId in updatedPeriods) {
    const entries = updatedPeriods[sourcePeriodId];

    // Update entries that match the outflowId
    updatedPeriods[sourcePeriodId] = entries.map(entry => {
      if (entry.outflowId === outflowId) {
        updatedCount++;
        return {
          ...entry,
          merchant,
          userCustomName
        };
      }
      return entry;
    });
  }

  console.log(`✅ Updated ${updatedCount} period entries with new names`);

  return updatedPeriods;
}
