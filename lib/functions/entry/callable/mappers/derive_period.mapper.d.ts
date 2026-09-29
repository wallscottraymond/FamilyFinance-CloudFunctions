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
        periods: {
            periodId: string;
            periodType: import("../../../domain").PeriodInstanceType;
            allocatedAmount: number;
            effectiveAmount: number;
            spent: number;
            returnAmount: number;
            remaining: number;
            isDerived: boolean;
            noIncome: boolean;
        }[];
    }[];
    bills: {
        recurringId: string;
        name: string;
        groups: {
            periodId: string;
            countInPeriod: number;
            countPaid: number;
            totalDue: number;
            totalPaid: number;
            totalUnpaid: number;
            isDuePeriod: boolean;
            isFullyPaid: boolean;
            status: import("../../../domain/recurring/occurrence_placement.service").OccurrenceReconStatus;
            occurrences: {
                dueMs: number;
                paid: boolean;
                amount: number;
            }[];
            firstDueMs: number | null;
            nextUnpaidDueMs: number | null;
        }[];
    }[];
    income: {
        recurringId: string;
        name: string;
        groups: {
            periodId: string;
            countInPeriod: number;
            countPaid: number;
            totalDue: number;
            totalPaid: number;
            totalUnpaid: number;
            isDuePeriod: boolean;
            isFullyPaid: boolean;
            status: import("../../../domain/recurring/occurrence_placement.service").OccurrenceReconStatus;
            occurrences: {
                dueMs: number;
                paid: boolean;
                amount: number;
            }[];
            firstDueMs: number | null;
            nextUnpaidDueMs: number | null;
        }[];
    }[];
};
//# sourceMappingURL=derive_period.mapper.d.ts.map