/**
 * Plaid Client Factory Utility
 *
 * Provides centralized Plaid client creation and management
 * to reduce code duplication across Plaid functions.
 */

import { PlaidApi } from 'plaid';
import { defineSecret } from 'firebase-functions/params';
import { createPlaidClient } from './plaidClient';

// Define secrets for Plaid configuration (shared across functions)
const plaidClientId = defineSecret('PLAID_CLIENT_ID');
const plaidSecret = defineSecret('PLAID_SECRET');

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
export function createStandardPlaidClient(): PlaidApi {
  return createPlaidClient(plaidClientId.value(), plaidSecret.value());
}

/**
 * Creates a Plaid client with custom credentials (for testing/flexibility)
 *
 * @param clientId - Custom Plaid client ID
 * @param secret - Custom Plaid secret
 * @returns {PlaidApi} Configured Plaid API client
 */
export function createCustomPlaidClient(clientId: string, secret: string): PlaidApi {
  return createPlaidClient(clientId, secret);
}

/**
 * Validates Plaid client configuration
 *
 * @returns Promise<boolean> True if configuration is valid
 */
export async function validatePlaidConfiguration(): Promise<boolean> {
  try {
    const clientId = plaidClientId.value();
    const secret = plaidSecret.value();

    if (!clientId || !secret) {
      console.error('Plaid configuration missing: PLAID_CLIENT_ID or PLAID_SECRET not set');
      return false;
    }

    // Test client creation
    const client = createPlaidClient(clientId, secret);

    // Basic validation - client should have required methods
    const requiredMethods = [
      'itemPublicTokenExchange',
      'transactionsSync',
      'accountsGet',
      'institutionsGetById'
    ];

    for (const method of requiredMethods) {
      if (typeof client[method as keyof PlaidApi] !== 'function') {
        console.error(`Plaid client missing required method: ${method}`);
        return false;
      }
    }

    return true;
  } catch (error) {
    console.error('Plaid configuration validation failed:', error);
    return false;
  }
}

/**
 * Common error handling for Plaid API operations
 *
 * @param error - Error from Plaid API
 * @param operation - Description of the operation that failed
 * @returns Standardized error message
 */
export function handlePlaidError(error: any, operation: string): string {
  console.error(`Plaid ${operation} failed:`, error);

  if (error?.response?.data?.error_code) {
    const plaidError = error.response.data;
    return `Plaid ${operation} failed: ${plaidError.error_message} (${plaidError.error_code})`;
  }

  if (error instanceof Error) {
    return `Plaid ${operation} failed: ${error.message}`;
  }

  return `Plaid ${operation} failed: Unknown error`;
}

/**
 * Retry logic for Plaid API operations with exponential backoff
 *
 * @param operation - Async function to retry
 * @param maxRetries - Maximum number of retries (default: 3)
 * @param baseDelay - Base delay in ms (default: 1000)
 * @returns Promise with operation result
 */
export async function retryPlaidOperation<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: any;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (attempt === maxRetries) {
        throw error;
      }

      // Check if error is retryable
      const shouldRetry = isRetryableError(error);
      if (!shouldRetry) {
        throw error;
      }

      // Exponential backoff with jitter
      const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
      console.warn(`Plaid operation failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms:`, error);

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Determines if a Plaid error is retryable
 *
 * @param error - Error from Plaid API
 * @returns True if the error should be retried
 */
function isRetryableError(error: any): boolean {
  // Retry network errors and server errors
  if (!error?.response) {
    return true; // Network error
  }

  const status = error.response.status;

  // Retry server errors (5xx)
  if (status >= 500) {
    return true;
  }

  // Retry rate limiting
  if (status === 429) {
    return true;
  }

  // Check Plaid-specific retryable errors
  const errorCode = error.response.data?.error_code;
  const retryableErrorCodes = [
    'PLAID_ERROR', // Generic retryable error
    'API_ERROR',   // Server error
    'INTERNAL_SERVER_ERROR'
  ];

  return retryableErrorCodes.includes(errorCode);
}

/**
 * Standard Plaid client configuration for consistent setup
 */
export const PLAID_CONFIG = {
  // Standard timeout for Plaid operations
  timeout: 30000, // 30 seconds

  // Standard retry configuration
  maxRetries: 3,
  baseDelay: 1000,

  // Standard batch sizes
  transactionsBatchSize: 100,
  accountsBatchSize: 50,
} as const;

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
export function createPlaidResult<T>(
  success: boolean,
  data?: T,
  error?: string,
  retryCount?: number
): PlaidOperationResult<T> {
  return {
    success,
    data,
    error,
    retryCount
  };
}