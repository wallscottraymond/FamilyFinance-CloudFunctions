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

import { is_payment_suppressed } from "../../domain/recurring/recurring_suppression.service";
import { splits_as_counted } from "../../domain/budgets/budget_spend.service";
import {
  compute_countable_split_net,
  CountableSplitInput,
} from "../../domain/recurring/period_reconciliation.service";
import { Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../../types";
import { inflow_repo, outflow_repo } from "../../repositories";
import { transaction_repo } from "../../repositories/transaction.repo";
import {
  is_edge_money,
  splits_paying_recurring,
} from "../../domain/recurring/stream_membership";

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
    // A payment in a month this bill / income is removed / paused for pays nothing (X9 — as the
    // period page, the engine and reconcile).
    .filter(
      (data) =>
        !is_payment_suppressed(
          record.removal_intervals,
          ((data as unknown as Record<string, Timestamp | undefined>).transactionDate
            ?.toMillis?.() ?? 0)
        )
    )
    // Per SPLIT (the period page's rule): the splits paying this recurring — a "remove from bill"
    // or a budget pin takes only THAT split off; no paying split → not one of its payments.
    .map((data) => ({
      data,
      // Edge money (a transfer crossing the view) pays nothing — as the period page.
      splits: is_edge_money((data as { transferRole?: unknown }).transferRole)
        ? []
        : splits_paying_recurring(
          // A hidden transaction counts nowhere (its splits read as Ignored).
          splits_as_counted(data as unknown as Record<string, unknown>),
          kind,
          recurring_id,
          true
        ),
    }))
    // Its NET countable amount, as the period page and reconcile count it (Ignored adds nothing,
    // Refund subtracts); a payment that nets to nothing isn't listed.
    .map((row) => ({
      ...row,
      net: compute_countable_split_net(row.splits as CountableSplitInput[], "").amount,
    }))
    .filter(({ splits, net }) => splits.length > 0 && net > 0)
    .map(({ data, net }) => {
      const d = data as unknown as Record<string, unknown>;
      const date_ms = (d.transactionDate as Timestamp).toMillis();
      return {
        transaction_id: (d.transactionId as string) ?? (d.id as string) ?? "",
        date_ms,
        name:
          (d.merchantName as string) ||
          (d.name as string) ||
          (d.description as string) ||
          "Transaction",
        amount: net,
        is_pending: d.isPending === true,
        in_period: date_ms >= window_start_ms && date_ms <= window_end_ms,
      };
    });

  rows.sort((a, b) => b.date_ms - a.date_ms); // newest first
  return rows;
}
