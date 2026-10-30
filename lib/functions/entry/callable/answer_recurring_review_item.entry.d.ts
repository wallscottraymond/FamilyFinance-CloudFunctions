/**
 * Answer Recurring Review Item Entry Point (Convert-To-Recurring Phase 1)
 *
 * One tap on a Bills-to-review tile: Track this bill / Not a bill (suggestions), Still a bill /
 * It ended, Keep separate. Owner-only (D15 / D24): the item id must be the caller's own; a group
 * member gets PermissionDenied. Delegates to the orchestrator.
 *
 * @module entry/callable/answer_recurring_review_item
 */
import { FunctionResponse } from "../../types";
export declare const answer_recurring_review_item: import("firebase-functions/v2/https").CallableFunction<any, Promise<FunctionResponse<unknown>>, unknown>;
//# sourceMappingURL=answer_recurring_review_item.entry.d.ts.map