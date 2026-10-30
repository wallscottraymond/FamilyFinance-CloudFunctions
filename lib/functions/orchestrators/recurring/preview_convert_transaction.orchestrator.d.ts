/**
 * Preview Convert Orchestrator (Convert-To-Recurring Phase 2): what the "Make this a bill" sheet
 * should show for a transaction — READ-ONLY. Reads: the transaction, the user's bills / income, the
 * accounts, the inactive records of the vendor, and the vendor's payments (one doc per payment
 * returned, paged at 600 rows up to 3000; a source without a stored vendorKey adds up to 1500 for
 * the account-window fallback). Typically ~100–200, bounded by the vendor's payment count. A refusal is DATA here (`refusal`), not an error:
 * the sheet explains it. The owner is checked first; flag off → `{enabled: false}` and nothing is
 * read.
 *
 * @module orchestrators/recurring/preview_convert_transaction
 */
import { TraceContext } from "../../types";
import { ConvertPreview } from "../../domain/recurring/convert_plan.service";
export type PreviewResult = {
    enabled: false;
} | {
    enabled: true;
    refusal: {
        code: string;
        message: string;
        details?: Record<string, unknown>;
    };
}
/** `unfinished`: made but never finished (a convert that timed out) — the app taps convert again
 *  to resume it, since only convert finishes it. */
 | {
    enabled: true;
    already_converted: {
        id: string;
        name: string;
        unfinished: boolean;
    };
} | ({
    enabled: true;
} & Omit<ConvertPreview, "ok">);
export declare function preview_convert_transaction_orchestrator(ctx: TraceContext, user_id: string, input: {
    transaction_id: string;
    split_id?: string;
}, now_ms: number): Promise<PreviewResult>;
//# sourceMappingURL=preview_convert_transaction.orchestrator.d.ts.map