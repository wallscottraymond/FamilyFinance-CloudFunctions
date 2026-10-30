/**
 * submit_feedback — send a Feedback or Questions note.
 *
 * The note never stores who sent it (D2/D7); the client-made `note_id` dedupes a retried send;
 * 20 notes per UTC day (D8).
 *
 * @module entry/callable/submit_feedback
 */
import { FunctionResponse } from "../../types";
import { SubmitFeedbackResult } from "../../types/feedback.types";
export declare const submit_feedback: import("firebase-functions/v2/https").CallableFunction<any, Promise<FunctionResponse<SubmitFeedbackResult>>, unknown>;
//# sourceMappingURL=submit_feedback.entry.d.ts.map