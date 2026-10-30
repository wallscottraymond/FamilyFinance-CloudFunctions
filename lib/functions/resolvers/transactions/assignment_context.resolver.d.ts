/**
 * Assignment Context Resolver
 *
 * READ-ONLY: loads everything the Transaction Assignment Engine needs to assign
 * one transaction's splits — the transaction, the user's real budgets (+ the
 * Everything Else id), the source periods overlapping the date, and the category
 * rules — and maps them to the pure core's input types.
 *
 * Recurring matches are NOT resolved here yet (owned by Recurring-Period-
 * Reconciliation); `recurring_by_split` is left empty until that ships.
 *
 * @module resolvers/transactions/assignment_context
 */
import { ConvertedIndex } from "../../domain/recurring/converted_match.service";
import { TraceContext } from "../../types";
import { RemovalInterval } from "../../domain/recurring/recurring_suppression.service";
import { BillPaymentForRelease } from "../../domain/recurring/late_payment.service";
import type { RecurringScheduleForGeneration } from "../../domain/outflows/outflow_period.service";
import { BudgetForMatch, PeriodLens } from "../../domain/transactions/match_budget.service";
import { CategoryCatalog } from "../../domain/transactions/split_category.service";
import { SourcePeriodForMatch } from "../../domain/transactions/match_source_periods.service";
import { SplitForAssignment, AssignmentContext } from "../../domain/transactions/compute_transaction_assignment.service";
import { PreloadedRecurringCandidates } from "./recurring_matches.resolver";
/** What the orchestrator needs back: the raw splits (for read-modify-write) + the pure input. */
export interface ResolvedAssignment {
    transaction_doc_id: string;
    /** Raw camelCase split maps, preserved so the write merges onto them. */
    raw_splits: Array<Record<string, unknown>>;
    splits_input: SplitForAssignment[];
    context: AssignmentContext;
    /** budget_id → name, so the engine can denormalize `budgetName` onto splits. */
    budget_names: Record<string, string>;
}
/**
 * The transaction-INDEPENDENT slice of the assignment context: a user's real
 * budgets, the Everything Else fallback id, budget id→name, and the category
 * rules. These depend only on `user_id`, so when assigning many of a user's
 * transactions they can be resolved ONCE and reused — avoiding the per-transaction
 * re-read of budgets and the categories collection (the main read amplification).
 */
export interface SharedAssignmentContext {
    real_budgets: BudgetForMatch[];
    budget_names: Record<string, string>;
    /** Everything Else budget id PER LENS (each period cadence has its own EE). */
    everything_else_budget_ids: Record<PeriodLens, string | null>;
    /** The ONE category function's catalog (canon M7). */
    category_catalog: CategoryCatalog;
    /** Plaid stream transaction id → recurring id, from active defs' `transactionIds`.
     *  The AUTHORITATIVE bill/income link (Plaid's own recurring stream), used to
     *  deterministically set a split's `outflow_id`/`inflow_id` — the fuzzy period
     *  matcher (empty-merchant bills, missing periods) misses these (S1 root cause). */
    outflow_tx_to_id: Map<string, string>;
    inflow_tx_to_id: Map<string, string>;
    /**
     * Account-Rooted-Sharing: an account the user shared with a group counts in THAT group's view
     * (from its share-from date), so its transactions are assigned against the GROUP's budgets —
     * the same rule `derive_period` uses on read. Without it, a shared account's transaction was
     * stored as the user's personal Everything Else while the group view counted it in the group's
     * budget (e.g. "Santo Taco" → Everything Else vs "Eating Out and Snacks"). Keyed by the
     * account's doc id AND Plaid id.
     */
    group_views_by_account: Map<string, {
        from_ms: number | null;
        group_id: string;
        view: ViewBudgets;
    }>;
    /** Bill / income id → the view it belongs to (group id, or null = Me). */
    recurring_view_by_id: Map<string, string | null>;
    /** Active, non-hidden bills — a manual pin to anything else (deleted / hidden) is stale. */
    active_outflow_ids: Set<string>;
    /** The caller's OWN active, non-hidden incomes — a manual income pin to anything else is stale
     *  (never another user's income, whatever a client wrote). */
    active_inflow_ids?: Set<string>;
    /** Bill / income id → its remove / pause spans (only items that have any). A payment in a
     *  removed / paused month is released to budgets (`is_payment_released`). */
    removal_intervals_by_id: Map<string, RemovalInterval[]>;
    /** D31: a removed BILL's schedule — its late payment of the last occurrence before the cut-off
     *  is not released (`is_payment_released`). Only bills that have removal intervals. */
    release_schedule_by_id?: Map<string, RecurringScheduleForGeneration>;
    /** D37: a removed BILL's stored payments (its split-linked + Plaid-stream transactions, as
     *  stored reconcile reads them), loaded at most once per batch and only for a transaction that
     *  may be its late payment — the release rule keeps a late payment only while the occurrence it
     *  pays is still unpaid. */
    load_bill_payments_for_release?: (recurring_id: string) => Promise<BillPaymentForRelease[]>;
    /**
     * Plaid transaction ids held out of FUZZY bill / income matching (Convert-To-Recurring X3): the
     * payments of streams Plaid is unsure of (suggested, not saved) or the user said aren't a bill.
     * They stay normal transactions — never linked to an old bill by a merchant guess. Stream
     * membership and manual pins / detaches are unaffected. One read (the review state doc).
     */
    fuzzy_excluded_plaid_ids?: Set<string>;
    /**
     * v2 bills / income (captured under the new rules) → the account their payments come from.
     * The FUZZY scorer links a payment to one of these only from that same account (F13: a payment
     * from another account — the bill moved — is not auto-linked; stream membership, D1 and manual
     * pins are unaffected). Old records keep today's fuzzy matching (D13). No extra reads.
     */
    v2_account_by_recurring_id?: Map<string, string>;
    /**
     * Converted bills / income (v2 + manual + a vendor key on a Plaid account), keyed by direction |
     * account | vendor (Convert-To-Recurring Phase 2, D1): a payment of that vendor on that account
     * links to them by KEY, any amount; fuzzy matching excludes exactly these ids. No extra reads —
     * built from the bills / income this context already loads. Empty for anyone without such records.
     */
    converted_index?: ConvertedIndex;
    /** Plaid payment id → the converted bill / income that absorbed it. */
    outflow_absorbed_tx_to_id?: Map<string, string>;
    inflow_absorbed_tx_to_id?: Map<string, string>;
}
/** One view's budgets, as the engine matches against them. */
export interface ViewBudgets {
    real_budgets: BudgetForMatch[];
    budget_names: Record<string, string>;
    everything_else_budget_ids: Record<PeriodLens, string | null>;
}
/**
 * Resolve the transaction-independent shared context for a user (budgets +
 * categories). Loaded once per batch; pass into `resolve_assignment_context` to
 * skip the per-transaction re-reads.
 */
export declare function resolve_shared_assignment_context(ctx: TraceContext, user_id: string): Promise<SharedAssignmentContext>;
/**
 * Resolve the assignment context for a transaction.
 *
 * @param shared - Optional pre-resolved shared context (budgets + categories).
 *   When provided (batch path), the per-transaction budget/category reads are
 *   skipped; only the transaction doc, its overlapping source periods, and its
 *   recurring matches are read.
 * @returns The resolved context, or null if the transaction is missing/inactive.
 */
export declare function resolve_assignment_context(ctx: TraceContext, user_id: string, transaction_id: string, shared?: SharedAssignmentContext, preloaded_candidates?: PreloadedRecurringCandidates, preloaded_txn?: {
    id: string;
    data: Record<string, unknown>;
}, preloaded_source_periods?: SourcePeriodForMatch[]): Promise<ResolvedAssignment | null>;
//# sourceMappingURL=assignment_context.resolver.d.ts.map