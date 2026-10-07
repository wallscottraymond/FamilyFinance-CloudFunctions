/**
 * Manual Outflow Service
 *
 * Builds a user-created recurring bill in the same stored shape as a
 * Plaid-detected one, so derive-on-read (period page, Home, widgets) shows it
 * with no special case.
 *
 * @module domain/recurring/manual_outflow
 */
import { DomainResult } from "../../types";
import { OutflowForPersistence } from "../../integrations/plaid/plaid_recurring_transformer";
/**
 * Frequencies a user can pick when creating a bill. Stored lowercase; the
 * derive path normalizes them (`domain/recurring/frequency.ts`).
 */
export declare const MANUAL_BILL_FREQUENCIES: readonly ["weekly", "biweekly", "monthly", "quarterly", "yearly"];
export type ManualBillFrequency = (typeof MANUAL_BILL_FREQUENCIES)[number];
/**
 * Validated request to create a bill.
 */
export interface ManualOutflowRequest {
    /** New document ID (chosen by the orchestrator) */
    id: string;
    user_id: string;
    name: string;
    merchant_name: string | null;
    amount: number;
    frequency: ManualBillFrequency;
    expense_type: string;
    is_essential: boolean;
    /** Day of month the bill is due (monthly only) */
    due_day: number | null;
    /** Current time in ms (injected) */
    now_ms: number;
}
/**
 * The next due date as a UTC-midnight Date.
 *
 * - monthly with a due day: this month's due day if it hasn't passed, else next
 *   month's, clamped to the month's length (a "31st" bill is due Feb 28/29).
 * - everything else: today (the user is creating it as due now; the schedule
 *   repeats from here).
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param frequency - Bill frequency
 * @param due_day - Day of month (monthly only)
 * @param now_ms - Current time in ms
 * @returns Next due date (UTC midnight)
 */
export declare function compute_manual_next_due_date(frequency: ManualBillFrequency, due_day: number | null, now_ms: number): Date;
/**
 * Validates the request and builds the bill to persist.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param request - Validated create request
 * @returns The bill entity, or validation errors
 */
export declare function build_manual_outflow(request: ManualOutflowRequest): DomainResult<OutflowForPersistence>;
//# sourceMappingURL=manual_outflow.service.d.ts.map