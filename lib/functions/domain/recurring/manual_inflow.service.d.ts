/**
 * Add Income on the new path (Convert-To-Recurring D43) — PURE.
 *
 * Builds a hand-added income through the same builder convert uses (v2 stamp, source manual, the
 * account + vendor key only when they come from a real transaction), and carries every setting the
 * Add Income form collects — income type, variability, hourly / commission / bonus / variable
 * config, `isUserClassified`, `isPrivate` — exactly as the legacy callable wrote them.
 *
 * @module domain/recurring/manual_inflow
 */
import type { InflowForPersistence } from "../../integrations/plaid/plaid_recurring_transformer";
import { ConvertFrequency } from "./convert_recurring.service";
/** The form's frequency spelling (Plaid-style or lowercase) → a supported schedule; null = unknown. */
export declare function to_convert_frequency(raw: string | null | undefined): ConvertFrequency | null;
export interface ManualInflowRequest {
    id: string;
    user_id: string;
    name: string;
    amount: number;
    frequency: ConvertFrequency;
    first_expected_ms: number;
    description: string | null;
    income_type: string;
    is_regular_salary: boolean;
    income_variability: string;
    hourly_config: unknown;
    commission_config: unknown;
    bonus_config: unknown;
    variable_config: unknown;
    account_id: string;
    vendor_key: string | null;
    now_ms: number;
}
export declare function build_manual_inflow(req: ManualInflowRequest): {
    errors?: string[];
    inflow?: InflowForPersistence;
};
//# sourceMappingURL=manual_inflow.service.d.ts.map