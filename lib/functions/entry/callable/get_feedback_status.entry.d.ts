/**
 * get_feedback_status — is the caller a Feedback Inbox owner, and (owner only) how many notes are
 * unread. A non-owner gets `is_owner: false` (never an error), which keeps the inbox row hidden.
 *
 * @module entry/callable/get_feedback_status
 */
import { FunctionResponse } from "../../types";
import { FeedbackStatusResult } from "../../types/feedback.types";
export declare const get_feedback_status: import("firebase-functions/v2/https").CallableFunction<any, Promise<FunctionResponse<FeedbackStatusResult>>, unknown>;
//# sourceMappingURL=get_feedback_status.entry.d.ts.map