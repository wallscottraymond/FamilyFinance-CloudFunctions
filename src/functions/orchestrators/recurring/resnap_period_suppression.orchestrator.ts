/**
 * Re-snap stored periods to the month rule (Convert-To-Recurring D27) — the ONE-OFF that brings
 * existing materialized periods in line with the rule `apply_period_suppression` and the period
 * creators now apply: a sub-month period of a removed / paused / ended bill or income is active
 * when any of its occurrences is in a month that isn't suppressed (the derive's rule, b6a8281).
 *
 * Input: every ACTIVE bill / income that carries removal intervals (all users, or one). For each,
 * its periods are compared with the rule; only periods whose `isActive` is wrong are counted and —
 * with `write` — flipped, writing ONLY `isActive` (no `updatedAt`, nothing else). Inactive records
 * (account removed / stale) are never touched: their periods are inactive for another reason.
 * Dry run by default. Idempotent: a second run finds nothing.
 *
 * CLI: `scripts/resnap-period-suppression.js` (dry run; `--write`; `--user <uid>`). NOT run against
 * prod without the user's approval (dev == prod).
 *
 * @module orchestrators/recurring/resnap_period_suppression
 */

import { TraceContext } from "../../types";
import { inflow_repo, outflow_repo } from "../../repositories";

export interface ResnapUserCounts {
  outflows: number;
  outflow_periods_to_flip: number;
  inflows: number;
  inflow_periods_to_flip: number;
}

export interface ResnapResult {
  write: boolean;
  records_checked: number;
  periods_flipped: number;
  by_user: Record<string, ResnapUserCounts>;
}

export async function resnap_period_suppression_orchestrator(
  ctx: TraceContext,
  opts: { write?: boolean; user_id?: string } = {}
): Promise<ResnapResult> {
  const write = opts.write === true;
  const result: ResnapResult = { write, records_checked: 0, periods_flipped: 0, by_user: {} };
  const counts = (uid: string): ResnapUserCounts =>
    (result.by_user[uid] ??= { outflows: 0, outflow_periods_to_flip: 0, inflows: 0, inflow_periods_to_flip: 0 });

  for (const [kind, repo] of [["outflow", outflow_repo], ["inflow", inflow_repo]] as const) {
    const records = await repo.list_active_with_removal_intervals(ctx, opts.user_id);
    for (const r of records) {
      result.records_checked++;
      const n = await repo.apply_period_suppression(ctx, r.id, r.removal_intervals, r.owner_id, {
        dry_run: !write,
        touch_updated_at: false,
      });
      const c = counts(r.owner_id);
      if (kind === "outflow") {
        c.outflows++;
        c.outflow_periods_to_flip += n;
      } else {
        c.inflows++;
        c.inflow_periods_to_flip += n;
      }
      result.periods_flipped += n;
    }
  }
  console.log(
    `[${ctx.trace_id}] resnap_period_suppression ${write ? "WRITE" : "DRY RUN"}: ` +
      `${result.records_checked} record(s), ${result.periods_flipped} period(s) ${write ? "flipped" : "to flip"}`
  );
  return result;
}
