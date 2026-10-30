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
import type { RecurringWrittenDoc } from "../../repositories/recurring_doc_equality";
export declare function generate_periods_inline(ctx: TraceContext, user_id: string, created: RecurringWrittenDoc[], 
/** Create only the periods that are missing (convert): stored ones keep their state. */
only_missing?: boolean): Promise<string[]>;
//# sourceMappingURL=generate_periods_inline.d.ts.map