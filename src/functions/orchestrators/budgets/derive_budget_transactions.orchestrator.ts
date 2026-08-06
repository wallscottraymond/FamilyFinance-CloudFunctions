/**
 * Derive Budget Transactions (orchestrator)
 *
 * READ-ONLY (Derive-On-Read): the transactions a budget owns FOR A PERIOD,
 * resolved ON READ (category + manual pin + Everything-Else fallback) — not from a
 * stored `budgetId`. Each owned split is tagged with a DERIVED display status:
 *   - counted  → contributes to Spent
 *   - ignored  → excluded from Spent but VISIBLE + user-manageable. Reasons:
 *       transfer (internal account transfer, matched-pair), income (real INCOME_*),
 *       manual (user set spendStatus='ignored')
 *   - refund   → money back (spendStatus='refund')
 * Recurring-linked splits (outflow/inflow) are omitted — they're tracked as bills/income.
 *
 * This lets the budget-detail screen show ignored items (incl. auto-ignored
 * transfers) in a dedicated section, with the pill to include them if desired.
 *
 * @module orchestrators/budgets/derive_budget_transactions
 */

import { Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../../types";
import { budget_repo } from "../../repositories/budget.repo";
import { transaction_repo } from "../../repositories/transaction.repo";
import {
  is_transfer_category,
  is_income_category,
} from "../../domain/budgets/budget_spend.service";
import {
  resolve_split_owner,
  SplitForOnReadMatch,
} from "../../domain/budgets/budget_spend_match.service";
import { BudgetForMatch, PeriodLens } from "../../domain/transactions/match_budget.service";
import {
  detect_internal_transfers,
  TransferForPairing,
} from "../../domain/transactions/internal_transfer.service";

const PAIRING_BUFFER_MS = 7 * 24 * 60 * 60 * 1000; // widen the window so cross-day transfer pairs match

export type DerivedSpendStatus = "counted" | "ignored" | "refund";
export type IgnoredReason = "transfer" | "income" | "manual" | null;

export interface DerivedBudgetTransaction {
  transaction_id: string;
  split_id: string | null;
  date_ms: number;
  name: string;
  amount: number; // the owned split's amount (absolute)
  is_pending: boolean;
  spend_status: DerivedSpendStatus;
  ignored_reason: IgnoredReason;
}

function to_cadence(period: string): PeriodLens {
  return period === "weekly" ? "weekly" : period === "bi_monthly" ? "bi_monthly" : "monthly";
}

export async function derive_budget_transactions_orchestrator(
  ctx: TraceContext,
  user_id: string,
  budget_id: string,
  start_ms: number,
  end_ms: number
): Promise<DerivedBudgetTransaction[]> {
  // 1. Budgets → real budgets (category ownership) + the EE id + is-target-EE.
  const budgets = await budget_repo.get_by_user_id(ctx, user_id);
  const real_budgets: BudgetForMatch[] = [];
  let monthly_ee_id: string | null = null;
  let any_ee_id: string | null = null;
  let target_is_ee = false;
  for (const b of budgets) {
    if (b.is_system_everything_else) {
      any_ee_id = any_ee_id ?? b.id;
      if (b.period === "monthly") monthly_ee_id = b.id;
      if (b.id === budget_id) target_is_ee = true;
    } else {
      real_budgets.push({
        id: b.id,
        category_ids: b.category_ids,
        start_ms: b.start_date.toMillis(),
        end_ms: b.is_ongoing ? null : b.end_date.toMillis(),
        is_ongoing: b.is_ongoing,
        cadence: to_cadence(b.period),
      });
    }
  }
  const ee_id = target_is_ee ? budget_id : monthly_ee_id ?? any_ee_id;

  // 2. Load the window's transactions (+ a small buffer for transfer pairing).
  const txns = await transaction_repo.get_active_in_date_range(
    ctx,
    user_id,
    start_ms - PAIRING_BUFFER_MS,
    end_ms + PAIRING_BUFFER_MS
  );

  // 3. Matched-pair internal-transfer detection over the buffered window.
  const transfers: TransferForPairing[] = [];
  for (const { id, data } of txns) {
    const raw = (data.splits as Array<Record<string, unknown>>) ?? [];
    const first = raw[0] ?? {};
    const eff =
      (first.internalDetailedCategory as string | null) ??
      (first.plaidDetailedCategory as string | null) ??
      "";
    if (!is_transfer_category(eff)) continue;
    transfers.push({
      id,
      plaid_id: (data.transactionId as string | null) ?? null,
      account_id: (data.accountId as string) ?? "",
      amount: raw.reduce((s, sp) => s + Math.abs((sp.amount as number) ?? 0), 0),
      date_ms: (data.transactionDate as Timestamp).toMillis(),
      direction: eff.startsWith("TRANSFER_IN") ? "in" : "out",
    });
  }
  const { internal_ids } = detect_internal_transfers(transfers);

  // 4. Resolve ownership on read; keep only splits owned by the target budget, in-window.
  const out: DerivedBudgetTransaction[] = [];
  for (const { id, data } of txns) {
    const date_ms = (data.transactionDate as Timestamp).toMillis();
    if (date_ms < start_ms || date_ms > end_ms) continue;
    const is_pending = data.isPending === true;
    const txn_is_internal_transfer = internal_ids.has(id);
    const raw = (data.splits as Array<Record<string, unknown>>) ?? [];
    const name =
      (data.merchantName as string) ||
      (data.name as string) ||
      (data.description as string) ||
      "Transaction";

    for (const s of raw) {
      const outflow_id = (s.outflowId as string | null) ?? null;
      const inflow_id = (s.inflowId as string | null) ?? null;
      // Recurring-linked splits are tracked as bills/income, not budget lines.
      if (outflow_id || inflow_id) continue;

      const internal_category = (s.internalDetailedCategory as string | null) ?? null;
      const plaid_category = (s.plaidDetailedCategory as string) ?? "OTHER_EXPENSE";
      const match: SplitForOnReadMatch = {
        amount: (s.amount as number) ?? 0,
        txn_date_ms: date_ms,
        is_pending,
        is_transfer: txn_is_internal_transfer,
        is_income: data.type === "income",
        spend_status:
          (s.spendStatus as "counted" | "ignored" | "refund" | undefined) ??
          (s.isIgnored === true ? "ignored" : s.isRefund === true ? "refund" : "counted"),
        outflow_id,
        inflow_id,
        internal_match_category: internal_category,
        plaid_match_category: plaid_category,
        overall_category_id: (s.overallCategoryId as string | null) ?? null,
        first_category_id: (s.firstCategoryId as string | null) ?? null,
        manual_pin_budget_id:
          (s.budgetAssignmentSource as string) === "manual" ? (s.budgetId as string) ?? null : null,
      };

      if (resolve_split_owner(match, real_budgets, ee_id) !== budget_id) continue;

      // Derive the display status (transfers/income → ignored; else the stored status).
      let spend_status: DerivedSpendStatus = match.spend_status;
      let ignored_reason: IgnoredReason = null;
      if (txn_is_internal_transfer) {
        spend_status = "ignored";
        ignored_reason = "transfer";
      } else if (is_income_category(internal_category ?? plaid_category)) {
        spend_status = "ignored";
        ignored_reason = "income";
      } else if (match.spend_status === "ignored") {
        ignored_reason = "manual";
      }

      out.push({
        transaction_id: id,
        split_id: (s.splitId as string) ?? (s.id as string) ?? null,
        date_ms,
        name,
        amount: Math.abs((s.amount as number) ?? 0),
        is_pending,
        spend_status,
        ignored_reason,
      });
    }
  }

  // Newest first.
  out.sort((a, b) => b.date_ms - a.date_ms);
  return out;
}
