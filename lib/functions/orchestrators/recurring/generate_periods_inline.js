"use strict";
/**
 * Generate the stored periods of bills / income that were just created, inline.
 *
 * Shared by the item sync (a stream it created is stamped `syncRunId`, so the create trigger skips
 * it) and by convert / Add Bill / Add Income (a stamped create, same reason): the creator generates
 * the periods once, then runs ONE follow-up pass. Extracted from `sync_item` unchanged.
 *
 * @module orchestrators/recurring/generate_periods_inline
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.generate_periods_inline = generate_periods_inline;
const observability_1 = require("../../observability");
const generate_outflow_periods_orchestrator_1 = require("../outflows/generate_outflow_periods.orchestrator");
const generate_inflow_periods_orchestrator_1 = require("../inflows/generate_inflow_periods.orchestrator");
const PERIOD_CONCURRENCY = 4;
const is_outflow = (s) => s.kind === "outflow";
async function generate_periods_inline(ctx, user_id, created, 
/** Create only the periods that are missing (convert): stored ones keep their state. */
only_missing = false) {
    const failed = [];
    for (let i = 0; i < created.length; i += PERIOD_CONCURRENCY) {
        await Promise.all(created.slice(i, i + PERIOD_CONCURRENCY).map(async (s) => {
            const trace = (0, observability_1.create_child_span)(ctx);
            try {
                if (is_outflow(s)) {
                    const r = await (0, generate_outflow_periods_orchestrator_1.generate_outflow_periods_orchestrator)(Object.assign(Object.assign({}, trace), { input: Object.assign({ outflow_id: s.id, outflow_data: s.after, user_id }, (only_missing ? { only_missing } : {})), idempotency_key: `sync_periods:${s.id}` }));
                    if (!r.success)
                        failed.push(s.id);
                }
                else {
                    const r = await (0, generate_inflow_periods_orchestrator_1.generate_inflow_periods_orchestrator)(Object.assign(Object.assign({}, trace), { input: Object.assign({ inflow_id: s.id, inflow_data: s.after, user_id }, (only_missing ? { only_missing } : {})), idempotency_key: `sync_periods:${s.id}` }));
                    if (!r.success)
                        failed.push(s.id);
                }
            }
            catch (error) {
                failed.push(s.id);
                console.error(`[${ctx.trace_id}] period generation failed for ${s.id}:`, error);
            }
        }));
    }
    return failed;
}
//# sourceMappingURL=generate_periods_inline.js.map