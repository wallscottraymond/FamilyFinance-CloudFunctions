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

  // ============================================================================
  // ROLLOVER TESTS
  // ============================================================================

  describe("rollover integration", () => {
    test("should include positive rollover in remaining calculation", () => {
      const budgetPeriods = [
        createMockBudgetPeriod({
          allocatedAmount: 500,
          spent: 300,
          rolledOverAmount: 100, // +$100 surplus from previous period
        }),
      ];

      const entries = calculateBudgetSummary(budgetPeriods);

      expect(entries[0].rolledOverAmount).toBe(100);
      expect(entries[0].effectiveAmount).toBe(600); // 500 + 100
      expect(entries[0].totalRemaining).toBe(300); // 600 - 300
      expect(entries[0].hasRollover).toBe(true);
    });

    test("should include negative rollover in remaining calculation", () => {
      const budgetPeriods = [
        createMockBudgetPeriod({
          allocatedAmount: 500,
          spent: 200,
          rolledOverAmount: -150, // -$150 deficit from previous period
        }),
      ];

      const entries = calculateBudgetSummary(budgetPeriods);

      expect(entries[0].rolledOverAmount).toBe(-150);
      expect(entries[0].effectiveAmount).toBe(350); // 500 - 150
      expect(entries[0].totalRemaining).toBe(150); // 350 - 200
      expect(entries[0].hasRollover).toBe(true);
    });

    test("should allow negative remaining with large deficit rollover", () => {
      const budgetPeriods = [
        createMockBudgetPeriod({
          allocatedAmount: 500,
          spent: 200,
          rolledOverAmount: -400, // Large deficit
        }),
      ];

      const entries = calculateBudgetSummary(budgetPeriods);

      expect(entries[0].effectiveAmount).toBe(100); // 500 - 400
      expect(entries[0].totalRemaining).toBe(-100); // 100 - 200
      expect(entries[0].isOverBudget).toBe(true);
      expect(entries[0].overageAmount).toBe(100);
    });

    test("should not include rollover fields when no rollover exists", () => {
      const budgetPeriods = [
        createMockBudgetPeriod({
          allocatedAmount: 500,
          spent: 300,
          rolledOverAmount: 0,
        }),
      ];

      const entries = calculateBudgetSummary(budgetPeriods);

      expect(entries[0].rolledOverAmount).toBeUndefined();
      expect(entries[0].effectiveAmount).toBeUndefined();
      expect(entries[0].hasRollover).toBeUndefined();
    });

    test("should not include rollover fields when rollover is undefined", () => {
      const budgetPeriods = [
        createMockBudgetPeriod({
          allocatedAmount: 500,
          spent: 300,
          rolledOverAmount: undefined,
        }),
      ];

      const entries = calculateBudgetSummary(budgetPeriods);

      expect(entries[0].rolledOverAmount).toBeUndefined();
      expect(entries[0].effectiveAmount).toBeUndefined();
      expect(entries[0].hasRollover).toBeUndefined();
      expect(entries[0].totalRemaining).toBe(200); // 500 - 300
    });

    test("should calculate progress percentage using effective amount", () => {
      const budgetPeriods = [
        createMockBudgetPeriod({
          allocatedAmount: 500,
          spent: 300,
          rolledOverAmount: 100, // Effective = 600
        }),
      ];

      const entries = calculateBudgetSummary(budgetPeriods);

      // 300 / 600 = 50%
      expect(entries[0].progressPercentage).toBe(50);
    });

    test("should show 100% progress when negative rollover exceeds allocated", () => {
      const budgetPeriods = [
        createMockBudgetPeriod({
          allocatedAmount: 500,
          spent: 0,
          rolledOverAmount: -600, // Effective = -100
        }),
      ];

      const entries = calculateBudgetSummary(budgetPeriods);

      expect(entries[0].progressPercentage).toBe(100); // Already over due to negative rollover
      expect(entries[0].isOverBudget).toBe(true);
    });

    test("should detect over budget correctly with rollover", () => {
      const budgetPeriods = [
        createMockBudgetPeriod({
          allocatedAmount: 500,
          spent: 400,
          rolledOverAmount: -150, // Effective = 350
        }),
      ];

      const entries = calculateBudgetSummary(budgetPeriods);

      expect(entries[0].isOverBudget).toBe(true); // 400 > 350
      expect(entries[0].overageAmount).toBe(50);
    });

    test("should not be over budget when rollover provides buffer", () => {
      const budgetPeriods = [
        createMockBudgetPeriod({
          allocatedAmount: 500,
          spent: 550,
          rolledOverAmount: 100, // Effective = 600
        }),
      ];

      const entries = calculateBudgetSummary(budgetPeriods);

      expect(entries[0].isOverBudget).toBe(false); // 550 <= 600
      expect(entries[0].overageAmount).toBeUndefined();
    });

    test("should combine modified amount with rollover", () => {
      const budgetPeriods = [
        createMockBudgetPeriod({
          allocatedAmount: 500,
          modifiedAmount: 600,
          spent: 400,
          rolledOverAmount: 50,
          isModified: true,
        }),
      ];

      const entries = calculateBudgetSummary(budgetPeriods);

      expect(entries[0].maxAmount).toBe(600); // Uses modified
      expect(entries[0].effectiveAmount).toBe(650); // 600 + 50
      expect(entries[0].totalRemaining).toBe(250); // 650 - 400
    });

    test("should handle multiple periods with different rollover states", () => {
      const budgetPeriods = [
        createMockBudgetPeriod({
          id: "period-1",
          budgetName: "Groceries",
          allocatedAmount: 500,
          spent: 400,
          rolledOverAmount: 100,
        }),
        createMockBudgetPeriod({
          id: "period-2",
          budgetName: "Transport",
          allocatedAmount: 200,
          spent: 150,
          rolledOverAmount: -50,
        }),
        createMockBudgetPeriod({
          id: "period-3",
          budgetName: "Entertainment",
          allocatedAmount: 100,
          spent: 50,
          rolledOverAmount: 0, // No rollover
        }),
      ];

      const entries = calculateBudgetSummary(budgetPeriods);

      expect(entries).toHaveLength(3);

      // Groceries: 500 + 100 - 400 = 200
      expect(entries[0].totalRemaining).toBe(200);
      expect(entries[0].hasRollover).toBe(true);

      // Transport: 200 - 50 - 150 = 0
      expect(entries[1].totalRemaining).toBe(0);
      expect(entries[1].hasRollover).toBe(true);

      // Entertainment: 100 - 50 = 50 (no rollover fields)
      expect(entries[2].totalRemaining).toBe(50);
      expect(entries[2].hasRollover).toBeUndefined();
    });

    test("should handle zero allocated with rollover", () => {
      const budgetPeriods = [
        createMockBudgetPeriod({
          budgetName: "Everything Else",
          allocatedAmount: 0,
          spent: 100,
          rolledOverAmount: 50, // Effective = 50
        }),
      ];

      const entries = calculateBudgetSummary(budgetPeriods);

      expect(entries[0].effectiveAmount).toBe(50);
      expect(entries[0].totalRemaining).toBe(-50);
      expect(entries[0].isOverBudget).toBe(true);
      expect(entries[0].progressPercentage).toBe(200); // 100/50 * 100
    });
  });
});
