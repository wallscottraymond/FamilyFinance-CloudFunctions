/**
 * Domain Types for Pure Business Logic
 *
 * These types are used by domain services to return computation results.
 * Domain services are PURE - no IO, no side effects, deterministic.
 *
 * @module types/domain
 */
/**
 * Result type returned by all domain services.
 *
 * Domain services NEVER throw exceptions for validation errors.
 * Instead, they return validation_errors in this result type.
 *
 * @example
 * // Single entity result
 * const result: DomainResult<Budget> = {
 *   entity: computedBudget,
 * };
 *
 * @example
 * // Multiple entities result
 * const result: DomainResult<Transaction[]> = {
 *   entities: transformedTransactions,
 * };
 *
 * @example
 * // Validation errors
 * const result: DomainResult<Budget> = {
 *   validation_errors: ["Amount must be positive", "Category is required"],
 * };
 */
export interface DomainResult<T> {
    /** Single entity result (use for create/update operations) */
    entity?: T;
    /** Multiple entities result (use for batch operations) */
    entities?: T[];
    /** Validation errors that occurred during computation */
    validation_errors?: string[];
}
/**
 * Creates a successful single-entity domain result.
 */
export declare function success<T>(entity: T): DomainResult<T>;
/**
 * Creates a successful multi-entity domain result.
 */
export declare function success_many<T>(entities: T[]): DomainResult<T>;
/**
 * Creates a domain result with validation errors.
 */
export declare function validation_failed<T>(errors: string[]): DomainResult<T>;
/**
 * Creates a domain result with partial success (some entities + some errors).
 */
export declare function partial_success<T>(entities: T[], validation_errors: string[]): DomainResult<T>;
/**
 * Checks if a domain result has validation errors.
 */
export declare function has_errors<T>(result: DomainResult<T>): boolean;
/**
 * Checks if a domain result has any entities.
 */
export declare function has_entities<T>(result: DomainResult<T>): boolean;
/**
 * Gets all entities from a domain result as an array.
 */
export declare function get_entities<T>(result: DomainResult<T>): T[];
/**
 * Combines multiple domain results into one.
 * Merges all entities and all validation errors.
 */
export declare function combine_results<T>(results: DomainResult<T>[]): DomainResult<T>;
//# sourceMappingURL=domain.d.ts.map