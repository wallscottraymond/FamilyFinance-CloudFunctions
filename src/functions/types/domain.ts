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
export function success<T>(entity: T): DomainResult<T> {
  return { entity };
}

/**
 * Creates a successful multi-entity domain result.
 */
export function success_many<T>(entities: T[]): DomainResult<T> {
  return { entities };
}

/**
 * Creates a domain result with validation errors.
 */
export function validation_failed<T>(errors: string[]): DomainResult<T> {
  return { validation_errors: errors };
}

/**
 * Creates a domain result with partial success (some entities + some errors).
 */
export function partial_success<T>(
  entities: T[],
  validation_errors: string[]
): DomainResult<T> {
  return { entities, validation_errors };
}

/**
 * Checks if a domain result has validation errors.
 */
export function has_errors<T>(result: DomainResult<T>): boolean {
  return (result.validation_errors?.length ?? 0) > 0;
}

/**
 * Checks if a domain result has any entities.
 */
export function has_entities<T>(result: DomainResult<T>): boolean {
  return result.entity !== undefined || (result.entities?.length ?? 0) > 0;
}

/**
 * Gets all entities from a domain result as an array.
 */
export function get_entities<T>(result: DomainResult<T>): T[] {
  if (result.entity) {
    return [result.entity];
  }
  return result.entities ?? [];
}

/**
 * Combines multiple domain results into one.
 * Merges all entities and all validation errors.
 */
export function combine_results<T>(results: DomainResult<T>[]): DomainResult<T> {
  const all_entities: T[] = [];
  const all_errors: string[] = [];

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
