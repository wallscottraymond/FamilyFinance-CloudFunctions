/**
 * Occurrence Settlement Resolver ("Mark as paid / received")
 *
 * READ-ONLY. Loads what `set_occurrence_settled` needs about a bill / income: its owner + groups
 * (auth), its existing marks, and its expected-amount inputs shaped EXACTLY as the period page
 * reads them (definition override over Plaid's average; income: per-occurrence overrides and,
 * when asked, the stream's deposit history for the per-slot estimate).
 *
 * @module resolvers/recurring/occurrence_settlement
 */

import { TraceContext } from "../../types";
import { outflow_repo } from "../../repositories/outflow.repo";
import { inflow_repo } from "../../repositories/inflow.repo";
import { transaction_repo } from "../../repositories/transaction.repo";
import { RecurringForExpected } from "../../domain/recurring/expected_occurrences.service";
import { ManualSettledOccurrences } from "../../domain/recurring/manual_settlement.service";
import {
  DepositForSlot,
  history_doc_to_deposit,
} from "../../domain/recurring/income_slot_amounts";

export type SettlementKind = "outflow" | "inflow";

export interface OccurrenceSettlementContext {
  owner_id: string;
  group_ids: string[];
  marks: ManualSettledOccurrences;
  /** The item's expected-amount inputs (the period page's shape). */
  item: RecurringForExpected;
}

/**
 * Resolve the item, or null when it doesn't exist / is inactive.
 *
 * @param with_history - INCOME: also load the stream's deposits for the per-slot estimate
 *                       (only needed to default a mark's amount to the expected one).
 */
export async function resolve_occurrence_settlement_context(
  ctx: TraceContext,
  kind: SettlementKind,
  recurring_id: string,
  with_history: boolean
): Promise<OccurrenceSettlementContext | null> {
  if (kind === "outflow") {
    const o = await outflow_repo.get_by_id(ctx, recurring_id);
    if (!o) return null;
    return {
      owner_id: o.user_id,
      group_ids: o.group_ids ?? [],
      marks: o.manual_settled_occurrences ?? {},
      item: {
        id: o.id,
        kind: "outflow",
        schedule: {
          frequency: o.frequency,
          // User override ("this + future") wins over Plaid's average — as the page reads it.
          average_amount: o.expected_amount_override ?? o.average_amount,
          first_date: o.first_date,
          last_date: o.last_date,
          predicted_next_date: o.predicted_next_date,
          source: o.source,
        },
      },
    };
  }

  const i = await inflow_repo.get_by_id(ctx, recurring_id);
  if (!i) return null;
  const has_amount_override = i.expected_amount_override != null;
  let payment_history: DepositForSlot[] | undefined;
  if (with_history && !has_amount_override && (i.transaction_ids ?? []).length > 0) {
    const docs = await transaction_repo.get_by_plaid_transaction_ids(
      ctx,
      i.user_id,
      i.transaction_ids
    );
    payment_history = docs
      .map((d) => history_doc_to_deposit(d as unknown as Record<string, unknown>))
      .filter((d): d is DepositForSlot => d !== null);
  }
  return {
    owner_id: i.user_id,
    group_ids: i.group_ids ?? [],
    marks: i.manual_settled_occurrences ?? {},
    item: {
      id: i.id,
      kind: "inflow",
      schedule: {
        frequency: i.frequency,
        average_amount: i.expected_amount_override ?? i.average_amount,
        first_date: i.first_date,
        last_date: i.last_date,
        predicted_next_date: i.predicted_next_date,
        source: i.source,
      },
      has_amount_override,
      payment_history,
      occurrence_amount_overrides: i.occurrence_amount_overrides,
    },
  };
}
