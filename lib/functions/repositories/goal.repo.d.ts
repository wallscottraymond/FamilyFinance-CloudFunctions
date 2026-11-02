/**
 * Goal Repository — Goals (Phase 1)
 *
 * Persistence for the `goals` collection. Maps the internal snake_case
 * `GoalEntity` to/from a camelCase Firestore document (matching the rest of the
 * app's stored shape). Reads query by a single field (`ownerId`) and filter the
 * rest in memory, so no new composite indexes are needed (a user has few goals).
 *
 * @module repositories/goal
 */
import { TraceContext } from "../types";
import { GoalEntity } from "../types/goals/goal_entity.types";
export declare const goal_repo: {
    new_id(): string;
    /**
     * The id a CREATE request writes, derived from (user, idempotency key): a retry that re-runs the
     * create (the server may take over a FAILED key — e.g. a follow-up step threw AFTER the write)
     * overwrites the same doc instead of making a duplicate (Code-Health-Review batch 9 verify V2-M1).
     */
    id_for_request(user_id: string, idempotency_key: string): string;
    save(_ctx: TraceContext, entity: GoalEntity): Promise<void>;
    get_by_id(_ctx: TraceContext, id: string): Promise<GoalEntity | null>;
    /** All of the user's active goals (single-field query + in-memory active filter). */
    get_by_user(_ctx: TraceContext, user_id: string): Promise<GoalEntity[]>;
    /** The user's active goals tied to one account (for priority rank + partition). */
    get_by_account(ctx: TraceContext, user_id: string, account_id: string): Promise<GoalEntity[]>;
    /** Patch selected camelCase fields (always bumps updatedAt). */
    update(_ctx: TraceContext, id: string, patch: Record<string, unknown>): Promise<void>;
    /** Soft-delete: deactivate + archive (recoverable). */
    soft_delete(_ctx: TraceContext, id: string): Promise<void>;
};
//# sourceMappingURL=goal.repo.d.ts.map