"use strict";
/**
 * Plaid Client Factory Utility
 *
 * Provides centralized Plaid client creation and management
 * to reduce code duplication across Plaid functions.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLAID_CONFIG = void 0;
exports.createStandardPlaidClient = createStandardPlaidClient;
exports.createCustomPlaidClient = createCustomPlaidClient;
exports.validatePlaidConfiguration = validatePlaidConfiguration;
exports.handlePlaidError = handlePlaidError;
exports.retryPlaidOperation = retryPlaidOperation;
exports.createPlaidResult = createPlaidResult;
const params_1 = require("firebase-functions/params");
const plaidClient_1 = require("./plaidClient");
// Define secrets for Plaid configuration (shared across functions)
const plaidClientId = (0, params_1.defineSecret)('PLAID_CLIENT_ID');
const plaidSecret = (0, params_1.defineSecret)('PLAID_SECRET');
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
function createStandardPlaidClient() {
    return (0, plaidClient_1.createPlaidClient)(plaidClientId.value(), plaidSecret.value());
}
/**
 * Creates a Plaid client with custom credentials (for testing/flexibility)
 *
 * @param clientId - Custom Plaid client ID
 * @param secret - Custom Plaid secret
 * @returns {PlaidApi} Configured Plaid API client
 */
function createCustomPlaidClient(clientId, secret) {
    return (0, plaidClient_1.createPlaidClient)(clientId, secret);
}
/**
 * Validates Plaid client configuration
 *
 * @returns Promise<boolean> True if configuration is valid
 */
async function validatePlaidConfiguration() {
    try {
        const clientId = plaidClientId.value();
        const secret = plaidSecret.value();
        if (!clientId || !secret) {
            console.error('Plaid configuration missing: PLAID_CLIENT_ID or PLAID_SECRET not set');
            return false;
        }
        // Test client creation
        const client = (0, plaidClient_1.createPlaidClient)(clientId, secret);
        // Basic validation - client should have required methods
        const requiredMethods = [
            'itemPublicTokenExchange',
            'transactionsSync',
            'accountsGet',
            'institutionsGetById'
        ];
        for (const method of requiredMethods) {
            if (typeof client[method] !== 'function') {
                console.error(`Plaid client missing required method: ${method}`);
                return false;
            }
        }
        return true;
    }
    catch (error) {
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
function handlePlaidError(error, operation) {
    var _a, _b;
    console.error(`Plaid ${operation} failed:`, error);
    if ((_b = (_a = error === null || error === void 0 ? void 0 : error.response) === null || _a === void 0 ? void 0 : _a.data) === null || _b === void 0 ? void 0 : _b.error_code) {
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
async function retryPlaidOperation(operation, maxRetries = 3, baseDelay = 1000) {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        }
        catch (error) {
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
function isRetryableError(error) {
    var _a;
    // Retry network errors and server errors
    if (!(error === null || error === void 0 ? void 0 : error.response)) {
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
    const errorCode = (_a = error.response.data) === null || _a === void 0 ? void 0 : _a.error_code;
    const retryableErrorCodes = [
        'PLAID_ERROR', // Generic retryable error
        'API_ERROR', // Server error
        'INTERNAL_SERVER_ERROR'
    ];
    return retryableErrorCodes.includes(errorCode);
}
/**
 * Standard Plaid client configuration for consistent setup
 */
exports.PLAID_CONFIG = {
    // Standard timeout for Plaid operations
    timeout: 30000, // 30 seconds
    // Standard retry configuration
    maxRetries: 3,
    baseDelay: 1000,
    // Standard batch sizes
    transactionsBatchSize: 100,
    accountsBatchSize: 50,
};
/**
 * Creates a standardized result wrapper for Plaid operations
 *
 * @param success - Whether the operation succeeded
 * @param data - Operation result data
 * @param error - Error message if failed
 * @param retryCount - Number of retries attempted
 * @returns Standardized result object
 */
function createPlaidResult(success, data, error, retryCount) {
    return {
        success,
        data,
        error,
        retryCount
    };
}
//# sourceMappingURL=plaidClientFactory.js.map