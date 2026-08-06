/**
 * Derive Recurring Transactions (orchestrator)
 *
 * READ-ONLY: every transaction that belongs to a recurring inflow/outflow stream,
 * for its detail screen. Source of truth is the stream's own `transaction_ids`
 * (Plaid links them; matched to our transactions by the `transactionId` field).
 * Each row is flagged `in_period` for the currently-viewed window so the screen
 * can render a "This Period" section and a "Historical" (all-time) section.
 *
 * @module orchestrators/recurring/derive_recurring_transactions
 */

import { Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../../types";
import { inflow_repo, outflow_repo } from "../../repositories";
import { transaction_repo } from "../../repositories/transaction.repo";

export type RecurringKind = "outflow" | "inflow";

export interface DerivedRecurringTransaction {
  transaction_id: string;
  date_ms: number;
  name: string;
  amount: number;
  is_pending: boolean;
  in_period: boolean;
}

export async function derive_recurring_transactions_orchestrator(
  ctx: TraceContext,
  user_id: string,
  recurring_id: string,
  kind: RecurringKind,
  window_start_ms: number,
  window_end_ms: number
): Promise<DerivedRecurringTransaction[]> {
  // 1. Load the recurring record → its Plaid transaction ids.
  const record =
    kind === "inflow"
      ? await inflow_repo.get_by_id(ctx, recurring_id)
      : await outflow_repo.get_by_id(ctx, recurring_id);
  if (!record || record.user_id !== user_id) return [];
  const plaid_ids = record.transaction_ids ?? [];

  // 2. Fetch those transactions (by the `transactionId` field).
  const txns = await transaction_repo.get_by_plaid_transaction_ids(ctx, user_id, plaid_ids);

  // 3. Map + flag in-period.
  const rows: DerivedRecurringTransaction[] = txns
    .filter((data) => (data as { isActive?: boolean }).isActive !== false)
    .map((data) => {
      const d = data as unknown as Record<string, unknown>;
      const date_ms = (d.transactionDate as Timestamp).toMillis();
      const splits = (d.splits as Array<Record<string, unknown>>) ?? [];
      return {
        transaction_id: (d.transactionId as string) ?? (d.id as string) ?? "",
        date_ms,
        name:
          (d.merchantName as string) ||
          (d.name as string) ||
          (d.description as string) ||
          "Transaction",
        amount: splits.reduce((s, sp) => s + Math.abs((sp.amount as number) ?? 0), 0),
        is_pending: d.isPending === true,
        in_period: date_ms >= window_start_ms && date_ms <= window_end_ms,
      };
    });

  rows.sort((a, b) => b.date_ms - a.date_ms); // newest first
  return rows;
}
