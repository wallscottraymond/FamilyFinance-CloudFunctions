/**
 * End-to-End Test: Budget Period Summary Flow
 *
 * This test verifies the complete flow from budget creation through
 * budget period summary updates, including the recent fixes:
 * - totalSpent is calculated from actual spending (not hardcoded 0)
 * - maxAmount field exists in BudgetEntry
 * - userNotes field exists in BudgetEntry
 *
 * Test Flow:
 * 1. Create three budgets (weekly, bi-weekly, monthly)
 * 2. Verify budget periods are generated for all three
 * 3. Create transactions to add spending
 * 4. Verify user_summaries are updated correctly
 * 5. Verify our fixes are applied (totalSpent, maxAmount, userNotes)
 */

import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { Budget, BudgetPeriod, PeriodType } from "../../../types";
import { buildAccessControl } from "../../../utils/documentStructure";
import { v4 as uuidv4 } from "uuid";

// Initialize Firebase Admin if not already initialized
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

describe("Budget Period Summary Flow - End to End", () => {
  const testUserId = `test_user_${Date.now()}`;
  const createdBudgetIds: string[] = [];
  const createdTransactionIds: string[] = [];

  afterAll(async () => {
    // Cleanup test data
    console.log("[E2E Test] Cleaning up test data...");

    // Delete budgets
    for (const budgetId of createdBudgetIds) {
      await db.collection("budgets").doc(budgetId).delete();
    }

    // Delete budget periods
    const periodsSnapshot = await db
      .collection("budget_periods")
      .where("userId", "==", testUserId)
      .get();

    const batch = db.batch();
    periodsSnapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });
    await batch.commit();

    // Delete transactions
    for (const transactionId of createdTransactionIds) {
      await db.collection("transactions").doc(transactionId).delete();
    }

    // Delete user_summaries
    const summariesSnapshot = await db
      .collection("user_summaries")
      .where("userId", "==", testUserId)
      .get();

    const summaryBatch = db.batch();
    summariesSnapshot.docs.forEach((doc) => {
      summaryBatch.delete(doc.ref);
    });
    await summaryBatch.commit();

    console.log("[E2E Test] Cleanup complete");
  });

  it("should create three budgets with different period types", async () => {
    const now = new Date();
    const startDate = Timestamp.fromDate(
      new Date(now.getFullYear(), now.getMonth(), 1)
    );

    const oneYearLater = new Date(startDate.toDate());
    oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);
    const endDate = Timestamp.fromDate(oneYearLater);

    const budgetConfigs = [
      {
        name: "E2E Weekly Budget",
        amount: 100,
        period: BudgetPeriod.WEEKLY,
        categoryIds: ["groceries"],
      },
      {
        name: "E2E Bi-Monthly Budget",
        amount: 200,
        period: BudgetPeriod.MONTHLY, // Note: All budgets generate all period types
        categoryIds: ["utilities"],
      },
      {
        name: "E2E Monthly Budget",
        amount: 500,
        period: BudgetPeriod.MONTHLY,
        categoryIds: ["entertainment"],
      },
    ];

    // Create budgets
    for (const config of budgetConfigs) {
      const budgetId = uuidv4();
      const budget: Budget = {
        id: budgetId,
        userId: testUserId,
        groupIds: [],
        isActive: true,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        access: buildAccessControl(testUserId, testUserId, []),
        name: config.name,
        amount: config.amount,
        currency: "USD",
        categoryIds: config.categoryIds,
        period: config.period,
        startDate,
        endDate,
        budgetType: "recurring",
        isOngoing: true,
        spent: 0,
        remaining: config.amount,
        alertThreshold: 80,
        isSystemEverythingElse: false,
        description: `E2E test budget - ${config.period}`,
      };

      await db.collection("budgets").doc(budgetId).set(budget);
      createdBudgetIds.push(budgetId);
    }

    expect(createdBudgetIds.length).toBe(3);
  });

  it("should generate budget periods for all three budgets", async () => {
    // Wait for onBudgetCreate triggers to fire
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const periodCounts = [];

    for (const budgetId of createdBudgetIds) {
      const periodsSnapshot = await db
        .collection("budget_periods")
        .where("budgetId", "==", budgetId)
        .get();

      periodCounts.push(periodsSnapshot.size);

      // Verify periods exist
      expect(periodsSnapshot.size).toBeGreaterThan(0);

      // Verify period types
      const periodTypes = new Set(
        periodsSnapshot.docs.map((doc) => doc.data().periodType)
      );

      expect(periodTypes.has(PeriodType.MONTHLY)).toBe(true);
      expect(periodTypes.has(PeriodType.BI_MONTHLY)).toBe(true);
      expect(periodTypes.has(PeriodType.WEEKLY)).toBe(true);
    }

    console.log("[E2E Test] Period counts:", periodCounts);
  });

  it("should create transactions and update budget spending", async () => {
    const transactionAmount = 75;

    for (const budgetId of createdBudgetIds) {
      // Get budget to find category
      const budgetDoc = await db.collection("budgets").doc(budgetId).get();
      const budgetData = budgetDoc.data() as Budget;

      // Find matching budget period
      const now = Timestamp.now();
      const periodsSnapshot = await db
        .collection("budget_periods")
        .where("budgetId", "==", budgetId)
        .where("periodStart", "<=", now)
        .where("periodEnd", ">=", now)
        .limit(1)
        .get();

      let budgetPeriodId = null;
      if (!periodsSnapshot.empty) {
        budgetPeriodId = periodsSnapshot.docs[0].id;
      }

      // Create transaction
      const transactionId = uuidv4();
      const transaction = {
        id: transactionId,
        userId: testUserId,
        groupIds: [],
        isActive: true,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        amount: transactionAmount,
        description: `E2E test transaction - ${budgetData.name}`,
        date: now,
        categoryId: budgetData.categoryIds[0],
        metadata: {
          source: "test",
          notes: "E2E test transaction",
          createdBy: testUserId,
        },
        budgetId,
        budgetPeriodId,
        type: "expense",
        status: "completed",
      };

      await db.collection("transactions").doc(transactionId).set(transaction);
      createdTransactionIds.push(transactionId);
    }

    expect(createdTransactionIds.length).toBe(3);

    // Wait for updateBudgetSpending trigger to fire
    await new Promise((resolve) => setTimeout(resolve, 5000));
  });

  it("should verify budget periods have updated spending", async () => {
    for (const budgetId of createdBudgetIds) {
      const now = Timestamp.now();
      const periodsSnapshot = await db
        .collection("budget_periods")
        .where("budgetId", "==", budgetId)
        .where("periodStart", "<=", now)
        .where("periodEnd", ">=", now)
        .limit(1)
        .get();

      expect(periodsSnapshot.empty).toBe(false);

      const periodData = periodsSnapshot.docs[0].data();

      // Verify spending was updated
      expect(periodData.spent).toBeGreaterThan(0);
      expect(periodData.spent).toBe(75); // Should match transaction amount

      console.log(`[E2E Test] Budget ${budgetId} period spending:`, {
        allocated: periodData.allocatedAmount,
        spent: periodData.spent,
        remaining: periodData.remaining,
      });
    }
  });

  it("should verify user_summaries are updated with correct data", async () => {
    // Wait for summary updates
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const summariesSnapshot = await db
      .collection("user_summaries")
      .where("userId", "==", testUserId)
      .get();

    expect(summariesSnapshot.size).toBeGreaterThan(0);

    let budgetEntriesFound = 0;

    summariesSnapshot.docs.forEach((doc) => {
      const data = doc.data();
      const budgetEntries = data.budgets || [];

      createdBudgetIds.forEach((budgetId) => {
        const entry = budgetEntries.find((b: any) => b.budgetId === budgetId);

        if (entry) {
          budgetEntriesFound++;

          console.log(`[E2E Test] Budget entry found in summary:`, {
            budgetId,
            budgetName: entry.budgetName,
            totalAllocated: entry.totalAllocated,
            totalSpent: entry.totalSpent,
            maxAmount: entry.maxAmount,
            userNotes: entry.userNotes,
          });

          // ===================================================================
          // CRITICAL VERIFICATIONS - Our Fixes
          // ===================================================================

          // FIX 1: totalSpent should NOT be hardcoded 0
          expect(entry.totalSpent).toBeGreaterThan(0);
          expect(entry.totalSpent).toBe(75); // Should match transaction amount

          // FIX 2: maxAmount field should exist
          expect(entry.maxAmount).toBeDefined();
          expect(entry.maxAmount).toBe(entry.totalAllocated);

          // FIX 3: userNotes field should exist (even if undefined)
          expect(entry).toHaveProperty("userNotes");

          // Other standard fields
          expect(entry.totalAllocated).toBeGreaterThan(0);
          expect(entry.totalRemaining).toBeDefined();
          expect(entry.progressPercentage).toBeGreaterThan(0);
        }
      });
    });

    // Verify we found budget entries in summaries
    expect(budgetEntriesFound).toBeGreaterThan(0);
  });

  it("should verify all three budget types appear in summaries", async () => {
    const summariesSnapshot = await db
      .collection("user_summaries")
      .where("userId", "==", testUserId)
      .get();

    const budgetsByPeriodType: Record<string, number> = {
      MONTHLY: 0,
      BI_MONTHLY: 0,
      WEEKLY: 0,
    };

    summariesSnapshot.docs.forEach((doc) => {
      const data = doc.data();
      const budgetEntries = data.budgets || [];

      if (budgetEntries.length > 0) {
        budgetsByPeriodType[data.periodType] += budgetEntries.length;
      }
    });

    console.log("[E2E Test] Budgets by period type:", budgetsByPeriodType);

    // Each period type should have at least one budget
    expect(budgetsByPeriodType.MONTHLY).toBeGreaterThan(0);
    expect(budgetsByPeriodType.BI_MONTHLY).toBeGreaterThan(0);
    expect(budgetsByPeriodType.WEEKLY).toBeGreaterThan(0);
  });
});
