/**
 * Delete Idea Entry Point (Planning-Module v1, Ideas). Deletes an idea and its comments. Deleting
 * one that's already gone succeeds.
 *
 * @module entry/callable/delete_idea
 */
import { FunctionResponse } from "../../types";
import { DeleteIdeaResult } from "../../types/ideas.types";
export declare const delete_idea: import("firebase-functions/v2/https").CallableFunction<any, Promise<FunctionResponse<DeleteIdeaResult>>, unknown>;
//# sourceMappingURL=delete_idea.entry.d.ts.map