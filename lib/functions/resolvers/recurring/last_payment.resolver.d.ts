/**
 * The last payment of a bill / income for a merge's end date — READ-ONLY. Plaid's `last_date` goes
 * stale for payments linked by split or pin, so the later of it and the newest linked transaction
 * is used (one `array-contains` query).
 *
 * @module resolvers/recurring/last_payment
 */
import { TraceContext } from "../../types";
export declare function resolve_last_payment_ms(ctx: TraceContext, user_id: string, kind: "outflow" | "inflow", id: string, last_date_ms: number | null): Promise<number | null>;
//# sourceMappingURL=last_payment.resolver.d.ts.map