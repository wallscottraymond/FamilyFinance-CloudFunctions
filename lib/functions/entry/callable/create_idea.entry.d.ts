/**
 * Create Idea Entry Point (Planning-Module v1, Ideas). Adds an idea to the caller's Me list or a
 * group's list; only the title is required. The client-made idea id dedupes retries.
 *
 * @module entry/callable/create_idea
 */
import { FunctionResponse } from "../../types";
import { CreateIdeaResult } from "../../types/ideas.types";
export declare const create_idea: import("firebase-functions/v2/https").CallableFunction<any, Promise<FunctionResponse<CreateIdeaResult>>, unknown>;
//# sourceMappingURL=create_idea.entry.d.ts.map