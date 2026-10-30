/**
 * Manual income pin (Convert-To-Recurring Phase 2) — PURE.
 *
 * "This deposit is a payment of THAT income": the income twin of the manual bill pin. The split
 * records `inflowAssignmentSource: "manual"` + the income, which the assignment engine preserves
 * across re-syncs and beats Plaid stream membership (a pin to an income other than the stream's
 * takes the split off the stream). Rules (review items 11 / P9):
 *   - only the transaction's OWNER, and only an income of the same owner;
 *   - only money coming in (`type: "income"`), and never a transfer crossing the view (edge money);
 *   - only an income in the transaction's own view (Me / the group the account is shared with);
 *   - a pin replaces a budget pin and a bill pin on the split (an income payment is neither).
 *
 * @module domain/recurring/inflow_pin
 */
type Raw = Record<string, unknown>;
export interface InflowPinFacts {
    txn: {
        owner_id: string | null;
        type: string | null;
        transfer_role: string | null;
        split_ids: string[];
    };
    /** The income, or null when it doesn't exist. */
    inflow: {
        owner_id: string | null;
        is_active: boolean;
        is_hidden: boolean;
    } | null;
    /** The view the transaction counts in (group id, or null = Me) and the income's view. */
    txn_view: string | null;
    inflow_view: string | null;
}
export type InflowPinPlan = {
    ok: true;
    clear: boolean;
} | {
    ok: false;
    code: "PERMISSION_DENIED" | "NOT_FOUND" | "NOT_AN_INCOME_PAYMENT" | "OUT_OF_VIEW";
    message: string;
};
/** May `user_id` pin this split to this income (or clear the pin)? PURE. */
export declare function plan_inflow_pin(user_id: string, facts: InflowPinFacts, split_id: string, inflow_id: string | null): InflowPinPlan;
/**
 * The split after the pin (or after clearing it). A pin replaces a budget pin and a bill pin (a
 * "remove from bill" detach stays); clearing it removes the marker so the engine re-derives. Keys
 * are added only when set (a split that never had a pin stays byte-identical). PURE.
 */
export declare function apply_inflow_pin_to_split(split: Raw, inflow_id: string | null): Raw;
export {};
//# sourceMappingURL=inflow_pin.service.d.ts.map