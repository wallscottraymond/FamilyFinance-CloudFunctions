/**
 * Update Inflow Configuration Callable
 *
 * Two kinds of call:
 * - The "Regular Salary" toggle: `isRegularSalary` present → saves ONLY that flag. (The app sent
 *   its screen's default type alongside it; the type and configs are left alone — Code-Health-
 *   Review M7-H1.)
 * - A type / config edit: saves the type, its variability and the config blocks SENT (blocks not
 *   sent are kept — M2-M2). When the config implies an amount (hourly rate × hours, base +
 *   commission, …) that differs from the current expected amount, it becomes the income's
 *   expected amount (`expectedAmountOverride`), which the period page, the stored periods
 *   (runUpdateInflowPeriods via on_inflow_updated) and the extenders all follow. Period AMOUNTS
 *   are never written here; only the denormalized `incomeType` / `predictionConfidence`.
 * - Sets isUserClassified: true to indicate user has configured the income
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import {
  IncomeType,
  IncomeVariability,
  HourlyIncomeConfig,
  CommissionIncomeConfig,
  BonusIncomeConfig,
  VariableIncomeConfig,
  InflowPeriod
} from "../../../../types";

interface UpdateInflowConfigRequest {
  inflowId: string;
  /** Required for a type / config edit; ignored when isRegularSalary is sent (the toggle). */
  incomeType?: IncomeType;
  isRegularSalary?: boolean;
  incomeVariability?: IncomeVariability;
  hourlyConfig?: HourlyIncomeConfig;
  commissionConfig?: CommissionIncomeConfig;
  bonusConfig?: BonusIncomeConfig;
  variableConfig?: VariableIncomeConfig;
}

interface UpdateInflowConfigResponse {
  success: boolean;
  inflowId: string;
  periodsUpdated: number;
  newPrediction: {
    expectedAmount: number;
    confidence: "high" | "medium" | "low";
  };
}

/**
 * Get the default variability for an income type
 */
function getDefaultVariability(incomeType: IncomeType): IncomeVariability {
  switch (incomeType) {
  case IncomeType.SALARY:
  case IncomeType.PENSION:
    return IncomeVariability.FIXED;
  case IncomeType.RENTAL:
  case IncomeType.GOVERNMENT:
    return IncomeVariability.LOW;
  case IncomeType.HOURLY:
  case IncomeType.BASE_PLUS_COMMISSION:
  case IncomeType.INVESTMENT:
    return IncomeVariability.MEDIUM;
  case IncomeType.COMMISSION_ONLY:
  case IncomeType.BONUS:
  case IncomeType.FREELANCE:
    return IncomeVariability.HIGH;
  default:
    return IncomeVariability.MEDIUM;
  }
}

/**
 * Calculate prediction confidence based on income type
 */
function getPredictionConfidence(incomeType: IncomeType): "high" | "medium" | "low" {
  switch (incomeType) {
  case IncomeType.SALARY:
  case IncomeType.PENSION:
  case IncomeType.GOVERNMENT:
  case IncomeType.RENTAL:
    return "high";
  case IncomeType.HOURLY:
  case IncomeType.BASE_PLUS_COMMISSION:
  case IncomeType.INVESTMENT:
    return "medium";
  case IncomeType.COMMISSION_ONLY:
  case IncomeType.BONUS:
  case IncomeType.FREELANCE:
  case IncomeType.OTHER:
    return "low";
  default:
    return "medium";
  }
}

/**
 * Calculate expected amount based on income type and configuration
 */
function calculateExpectedAmount(
  incomeType: IncomeType,
  averageAmount: number,
  config: {
    hourlyConfig?: HourlyIncomeConfig;
    commissionConfig?: CommissionIncomeConfig;
    bonusConfig?: BonusIncomeConfig;
    variableConfig?: VariableIncomeConfig;
  }
): number {
  switch (incomeType) {
  case IncomeType.SALARY:
  case IncomeType.PENSION:
  case IncomeType.GOVERNMENT:
  case IncomeType.RENTAL:
    // Fixed income types use the average amount
    return averageAmount;

  case IncomeType.HOURLY:
    if (config.hourlyConfig) {
      const { hourlyRate, expectedHoursPerPeriod, includeOvertime, overtimeRate, expectedOvertimeHours } = config.hourlyConfig;
      let total = hourlyRate * expectedHoursPerPeriod;
      if (includeOvertime && overtimeRate && expectedOvertimeHours) {
        total += hourlyRate * overtimeRate * expectedOvertimeHours;
      }
      return Math.round(total * 100) / 100;
    }
    return averageAmount;

  case IncomeType.BASE_PLUS_COMMISSION:
    if (config.commissionConfig) {
      const baseAmount = config.commissionConfig.baseAmount || 0;
      const targetCommission = config.commissionConfig.targetCommission || 0;
      return baseAmount + targetCommission;
    }
    return averageAmount;

  case IncomeType.COMMISSION_ONLY:
    // Use rolling average or user override
    if (config.variableConfig?.userOverrideAmount != null) {
      return config.variableConfig.userOverrideAmount;
    }
    // Otherwise use the existing average
    return averageAmount;

  case IncomeType.BONUS:
    // Use last bonus amount if available
    if (config.bonusConfig?.lastBonusAmount) {
      return config.bonusConfig.lastBonusAmount;
    }
    return averageAmount;

  case IncomeType.FREELANCE:
  case IncomeType.INVESTMENT:
  case IncomeType.OTHER:
    // Use user override or rolling average
    if (config.variableConfig?.userOverrideAmount != null) {
      return config.variableConfig.userOverrideAmount;
    }
    return averageAmount;

  default:
    return averageAmount;
  }
}

/**
 * JSON with sorted object keys, so a stored map equals the same config sent in another key order.
 */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).sort()
      .filter((k) => obj[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stableJson(obj[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export const updateInflowConfiguration = onCall(
  {
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 120,
  },
  async (request): Promise<UpdateInflowConfigResponse> => {
    // Verify authentication
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }

    const userId = request.auth.uid;
    const data = request.data as UpdateInflowConfigRequest;
    const {
      inflowId, incomeType, isRegularSalary, incomeVariability,
      hourlyConfig, commissionConfig, bonusConfig, variableConfig,
    } = data;
    const isToggle = typeof isRegularSalary === "boolean";

    // Validate required fields
    if (!inflowId) {
      throw new HttpsError("invalid-argument", "inflowId is required");
    }
    if (!isToggle) {
      if (!incomeType) {
        throw new HttpsError("invalid-argument", "incomeType is required");
      }
      // Validate income type is valid enum value
      if (!Object.values(IncomeType).includes(incomeType)) {
        throw new HttpsError("invalid-argument", `Invalid incomeType: ${incomeType}`);
      }
    }

    const db = admin.firestore();
    const now = Timestamp.now();

    const change = isToggle ? `isRegularSalary: ${isRegularSalary}` : `incomeType: ${incomeType}`;
    console.log(`[updateInflowConfiguration] Starting for inflowId: ${inflowId}, ${change}`);

    try {
      // Get the inflow document
      const inflowRef = db.collection("inflows").doc(inflowId);
      const inflowDoc = await inflowRef.get();

      if (!inflowDoc.exists) {
        throw new HttpsError("not-found", `Inflow ${inflowId} not found`);
      }

      const inflowData = inflowDoc.data()!;

      // Verify ownership
      if (inflowData.ownerId !== userId) {
        throw new HttpsError("permission-denied", "You can only update your own inflows");
      }

      // The income's current expected amount: the user's, else Plaid's average (as the period page).
      const currentExpected = Math.abs(
        (inflowData.expectedAmountOverride as number | null | undefined) ?? inflowData.averageAmount ?? 0
      );

      if (isToggle) {
        await inflowRef.update({ isRegularSalary, updatedAt: now, updatedBy: userId });
        console.log(`[updateInflowConfiguration] Updated isRegularSalary on ${inflowId}`);
        const storedType = (inflowData.incomeType as IncomeType) || IncomeType.OTHER;
        return {
          success: true,
          inflowId,
          periodsUpdated: 0,
          newPrediction: {
            expectedAmount: currentExpected,
            confidence: getPredictionConfidence(storedType),
          },
        };
      }

      const type = incomeType as IncomeType;
      // Only a config block the user CHANGED may set the expected amount: the app sends the stored
      // blocks back on every save, and an unchanged one must not undo a later amount edit.
      const changed = <T>(sent: T | undefined, stored: unknown): T | undefined =>
        sent && stableJson(sent) !== stableJson(stored ?? null) ? sent : undefined;
      const configExpected = calculateExpectedAmount(type, currentExpected, {
        hourlyConfig: changed(hourlyConfig, inflowData.hourlyConfig),
        commissionConfig: changed(commissionConfig, inflowData.commissionConfig),
        bonusConfig: changed(bonusConfig, inflowData.bonusConfig),
        variableConfig: changed(variableConfig, inflowData.variableConfig),
      });
      const newExpectedAmount = Math.round(configExpected * 100) / 100;

      // Determine variability (use provided or calculate default)
      const finalVariability = incomeVariability || getDefaultVariability(type);
      const predictionConfidence = getPredictionConfidence(type);

      // Build update object for inflow
      const inflowUpdate: Record<string, any> = {
        incomeType: type,
        incomeVariability: finalVariability,
        isUserClassified: true,
        updatedAt: now,
        updatedBy: userId
      };

      // Save the config blocks sent; the others stay as they were.
      if (hourlyConfig) inflowUpdate.hourlyConfig = hourlyConfig;
      if (commissionConfig) inflowUpdate.commissionConfig = commissionConfig;
      if (bonusConfig) inflowUpdate.bonusConfig = bonusConfig;
      if (variableConfig) inflowUpdate.variableConfig = variableConfig;

      // A config that implies a different amount becomes the income's expected amount.
      if (newExpectedAmount > 0 && Math.abs(newExpectedAmount - currentExpected) >= 0.005) {
        inflowUpdate.expectedAmountOverride = newExpectedAmount;
      }

      // Update the inflow document
      await inflowRef.update(inflowUpdate);
      console.log(`[updateInflowConfiguration] Updated inflow ${inflowId}`);

      // Refresh the denormalized type on its periods (amounts follow the definition's expected
      // amount through on_inflow_updated → runUpdateInflowPeriods).
      const periodsSnapshot = await db.collection("inflow_periods")
        .where("inflowId", "==", inflowId)
        .get();

      let periodsUpdated = 0;
      const batchSize = 500;
      let batch = db.batch();
      let batchCount = 0;

      for (const periodDoc of periodsSnapshot.docs) {
        const periodUpdate: Partial<InflowPeriod> = {
          incomeType: type,
          predictionConfidence: predictionConfidence,
          updatedAt: now,
        };
        batch.update(periodDoc.ref, periodUpdate);
        batchCount++;
        periodsUpdated++;

        // Commit batch when it reaches the limit
        if (batchCount >= batchSize) {
          await batch.commit();
          batch = db.batch();
          batchCount = 0;
        }
      }

      // Commit remaining updates
      if (batchCount > 0) {
        await batch.commit();
      }

      console.log(`[updateInflowConfiguration] Updated ${periodsUpdated} periods`);

      return {
        success: true,
        inflowId,
        periodsUpdated,
        newPrediction: {
          expectedAmount: newExpectedAmount,
          confidence: predictionConfidence
        }
      };

    } catch (error: any) {
      console.error("[updateInflowConfiguration] Error:", error);
      if (error instanceof HttpsError) {
        throw error;
      }
      throw new HttpsError("internal", error.message || "Failed to update inflow configuration");
    }
  }
);
