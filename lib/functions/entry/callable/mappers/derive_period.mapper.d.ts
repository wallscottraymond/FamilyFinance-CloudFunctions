/**
 * derive_period response mapper — the ONE mapping from a derived period result to the client
 * wire format. Shared by `derive_period` and `derive_period_range` so both return identical
 * shapes (the mobile `periodDeriveService` cache stores either interchangeably).
 *
 * @module entry/callable/mappers/derive_period.mapper
 */
import { DerivePeriodResult } from "../../../domain/periods/period_view.service";
/** Client wire format for one derived period (`derive_period`'s `data`). */
export declare function map_derive_period_result(result: DerivePeriodResult): {
    viewCadence: import("../../../domain").PeriodInstanceType;
    budgets: {
        budgetId: string;
        name: string;
        isEverythingElse: boolean;
        isFund: boolean;
        firstCategoryIds: string[];
        periods: {
            fundTotal?: number | undefined;
            fundSpentToDate?: number | undefined;
            periodId: string;
            periodType: import("../../../domain").PeriodInstanceType;
            allocatedAmount: number;
            effectiveAmount: number;
            spent: number;
            dailySpent: number[];
            dailyCount: number[];
            places: {
                key: string;
                name: string;
                count: number;
                smallCount: number;
                total: number;
                code: string;
            }[];
            fees: import("../../../domain/budgets/spend_breakdown.service").FeeSpend[];
            returnAmount: number;
            remaining: number;
            isDerived: boolean;
            noIncome: boolean;
            isPaused: boolean;
            pausedDays: number;
        }[];
    }[];
    bills: {
        partStats?: {
            partId: string;
            avg: number;
            typical: number;
            careful: number;
        }[] | undefined;
        ownerUserId?: string | undefined;
        recurringId: string;
        name: string;
        groups: {
            isFullyPaid: boolean;
            status: import("../../../domain/recurring/occurrence_placement.service").OccurrenceReconStatus;
            occurrences: {
                parts?: {
                    amount: number;
                    sure: boolean;
                    label?: string | undefined;
                    kind: string;
                    partId?: string | undefined;
                }[] | undefined;
                sureAmount?: number | undefined;
                transactionId?: string | undefined;
                manual?: boolean | undefined;
                expectedAmount?: number | undefined;
                dueMs: number;
                paid: boolean;
                amount: number;
            }[];
            firstDueMs: number | null;
            nextUnpaidDueMs: number | null;
            pausedUntilMs?: number | undefined;
            periodId: string;
            countInPeriod: number;
            countPaid: number;
            totalDue: number;
            totalPaid: number;
            totalUnpaid: number;
            isDuePeriod: boolean;
        }[];
    }[];
    income: {
        partStats?: {
            partId: string;
            avg: number;
            typical: number;
            careful: number;
        }[] | undefined;
        ownerUserId?: string | undefined;
        recurringId: string;
        name: string;
        groups: {
            isFullyPaid: boolean;
            status: import("../../../domain/recurring/occurrence_placement.service").OccurrenceReconStatus;
            occurrences: {
                parts?: {
                    amount: number;
                    sure: boolean;
                    label?: string | undefined;
                    kind: string;
                    partId?: string | undefined;
                }[] | undefined;
                sureAmount?: number | undefined;
                transactionId?: string | undefined;
                manual?: boolean | undefined;
                expectedAmount?: number | undefined;
                dueMs: number;
                paid: boolean;
                amount: number;
            }[];
            firstDueMs: number | null;
            nextUnpaidDueMs: number | null;
            pausedUntilMs?: number | undefined;
            periodId: string;
            countInPeriod: number;
            countPaid: number;
            totalDue: number;
            totalPaid: number;
            totalUnpaid: number;
            isDuePeriod: boolean;
        }[];
    }[];
};
//# sourceMappingURL=derive_period.mapper.d.ts.map