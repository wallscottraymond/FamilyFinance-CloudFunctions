"use strict";
/**
 * Domain Types for Pure Business Logic
 *
 * These types are used by domain services to return computation results.
 * Domain services are PURE - no IO, no side effects, deterministic.
 *
 * @module types/domain
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.success = success;
exports.success_many = success_many;
exports.validation_failed = validation_failed;
exports.partial_success = partial_success;
exports.has_errors = has_errors;
exports.has_entities = has_entities;
exports.get_entities = get_entities;
exports.combine_results = combine_results;
/**
 * Creates a successful single-entity domain result.
 */
function success(entity) {
    return { entity };
}
/**
 * Creates a successful multi-entity domain result.
 */
function success_many(entities) {
    return { entities };
}
/**
 * Creates a domain result with validation errors.
 */
function validation_failed(errors) {
    return { validation_errors: errors };
}
/**
 * Creates a domain result with partial success (some entities + some errors).
 */
function partial_success(entities, validation_errors) {
    return { entities, validation_errors };
}
/**
 * Checks if a domain result has validation errors.
 */
function has_errors(result) {
    var _a, _b;
    return ((_b = (_a = result.validation_errors) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0) > 0;
}
/**
 * Checks if a domain result has any entities.
 */
function has_entities(result) {
    var _a, _b;
    return result.entity !== undefined || ((_b = (_a = result.entities) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0) > 0;
}
/**
 * Gets all entities from a domain result as an array.
 */
function get_entities(result) {
    var _a;
    if (result.entity) {
        return [result.entity];
    }
    return (_a = result.entities) !== null && _a !== void 0 ? _a : [];
}
/**
 * Combines multiple domain results into one.
 * Merges all entities and all validation errors.
 */
function combine_results(results) {
    const all_entities = [];
    const all_errors = [];
    for (const result of results) {
        if (result.entity) {
            all_entities.push(result.entity);
        }
        if (result.entities) {
            all_entities.push(...result.entities);
        }
        if (result.validation_errors) {
            all_errors.push(...result.validation_errors);
        }
    }
    return {
        entities: all_entities.length > 0 ? all_entities : undefined,
        validation_errors: all_errors.length > 0 ? all_errors : undefined,
    };
}
//# sourceMappingURL=domain.js.map