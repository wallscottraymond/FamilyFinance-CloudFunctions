/**
 * Plaid Client Factory Utility
 *
 * Provides centralized Plaid client creation and management
 * to reduce code duplication across Plaid functions.
 */
import { PlaidApi } from 'plaid';
/**
 * Creates a standardized Plaid client with shared configuration
 *
 * This factory function centralizes Plaid client creation to:
 * - Reduce code duplication across functions
 * - Ensure consistent configuration
 * - Simplify credential management
 * - Provide a single point for client configuration changes
 *
 * @returns {PlaidApi} Configured Plaid API client
 */
export declare function createStandardPlaidClient(): PlaidApi;
/**
 * Creates a Plaid client with custom credentials (for testing/flexibility)
 *
 * @param clientId - Custom Plaid client ID
 * @param secret - Custom Plaid secret
 * @returns {PlaidApi} Configured Plaid API client
 */
export declare function createCustomPlaidClient(clientId: string, secret: string): PlaidApi;
/**
 * Validates Plaid client configuration
 *
 * @returns Promise<boolean> True if configuration is valid
 */
export declare function validatePlaidConfiguration(): Promise<boolean>;
/**
 * Common error handling for Plaid API operations
 *
 * @param error - Error from Plaid API
 * @param operation - Description of the operation that failed
 * @returns Standardized error message
 */
export declare function handlePlaidError(error: any, operation: string): string;
/**
 * Retry logic for Plaid API operations with exponential backoff
 *
 * @param operation - Async function to retry
 * @param maxRetries - Maximum number of retries (default: 3)
 * @param baseDelay - Base delay in ms (default: 1000)
 * @returns Promise with operation result
 */
export declare function retryPlaidOperation<T>(operation: () => Promise<T>, maxRetries?: number, baseDelay?: number): Promise<T>;
/**
 * Standard Plaid client configuration for consistent setup
 */
export declare const PLAID_CONFIG: {
    readonly timeout: 30000;
    readonly maxRetries: 3;
    readonly baseDelay: 1000;
    readonly transactionsBatchSize: 100;
    readonly accountsBatchSize: 50;
};
/**
 * Type definitions for common Plaid operations
 */
export interface PlaidOperationResult<T> {
    success: boolean;
    data?: T;
    error?: string;
    retryCount?: number;
}
/**
 * Creates a standardized result wrapper for Plaid operations
 *
 * @param success - Whether the operation succeeded
 * @param data - Operation result data
 * @param error - Error message if failed
 * @param retryCount - Number of retries attempted
 * @returns Standardized result object
 */
export declare function createPlaidResult<T>(success: boolean, data?: T, error?: string, retryCount?: number): PlaidOperationResult<T>;
//# sourceMappingURL=plaidClientFactory.d.ts.map