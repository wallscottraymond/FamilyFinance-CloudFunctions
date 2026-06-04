/**
 * Dependency Resolution Types
 *
 * These types define the contract for dependency resolvers.
 * Resolvers analyze what entities are affected by a change.
 *
 * @module types/dependency
 */
/**
 * Scope of recomputation needed after a change.
 *
 * - none: No recomputation needed
 * - single: Only one entity needs update
 * - batch: Multiple entities need update (can be done in one job)
 * - full: Full rebuild required (rare, expensive)
 */
export type RecomputationScope = "none" | "single" | "batch" | "full";
/**
 * Risk level for consistency after a change.
 *
 * - low: Safe to proceed, eventual consistency acceptable
 * - medium: Should complete recomputation soon
 * - high: Immediate recomputation required
 */
export type ConsistencyRisk = "low" | "medium" | "high";
/**
 * Strategy for resolving which entities are affected.
 *
 * - by_category: Find entities matching a category
 * - by_date_range: Find entities in a date range
 * - by_account: Find entities for an account
 * - by_user: Find all entities for a user
 * - full_rebuild: Rebuild everything (expensive)
 */
export type ResolveStrategy = "by_category" | "by_date_range" | "by_account" | "by_user" | "full_rebuild";
/**
 * Types of derived data that may need recomputation.
 */
export type DerivedNodeType = "budget_snapshot" | "budget_period" | "outflow_period" | "inflow_period" | "user_summary" | "cashflow_projection" | "analytics" | "goal_progress" | "bill_matching";
/**
 * Result returned by dependency resolvers.
 * Tells the orchestrator what needs to be recomputed.
 */
export interface DependencyResult {
    /** IDs of entities that need recomputation */
    affected_entities: string[];
    /** Scope of recomputation needed */
    recomputation_scope: RecomputationScope;
    /** Risk level if recomputation is delayed */
    consistency_risk: ConsistencyRisk;
    /** Whether a full rebuild is required */
    required_rebuild: boolean;
    /** Optional: specific derived node types affected */
    affected_node_types?: DerivedNodeType[];
}
/**
 * Input describing what changed (used by resolvers).
 */
export interface ChangeModel {
    /** Type of entity that changed */
    entity_type: string;
    /** ID of the entity that changed */
    entity_id: string;
    /** Type of change */
    change_type: "created" | "updated" | "deleted";
    /** Fields that changed (for updates) */
    changed_fields?: string[];
    /** The entity before the change (for updates/deletes) */
    before?: unknown;
    /** The entity after the change (for creates/updates) */
    after?: unknown;
}
/**
 * Definition of a dependency relationship.
 * Used to build the dependency graph.
 */
export interface DependencyDefinition {
    /** Source entity type (what changed) */
    source_type: string;
    /** Target derived node type (what needs recomputation) */
    target_type: DerivedNodeType;
    /** Strategy to resolve affected entities */
    resolve_strategy: ResolveStrategy;
    /** Fields on source that trigger recomputation when changed */
    trigger_fields: string[];
    /** Default consistency risk for this dependency */
    default_risk: ConsistencyRisk;
}
/**
 * Creates an empty dependency result (no affected entities).
 */
export declare function no_dependencies(): DependencyResult;
/**
 * Creates a dependency result for a single affected entity.
 */
export declare function single_dependency(entity_id: string, risk?: ConsistencyRisk): DependencyResult;
/**
 * Creates a dependency result for multiple affected entities.
 */
export declare function batch_dependencies(entity_ids: string[], risk?: ConsistencyRisk): DependencyResult;
/**
 * Creates a dependency result requiring full rebuild.
 */
export declare function full_rebuild(affected_entities?: string[]): DependencyResult;
/**
 * Merges multiple dependency results into one.
 * Takes the most severe scope and risk.
 */
export declare function merge_dependencies(results: DependencyResult[]): DependencyResult;
//# sourceMappingURL=dependency.d.ts.map