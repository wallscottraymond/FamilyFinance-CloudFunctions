/**
 * The last payment of a bill / income for a merge's end date — READ-ONLY. Plaid's `last_date` goes
 * stale for payments linked by split or pin, so the later of it and the newest linked transaction
 * is used (one `array-contains` query).
 *
 * @module resolvers/recurring/last_payment
 */

import { Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../../types";
import { transaction_repo } from "../../repositories/transaction.repo";

export async function resolve_last_payment_ms(
  ctx: TraceContext,
  user_id: string,
  kind: "outflow" | "inflow",
  id: string,
  last_date_ms: number | null
): Promise<number | null> {
  const linked = await transaction_repo.get_by_split_recurring_link(ctx, user_id, kind, id);
  const newest = linked.reduce((m, t) => Math.max(m, (t.transactionDate as Timestamp | undefined)?.toMillis?.() ?? 0), 0);
  const best = Math.max(last_date_ms ?? 0, newest);
  return best > 0 ? best : null;
}
