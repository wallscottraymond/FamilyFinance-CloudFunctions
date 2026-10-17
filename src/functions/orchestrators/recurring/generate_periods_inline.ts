/**
 * Generate the stored periods of bills / income that were just created, inline.
 *
 * Shared by the item sync (a stream it created is stamped `syncRunId`, so the create trigger skips
 * it) and by convert / Add Bill / Add Income (a stamped create, same reason): the creator generates
 * the periods once, then runs ONE follow-up pass. Extracted from `sync_item` unchanged.
 *
 * @module orchestrators/recurring/generate_periods_inline
 */

import { TraceContext } from "../../types";
import { create_child_span } from "../../observability";
import type { RecurringWrittenDoc } from "../../repositories/recurring_doc_equality";
import { generate_outflow_periods_orchestrator } from "../outflows/generate_outflow_periods.orchestrator";
import { generate_inflow_periods_orchestrator } from "../inflows/generate_inflow_periods.orchestrator";

const PERIOD_CONCURRENCY = 4;
const is_outflow = (s: RecurringWrittenDoc): boolean => s.kind === "outflow";

export async function generate_periods_inline(
  ctx: TraceContext,
  user_id: string,
  created: RecurringWrittenDoc[]
): Promise<string[]> {
  const failed: string[] = [];
  for (let i = 0; i < created.length; i += PERIOD_CONCURRENCY) {
    await Promise.all(
      created.slice(i, i + PERIOD_CONCURRENCY).map(async (s) => {
        const trace = create_child_span(ctx);
        try {
          if (is_outflow(s)) {
            const r = await generate_outflow_periods_orchestrator({
              ...trace,
              input: { outflow_id: s.id, outflow_data: s.after, user_id },
              idempotency_key: `sync_periods:${s.id}`,
            });
            if (!r.success) failed.push(s.id);
          } else {
            const r = await generate_inflow_periods_orchestrator({
              ...trace,
              input: { inflow_id: s.id, inflow_data: s.after, user_id },
              idempotency_key: `sync_periods:${s.id}`,
            });
            if (!r.success) failed.push(s.id);
          }
        } catch (error) {
          failed.push(s.id);
          console.error(`[${ctx.trace_id}] period generation failed for ${s.id}:`, error);
        }
      })
    );
  }
  return failed;
}
