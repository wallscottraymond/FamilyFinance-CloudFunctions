/**
 * On-Read Spend Resolver
 *
 * READ-ONLY gathering for the "instant budgets" path (Derive-On-Read): produce
 * the splits a budget owns by matching them ON READ (category + manual pin),
 * NOT by reading a pre-computed stored `budgetId`. This is what lets a brand-new
 * budget show its transactions immediately — no write-time assignment cascade.
 *
 * Loads the user's budgets (to know category ownership + the Everything-Else
 * fallback) + the splits in the window, maps them to the matcher's shape, and
 * returns the target budget's owned splits as `SplitForSpend[]` — which flow
 * straight into the existing `budget_view` derivation (bucketing + pro-ration).
 *
 * Reuses the pure `owned_splits_for_budget` (which reuses `match_budget`), so it
 * makes the identical decisions the write-time engine would. No writes.
 *
 * @module resolvers/budgets/on_read_spend
 */
import { TraceContext } from "../../types";
import { SplitForSpend } from "../../domain/budgets/budget_spend.service";
/**
 * The splits owned by `target_budget_id` over the window, resolved on read.
 *
 * @param target_is_ee - Whether the target budget is the Everything-Else budget.
 *                       When true, the matcher's EE fallback id is the target
 *                       itself (so unmatched splits land here); otherwise a real
 *                       budget only receives its category matches.
 */
export declare function resolve_on_read_spend_splits(ctx: TraceContext, user_id: string, target_budget_id: string, target_is_ee: boolean, start_ms: number, end_ms: number): Promise<SplitForSpend[]>;
//# sourceMappingURL=on_read_spend.resolver.d.ts.map