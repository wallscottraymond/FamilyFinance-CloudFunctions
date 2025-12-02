/**
 * Outflow Periods Types
 *
 * Types related to outflow periods (bill occurrences in specific time periods).
 */
import { Timestamp } from "firebase-admin/firestore";
import { BaseDocument } from "../../../../types/base";
import { PeriodType } from "../../../budgets/types";
/**
 * Payment Type Classification
 */
export declare enum PaymentType {
    REGULAR = "regular",
    CATCH_UP = "catch_up",
    ADVANCE = "advance",
    EXTRA_PRINCIPAL = "extra_principal"
}
/**
 * Outflow Period Status
 */
export declare enum OutflowPeriodStatus {
    PENDING = "pending",
    DUE_SOON = "due_soon",
    PARTIAL = "partial",
    PAID = "paid",
    PAID_EARLY = "paid_early",
    OVERDUE = "overdue"
}
/**
 * Outflow Period - FLAT STRUCTURE
 *
 * Represents a bill occurrence in a specific period.
 */
export interface OutflowPeriod extends BaseDocument {
    id: string;
    outflowId: string;
    sourcePeriodId: string;
    userId: string;
    groupId: string;
    isActive: boolean;
    accountId: string;
    itemId: string;
    actualAmount: number | null;
    amountWithheld: number;
    averageAmount: number;
    expectedAmount: number;
    amountPerOccurrence: number;
    totalAmountDue: number;
    totalAmountPaid: number;
    totalAmountUnpaid: number;
    currency: string;
    createdAt: Timestamp;
    updatedAt: Timestamp;
    lastCalculated: Timestamp;
    cycleDays: number;
    cycleStartDate: Timestamp;
    cycleEndDate: Timestamp;
    dailyWithholdingRate: number;
    description: string;
    frequency: string;
    isPaid: boolean;
    isFullyPaid: boolean;
    isPartiallyPaid: boolean;
    isDuePeriod: boolean;
    isHidden: boolean;
    plaidPrimaryCategory: string;
    plaidDetailedCategory: string;
    merchantName: string | null;
    periodStartDate: Timestamp;
    periodEndDate: Timestamp;
    periodType: PeriodType;
    predictedNextDate: Timestamp | null;
    tags: string[];
    note: string | null;
    transactionIds: string[];
    numberOfOccurrencesInPeriod: number;
    numberOfOccurrencesPaid: number;
    numberOfOccurrencesUnpaid: number;
    occurrenceDueDates: Timestamp[];
    occurrencePaidFlags: boolean[];
    occurrenceTransactionIds: (string | null)[];
    paymentProgressPercentage: number;
    dollarProgressPercentage: number;
    firstDueDateInPeriod: Timestamp | null;
    lastDueDateInPeriod: Timestamp | null;
    nextUnpaidDueDate: Timestamp | null;
}
//# sourceMappingURL=index.d.ts.map