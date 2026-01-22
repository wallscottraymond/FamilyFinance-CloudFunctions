import { Timestamp } from "firebase-admin/firestore";
import { BudgetPeriodDocument, PeriodType } from "../../../../types";
import { calculateBudgetSummary } from "../calculateBudgetSummary";

describe("calculateBudgetSummary", () => {
  const mockTimestamp = Timestamp.now();

  const createMockBudgetPeriod = (
    overrides: Partial<BudgetPeriodDocument> = {}
  ): BudgetPeriodDocument => ({
    id: "period-123",
    budgetId: "budget-456",
    budgetName: "Test Budget",
    periodId: "2025-M01",
    sourcePeriodId: "2025-M01",
    periodType: PeriodType.MONTHLY,
    periodStart: mockTimestamp,
    periodEnd: mockTimestamp,
    allocatedAmount: 500,
    originalAmount: 500,
    spent: 0,
    remaining: 500,
    isModified: false,
    checklistItems: [],
    lastCalculated: mockTimestamp,
    isActive: true,
    userId: "user-123",
    groupIds: [],
    createdAt: mockTimestamp,
    updatedAt: mockTimestamp,
    ...overrides,
  });

  test("should use actual spent amount from budget period", () => {
    const budgetPeriods = [
      createMockBudgetPeriod({
        spent: 150,
        allocatedAmount: 500,
      }),
    ];

    const entries = calculateBudgetSummary(budgetPeriods);

    expect(entries).toHaveLength(1);
    expect(entries[0].totalSpent).toBe(150); // Not 0!
    expect(entries[0].totalRemaining).toBe(350);
    expect(entries[0].progressPercentage).toBe(30);
  });

  test("should handle zero spending", () => {
    const budgetPeriods = [
      createMockBudgetPeriod({
        spent: 0,
        allocatedAmount: 500,
      }),
    ];

    const entries = calculateBudgetSummary(budgetPeriods);

    expect(entries[0].totalSpent).toBe(0);
    expect(entries[0].totalRemaining).toBe(500);
    expect(entries[0].progressPercentage).toBe(0);
    expect(entries[0].isOverBudget).toBe(false);
  });

  test("should include userNotes when present", () => {
    const budgetPeriods = [
      createMockBudgetPeriod({
        spent: 100,
        allocatedAmount: 500,
        userNotes: "Groceries this month",
      }),
    ];

    const entries = calculateBudgetSummary(budgetPeriods);

    expect(entries[0].userNotes).toBe("Groceries this month");
  });

  test("should handle undefined userNotes", () => {
    const budgetPeriods = [
      createMockBudgetPeriod({
        spent: 100,
        allocatedAmount: 500,
        userNotes: undefined,
      }),
    ];

    const entries = calculateBudgetSummary(budgetPeriods);

    expect(entries[0].userNotes).toBeUndefined();
  });

  test("should handle over-budget scenarios", () => {
    const budgetPeriods = [
      createMockBudgetPeriod({
        spent: 600,
        allocatedAmount: 500,
      }),
    ];

    const entries = calculateBudgetSummary(budgetPeriods);

    expect(entries[0].isOverBudget).toBe(true);
    expect(entries[0].overageAmount).toBe(100);
    expect(entries[0].totalRemaining).toBe(-100);
  });

  test("should populate maxAmount field", () => {
    const budgetPeriods = [
      createMockBudgetPeriod({
        spent: 100,
        allocatedAmount: 500,
      }),
    ];

    const entries = calculateBudgetSummary(budgetPeriods);

    expect(entries[0].maxAmount).toBe(500);
    expect(entries[0].totalAllocated).toBe(500); // Backward compatibility
  });

  test("should work with 'everything else' budget (zero allocated)", () => {
    const budgetPeriods = [
      createMockBudgetPeriod({
        budgetName: "Everything Else",
        spent: 75,
        allocatedAmount: 0,
        remaining: -75,
      }),
    ];

    const entries = calculateBudgetSummary(budgetPeriods);

    expect(entries[0].totalSpent).toBe(75);
    expect(entries[0].maxAmount).toBe(0);
    expect(entries[0].totalAllocated).toBe(0);
    expect(entries[0].isOverBudget).toBe(true); // Over $0 budget
    expect(entries[0].overageAmount).toBe(75);
    expect(entries[0].progressPercentage).toBe(0); // Avoid divide by zero
  });

  test("should use modifiedAmount when present", () => {
    const budgetPeriods = [
      createMockBudgetPeriod({
        allocatedAmount: 500,
        modifiedAmount: 600,
        spent: 550,
        isModified: true,
      }),
    ];

    const entries = calculateBudgetSummary(budgetPeriods);

    expect(entries[0].maxAmount).toBe(600); // Uses modified amount
    expect(entries[0].totalAllocated).toBe(600);
    expect(entries[0].totalRemaining).toBe(50);
    expect(entries[0].isOverBudget).toBe(false);
  });

  test("should calculate checklist metrics correctly", () => {
    const budgetPeriods = [
      createMockBudgetPeriod({
        spent: 100,
        allocatedAmount: 500,
        checklistItems: [
          {
            id: "item-1",
            name: "Item 1",
            transactionSplit: "",
            expectedAmount: 50,
            actualAmount: 50,
            isChecked: true,
          },
          {
            id: "item-2",
            name: "Item 2",
            transactionSplit: "",
            expectedAmount: 50,
            actualAmount: 0,
            isChecked: false,
          },
          {
            id: "item-3",
            name: "Item 3",
            transactionSplit: "",
            expectedAmount: 50,
            actualAmount: 50,
            isChecked: true,
          },
        ],
      }),
    ];

    const entries = calculateBudgetSummary(budgetPeriods);

    expect(entries[0].checklistItemsCount).toBe(3);
    expect(entries[0].checklistItemsCompleted).toBe(2);
    expect(entries[0].checklistProgressPercentage).toBe(67); // 2/3 * 100 rounded
  });

  test("should not include checklist fields when no items", () => {
    const budgetPeriods = [
      createMockBudgetPeriod({
        spent: 100,
        allocatedAmount: 500,
        checklistItems: [],
      }),
    ];

    const entries = calculateBudgetSummary(budgetPeriods);

    expect(entries[0].checklistItemsCount).toBeUndefined();
    expect(entries[0].checklistItemsCompleted).toBeUndefined();
    expect(entries[0].checklistProgressPercentage).toBeUndefined();
  });

  test("should handle multiple budget periods", () => {
    const budgetPeriods = [
      createMockBudgetPeriod({
        id: "period-1",
        budgetId: "budget-1",
        budgetName: "Groceries",
        spent: 150,
        allocatedAmount: 500,
      }),
      createMockBudgetPeriod({
        id: "period-2",
        budgetId: "budget-2",
        budgetName: "Transportation",
        spent: 75,
        allocatedAmount: 200,
      }),
      createMockBudgetPeriod({
        id: "period-3",
        budgetId: "budget-3",
        budgetName: "Entertainment",
        spent: 0,
        allocatedAmount: 100,
      }),
    ];

    const entries = calculateBudgetSummary(budgetPeriods);

    expect(entries).toHaveLength(3);

    expect(entries[0].budgetName).toBe("Groceries");
    expect(entries[0].totalSpent).toBe(150);

    expect(entries[1].budgetName).toBe("Transportation");
    expect(entries[1].totalSpent).toBe(75);

    expect(entries[2].budgetName).toBe("Entertainment");
    expect(entries[2].totalSpent).toBe(0);
  });

  test("should handle missing spent field (backward compatibility)", () => {
    const budgetPeriods = [
      createMockBudgetPeriod({
        spent: undefined,
        allocatedAmount: 500,
      }),
    ];

    const entries = calculateBudgetSummary(budgetPeriods);

    expect(entries[0].totalSpent).toBe(0); // Fallback to 0
    expect(entries[0].totalRemaining).toBe(500);
  });

  test("should populate groupId from groupIds array", () => {
    const budgetPeriods = [
      createMockBudgetPeriod({
        spent: 100,
        allocatedAmount: 500,
        groupIds: ["group-123", "group-456"],
      }),
    ];

    const entries = calculateBudgetSummary(budgetPeriods);

    expect(entries[0].groupId).toBe("group-123"); // First group ID
  });

  test("should handle empty groupIds array", () => {
    const budgetPeriods = [
      createMockBudgetPeriod({
        spent: 100,
        allocatedAmount: 500,
        groupIds: [],
      }),
    ];

    const entries = calculateBudgetSummary(budgetPeriods);

    expect(entries[0].groupId).toBe(""); // Empty string fallback
  });

  test("should include all required identity fields", () => {
    const budgetPeriods = [
      createMockBudgetPeriod({
        id: "period-789",
        budgetId: "budget-012",
        budgetName: "Test Budget Name",
        spent: 100,
        allocatedAmount: 500,
      }),
    ];

    const entries = calculateBudgetSummary(budgetPeriods);

    expect(entries[0].budgetId).toBe("budget-012");
    expect(entries[0].budgetPeriodId).toBe("period-789");
    expect(entries[0].budgetName).toBe("Test Budget Name");
    expect(entries[0].categoryId).toBe("uncategorized");
  });

  test("should handle budget at exactly 100% spent", () => {
    const budgetPeriods = [
      createMockBudgetPeriod({
        spent: 500,
        allocatedAmount: 500,
      }),
    ];

    const entries = calculateBudgetSummary(budgetPeriods);

    expect(entries[0].totalSpent).toBe(500);
    expect(entries[0].totalRemaining).toBe(0);
    expect(entries[0].progressPercentage).toBe(100);
    expect(entries[0].isOverBudget).toBe(false);
    expect(entries[0].overageAmount).toBeUndefined();
  });

  test("should return empty array for empty input", () => {
    const entries = calculateBudgetSummary([]);

    expect(entries).toEqual([]);
  });
});
