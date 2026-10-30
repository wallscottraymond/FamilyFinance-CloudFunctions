/**
 * Group Repository (D4, D30)
 *
 * `groups/{groupId}` plus each member's `users/{uid}.groupIds`. A membership
 * change touches both, so `apply_mutation` runs in ONE Firestore transaction:
 * it re-reads the group and the users, hands them to the (pure) domain rule the
 * orchestrator passes in, and writes the result. Limits (3 groups per user, 50
 * members) are therefore checked against fresh data and can't be raced past.
 *
 * Clients read `groups` only through callables (rules: members only).
 *
 * @module repositories/sharing/group
 */
import { Transaction } from "firebase-admin/firestore";
import { DomainResult, TraceContext } from "../../types";
import { Group, GroupMutation } from "../../types/sharing.types";
/** Computes a mutation from fresh data. `group_counts`: uid → number of groups. */
export type MutationRule = (group: Group | null, group_counts: Record<string, number>) => DomainResult<GroupMutation>;
export declare const group_repo: {
    new_id(): string;
    get(_ctx: TraceContext, group_id: string): Promise<Group | null>;
    /** Group docs by id (missing ids are skipped). */
    get_many(_ctx: TraceContext, group_ids: string[]): Promise<Group[]>;
    /** A user's active groups. */
    get_for_user(_ctx: TraceContext, user_id: string): Promise<Group[]>;
    /**
     * Applies a membership change atomically.
     *
     * Reads the group (if `group_id` exists) and the `users` docs of every member,
     * `count_user_ids`, and every user the rule changes; runs `rule`; on success
     * writes the group doc and each user's `groupIds`; `extra` adds writes to the
     * same transaction (e.g. marking a request accepted).
     *
     * @returns the rule's result (validation errors → nothing written)
     */
    apply_mutation(_ctx: TraceContext, group_id: string, count_user_ids: string[], rule: MutationRule, now_ms: number, extra?: (tx: Transaction, mutation: GroupMutation) => void): Promise<DomainResult<GroupMutation>>;
};
//# sourceMappingURL=group.repo.d.ts.map