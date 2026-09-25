/**
 * Rules Repository — persistence for the Transaction Rules Engine ("Rule Book").
 *
 * One Firestore doc per rule in the `rules` collection (no per-user-doc size ceiling / write
 * contention). Top-level fields are camelCase (`userId`/`isActive`/`priority`) for the query index;
 * the nested `conditions`/`actions` blobs use the domain shape (never queried, only loaded).
 *
 * COST: `get_active_rules` is the ONLY read the Rules Engine adds to the ingest path, and it runs
 * ONCE per sync batch (loaded above the per-txn loop — never per transaction). See the project's
 * Read-Cost Plan. Requires the composite index `(userId, isActive, priority)`.
 *
 * @module repositories/rules
 */
import { TraceContext } from "../types";
import { Rule, RuleActions, RuleConditionGroup } from "../types/rules.types";
/** The editable fields of a rule (create takes all; update takes a partial). */
type RuleWriteFields = {
    name: string;
    conditions: RuleConditionGroup;
    actions: RuleActions;
    priority: number;
    is_active: boolean;
};
export declare const rules_repo: {
    /**
     * Loads a user's ACTIVE rules, ordered by `priority` ascending (Rule Book list order).
     * Call this ONCE per sync batch; evaluate the returned rules against the in-memory transactions.
     */
    get_active_rules(_ctx: TraceContext, user_id: string): Promise<Rule[]>;
    /** Loads ALL of a user's rules (active + inactive), priority-ordered — for the Rule Book UI. */
    list_rules(_ctx: TraceContext, user_id: string): Promise<Rule[]>;
    /** Counts a user's rules (for the per-user cap). */
    count_rules(_ctx: TraceContext, user_id: string): Promise<number>;
    /** Creates a rule doc (camelCase top-level fields for the index; domain-shape nested blobs). */
    create_rule(_ctx: TraceContext, user_id: string, rule: RuleWriteFields): Promise<string>;
    /** Loads one rule (ownership-checked by the caller). */
    get_rule(_ctx: TraceContext, rule_id: string): Promise<Rule | null>;
    /** Patches a rule's editable fields (camelCase). Only provided fields are written. */
    update_rule(_ctx: TraceContext, rule_id: string, patch: Partial<RuleWriteFields>): Promise<void>;
    /** Hard-deletes a rule (rules carry no history to preserve). */
    delete_rule(_ctx: TraceContext, rule_id: string): Promise<void>;
};
export {};
//# sourceMappingURL=rules.repo.d.ts.map