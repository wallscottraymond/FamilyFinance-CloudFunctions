/**
 * Ideas Resolver (Planning-Module v1) — read-only.
 *
 * - An idea touches nothing derived (no budgets, periods or caches): no dependencies.
 * - Reads what the domain needs to decide: the feature flag, the list's group, the idea, and how
 *   many open ideas the list holds.
 *
 * @module resolvers/ideas/idea
 */
import { TraceContext } from "../../types";
import { DependencyResult } from "../../types/dependency";
import { Group } from "../../types/sharing.types";
import { Idea } from "../../types/ideas.types";
/** Ideas are standalone: nothing derived depends on them. */
export declare function resolve_idea_dependencies(_ctx: TraceContext): DependencyResult;
/** Is Ideas on for this person (`_feature_flags/ideas_v1`)? Never throws; problems = off. */
export declare function resolve_ideas_enabled(_ctx: TraceContext, user_id: string): Promise<boolean>;
/** The group behind a "group:<id>" owner key; null for a Me list or a missing group. */
export declare function resolve_list_group(ctx: TraceContext, owner_key: string): Promise<Group | null>;
export declare function resolve_idea(ctx: TraceContext, idea_id: string): Promise<Idea | null>;
export declare function resolve_open_count(ctx: TraceContext, owner_key: string): Promise<number>;
//# sourceMappingURL=idea.resolver.d.ts.map