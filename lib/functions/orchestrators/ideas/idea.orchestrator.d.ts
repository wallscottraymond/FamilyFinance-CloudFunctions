/**
 * Ideas orchestrators (Planning-Module v1)
 *
 * Every write: flag check → resolver (who owns the list, may the caller use it) → domain plan
 * inside the repo transaction → one atomic write. Client-made ids (idea, comment) make retries
 * safe: a retried create / comment finds its own doc and returns without writing.
 *
 * An idea the caller can't see answers NOT_FOUND (never "it exists but isn't yours").
 *
 * @module orchestrators/ideas/idea
 */
import { OrchestratorContext, TraceContext } from "../../types";
import { CreateIdeaInput, CreateIdeaResult, DeleteIdeaInput, DeleteIdeaResult, ReactToIdeaInput, ReactToIdeaResult, UpdateIdeaInput, UpdateIdeaResult } from "../../types/ideas.types";
/** Orchestrator outcome: data, or a client-facing refusal (code + message). */
export type IdeaOutcome<T> = {
    success: true;
    data: T;
} | {
    success: false;
    code: string;
    message: string;
};
export declare function create_idea_orchestrator(ctx: OrchestratorContext<CreateIdeaInput>, now_ms?: number): Promise<IdeaOutcome<CreateIdeaResult>>;
export declare function update_idea_orchestrator(ctx: OrchestratorContext<UpdateIdeaInput>, now_ms?: number): Promise<IdeaOutcome<UpdateIdeaResult>>;
export declare function delete_idea_orchestrator(ctx: OrchestratorContext<DeleteIdeaInput>): Promise<IdeaOutcome<DeleteIdeaResult>>;
export declare function react_to_idea_orchestrator(ctx: OrchestratorContext<ReactToIdeaInput>, now_ms?: number): Promise<IdeaOutcome<ReactToIdeaResult>>;
/** The app can't read `_feature_flags`, so it asks. Returns ONLY `{enabled}`. */
export declare function get_ideas_capabilities_orchestrator(ctx: TraceContext, user_id: string): Promise<{
    enabled: boolean;
}>;
//# sourceMappingURL=idea.orchestrator.d.ts.map