/**
 * Derive Recurring Transactions (orchestrator)
 *
 * READ-ONLY: every transaction that pays a recurring inflow/outflow, for its detail screen.
 * Candidates = the stream's own `transaction_ids` (Plaid membership, matched to our docs by the
 * `transactionId` field) UNION the transactions whose splits are linked to it
 * (`splitOutflowIds` / `splitInflowIds`: hand-assigned bill pins + engine matches — a manual bill
 * has no Plaid stream at all). Each candidate then goes through THE per-split rule the period
 * page and reconcile use (`splits_paying_recurring`), so the list and the paid status agree.
 * Each row is flagged `in_period` for the currently-viewed window so the screen
 * can render a "This Period" section and a "Historical" (all-time) section.
 *
 * Row ids are Firestore DOC ids (Transaction Detail loads `transactions/{docId}`); each row
 * carries the card payload so the app renders the real transaction row (Tappable-Transaction-Rows).
 *
 * @module orchestrators/recurring/derive_recurring_transactions
 */

import { bill_release_schedule, is_payment_released } from "../../domain/recurring/late_payment.service";
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
import {
  CardTransaction,
  to_card_transaction,
} from "../../domain/transactions/transaction_card.service";

export type RecurringKind = "outflow" | "inflow";

export interface DerivedRecurringTransaction {
  /** Firestore DOC id (what Transaction Detail loads) — not the Plaid transaction id. */
  transaction_id: string;
  /** The splits paying this recurring (`splitId ?? id`). */
  split_ids: string[];
  date_ms: number;
  name: string;
  amount: number;
  is_pending: boolean;
  in_period: boolean;
  /** The transaction, for the app's shared transaction row. */
  card: CardTransaction;
}

export async function derive_recurring_transactions_orchestrator(
  ctx: TraceContext,
  user_id: string,
  recurring_id: string,
  kind: RecurringKind,
  window_start_ms: number,
  window_end_ms: number
): Promise<DerivedRecurringTransaction[]> {
  // 1. Load the recurring record → its Plaid stream ids.
  const record =
    kind === "inflow"
      ? await inflow_repo.get_by_id(ctx, recurring_id)
      : await outflow_repo.get_by_id(ctx, recurring_id);
  if (!record || record.user_id !== user_id) return [];
  const plaid_ids = record.transaction_ids ?? [];
  const release_schedule = kind === "outflow" && record.removal_intervals?.length
    ? bill_release_schedule(record as Parameters<typeof bill_release_schedule>[0])
    : null;

  // 2. Candidates: the Plaid stream's transactions + the ones linked by split (one
  //    `array-contains` query on the durable denorm), deduped by doc id.
  const [stream_txns, linked_txns] = await Promise.all([
    transaction_repo.get_by_plaid_transaction_ids(ctx, user_id, plaid_ids),
    transaction_repo.get_by_split_recurring_link(ctx, user_id, kind, recurring_id),
  ]);
  const by_doc_id = new Map<string, (typeof stream_txns)[number]>();
  for (const t of [...stream_txns, ...linked_txns]) {
    const doc_id = (t as { id?: string }).id;
    if (doc_id && !by_doc_id.has(doc_id)) by_doc_id.set(doc_id, t);
  }
  const stream_ids = new Set(plaid_ids);
  const txns = Array.from(by_doc_id.values());

  // 3. Map + flag in-period.
  const rows: DerivedRecurringTransaction[] = txns
    .filter((data) => (data as { isActive?: boolean }).isActive !== false)
    // A payment in a month this bill / income is removed / paused for pays nothing (X9 — as the
    // period page, the engine and reconcile).
    // D31: except a bill's LATE payment of its last occurrence before the cut-off.
    .filter(
      (data) =>
        !is_payment_released(
          record.removal_intervals,
          ((data as unknown as Record<string, Timestamp | undefined>).transactionDate
            ?.toMillis?.() ?? 0),
          release_schedule
        )
    )
    // Per SPLIT (the period page's rule): the splits paying this recurring — a "remove from bill"
    // or a budget pin takes only THAT split off; no paying split → not one of its payments. A
    // transaction outside the Plaid stream pays only through splits explicitly linked to it.
    .map((data) => ({
      data,
      // Edge money (a transfer crossing the view) pays nothing — as the period page.
      splits: is_edge_money((data as { transferRole?: unknown }).transferRole)
        ? []
        : splits_paying_recurring(
          ((data as { splits?: unknown[] }).splits ?? []) as Array<Record<string, unknown>>,
          kind,
          recurring_id,
          stream_ids.has(
            ((data as unknown as Record<string, unknown>).transactionId as string) ?? ""
          )
        ),
    }))
    // Its NET countable amount, as the period page and reconcile count it (Ignored adds nothing,
    // Refund subtracts); a payment that nets to nothing isn't listed.
    .map((row) => ({
      ...row,
      net: compute_countable_split_net(row.splits as CountableSplitInput[], "").amount,
    }))
    .filter(({ splits, net }) => splits.length > 0 && net > 0)
    .map(({ data, splits, net }) => {
      const d = data as unknown as Record<string, unknown>;
      const doc_id = d.id as string;
      const date_ms = (d.transactionDate as Timestamp).toMillis();
      return {
        transaction_id: doc_id,
        split_ids: (splits as Array<Record<string, unknown>>)
          .map((s) => ((s.splitId as string) ?? (s.id as string) ?? ""))
          .filter(Boolean),
        date_ms,
        name:
          (d.merchantName as string) ||
          (d.name as string) ||
          (d.description as string) ||
          "Transaction",
        amount: net,
        is_pending: d.isPending === true,
        in_period: date_ms >= window_start_ms && date_ms <= window_end_ms,
        card: to_card_transaction(doc_id, d),
      };
    });

  rows.sort((a, b) => b.date_ms - a.date_ms); // newest first
  return rows;
}
