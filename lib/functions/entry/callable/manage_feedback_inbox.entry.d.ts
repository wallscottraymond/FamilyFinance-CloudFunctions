/**
 * manage_feedback_inbox — the owner-only Feedback Inbox (D10): list (by status, optional type),
 * mark read, open / done, delete. Anyone else gets PERMISSION_DENIED.
 *
 * @module entry/callable/manage_feedback_inbox
 */
import { FunctionResponse } from "../../types";
import { FeedbackInboxResult } from "../../types/feedback.types";
export declare const manage_feedback_inbox: import("firebase-functions/v2/https").CallableFunction<any, Promise<FunctionResponse<FeedbackInboxResult>>, unknown>;
//# sourceMappingURL=manage_feedback_inbox.entry.d.ts.map