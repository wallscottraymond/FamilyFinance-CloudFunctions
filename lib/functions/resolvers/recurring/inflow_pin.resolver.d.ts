/**
 * Inflow Pin Resolver — READ-ONLY facts for pinning a split to an income (Convert-To-Recurring
 * Phase 2). Loads the transaction, the income and the caller's account placements; decides nothing
 * (the domain `plan_inflow_pin` does). Authorization is by OWNER, never by group: a member probing
 * the owner's ids learns nothing (the domain answers a missing and a foreign income the same way).
 *
 * @module resolvers/recurring/inflow_pin
 */
import { TraceContext } from "../../types";
import { InflowPinFacts } from "../../domain/recurring/inflow_pin.service";
export declare function resolve_inflow_pin_facts(ctx: TraceContext, user_id: string, transaction_id: string, inflow_id: string | null): Promise<InflowPinFacts | null>;
//# sourceMappingURL=inflow_pin.resolver.d.ts.map