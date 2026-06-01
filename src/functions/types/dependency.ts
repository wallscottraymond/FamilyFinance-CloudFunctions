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
export type ResolveStrategy =
  | "by_category"
  | "by_date_range"
  | "by_account"
  | "by_user"
  | "full_rebuild";

/**
 * Types of derived data that may need recomputation.
 */
export type DerivedNodeType =
  | "budget_snapshot"
  | "budget_period"
  | "outflow_period"
  | "inflow_period"
  | "user_summary"
  | "cashflow_projection"
  | "analytics"
  | "goal_progress"
  | "bill_matching";

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
export function no_dependencies(): DependencyResult {
  return {
    affected_entities: [],
    recomputation_scope: "none",
    consistency_risk: "low",
    required_rebuild: false,
  };
}

/**
 * Creates a dependency result for a single affected entity.
 */
export function single_dependency(
  entity_id: string,
  risk: ConsistencyRisk = "low"
): DependencyResult {
  return {
    affected_entities: [entity_id],
    recomputation_scope: "single",
    consistency_risk: risk,
    required_rebuild: false,
  };
}

/**
 * Creates a dependency result for multiple affected entities.
 */
export function batch_dependencies(
  entity_ids: string[],
  risk: ConsistencyRisk = "medium"
): DependencyResult {
  if (entity_ids.length === 0) {
    return no_dependencies();
  }
  if (entity_ids.length === 1) {
    return single_dependency(entity_ids[0], risk);
  }
  return {
    affected_entities: entity_ids,
    recomputation_scope: "batch",
    consistency_risk: risk,
    required_rebuild: false,
  };
}

/**
 * Creates a dependency result requiring full rebuild.
 */
export function full_rebuild(
  affected_entities: string[] = []
): DependencyResult {
  return {
    affected_entities,
    recomputation_scope: "full",
    consistency_risk: "high",
    required_rebuild: true,
  };
}

/**
 * Merges multiple dependency results into one.
 * Takes the most severe scope and risk.
 */
export function merge_dependencies(results: DependencyResult[]): DependencyResult {
  if (results.length === 0) {
    return no_dependencies();
  }

  const all_entities = new Set<string>();
  let highest_scope: RecomputationScope = "none";
  let highest_risk: ConsistencyRisk = "low";
  let any_rebuild = false;
  const all_node_types = new Set<DerivedNodeType>();

  const scope_order: RecomputationScope[] = ["none", "single", "batch", "full"];
  const risk_order: ConsistencyRisk[] = ["low", "medium", "high"];

  for (const result of results) {
    result.affected_entities.forEach((id) => all_entities.add(id));

    if (scope_order.indexOf(result.recomputation_scope) > scope_order.indexOf(highest_scope)) {
      highest_scope = result.recomputation_scope;
    }

    if (risk_order.indexOf(result.consistency_risk) > risk_order.indexOf(highest_risk)) {
      highest_risk = result.consistency_risk;
    }

    if (result.required_rebuild) {
      any_rebuild = true;
    }

    result.affected_node_types?.forEach((type) => all_node_types.add(type));
  }

  return {
    affected_entities: Array.from(all_entities),
    recomputation_scope: highest_scope,
    consistency_risk: highest_risk,
    required_rebuild: any_rebuild,
    affected_node_types: all_node_types.size > 0 ? Array.from(all_node_types) : undefined,
  };
}
