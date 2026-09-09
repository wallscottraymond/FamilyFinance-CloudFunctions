/**
 * Create Goal Entry Point — Goals (Phase 1)
 *
 * onCall entry for creating a goal in the layered architecture.
 *
 * @module entry/callable/create_goal
 */
import { log_operation_error } from "../../observability";
import { FunctionResponse } from "../../types";
import { CreateGoalResponse } from "../../types/goals/goal_crud.types";
export declare const create_goal: import("firebase-functions/v2/https").CallableFunction<any, Promise<FunctionResponse<CreateGoalResponse>>, unknown>;
/** Maps thrown errors to HttpsError. Shared across goal entries. */
export declare function handle_goal_entry_error(error: unknown, ctx: {
    trace_id: string;
}, span: Parameters<typeof log_operation_error>[0], user_id: string, action: string): never;
//# sourceMappingURL=create_goal.entry.d.ts.map