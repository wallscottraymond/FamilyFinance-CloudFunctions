"use strict";
/**
 * Dependency Resolution Types
 *
 * These types define the contract for dependency resolvers.
 * Resolvers analyze what entities are affected by a change.
 *
 * @module types/dependency
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.no_dependencies = no_dependencies;
exports.single_dependency = single_dependency;
exports.batch_dependencies = batch_dependencies;
exports.full_rebuild = full_rebuild;
exports.merge_dependencies = merge_dependencies;
/**
 * Creates an empty dependency result (no affected entities).
 */
function no_dependencies() {
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
function single_dependency(entity_id, risk = "low") {
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
function batch_dependencies(entity_ids, risk = "medium") {
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
function full_rebuild(affected_entities = []) {
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
function merge_dependencies(results) {
    var _a;
    if (results.length === 0) {
        return no_dependencies();
    }
    const all_entities = new Set();
    let highest_scope = "none";
    let highest_risk = "low";
    let any_rebuild = false;
    const all_node_types = new Set();
    const scope_order = ["none", "single", "batch", "full"];
    const risk_order = ["low", "medium", "high"];
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
        (_a = result.affected_node_types) === null || _a === void 0 ? void 0 : _a.forEach((type) => all_node_types.add(type));
    }
    return {
        affected_entities: Array.from(all_entities),
        recomputation_scope: highest_scope,
        consistency_risk: highest_risk,
        required_rebuild: any_rebuild,
        affected_node_types: all_node_types.size > 0 ? Array.from(all_node_types) : undefined,
    };
}
//# sourceMappingURL=dependency.js.map