"use strict";
/**
 * Exchange Plaid Token Cloud Function
 *
 * Exchanges a public token for an access token using the Plaid API.
 * This function orchestrates the complete token exchange flow including:
 * - Public token → Access token exchange
 * - Account data retrieval and storage
 * - Recurring transaction processing
 * - Transaction conversion to Family Finance format
 *
 * Security Features:
 * - User authentication required (VIEWER role minimum)
 * - Encrypted access token storage (TODO: implement encryption)
 * - Proper error handling and validation
 *
 * Memory: 256MiB, Timeout: 30s
 * CORS: Enabled for mobile app
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.exchangePlaidToken = void 0;
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const cors_1 = require("../../../../middleware/cors");
const auth_1 = require("../../../../utils/auth");
const validation_1 = require("../../../../utils/validation");
const Joi = __importStar(require("joi"));
const plaid_1 = require("../../../integrations/plaid");
const plaidAccounts_1 = require("../../../../utils/plaidAccounts");
const accounts_1 = require("../../../orchestrators/accounts");
const observability_1 = require("../../../observability");
// Define secrets for Firebase configuration
const plaidClientId = (0, params_1.defineSecret)('PLAID_CLIENT_ID');
const plaidSecret = (0, params_1.defineSecret)('PLAID_SECRET');
const tokenEncryptionKey = (0, params_1.defineSecret)('TOKEN_ENCRYPTION_KEY');
// Request validation schema
const exchangePlaidTokenSchema = Joi.object({
    publicToken: Joi.string().required(),
    metadata: Joi.object({
        institution: Joi.object({
            name: Joi.string().required(),
            institution_id: Joi.string().required(),
        }).required(),
        accounts: Joi.array().items(Joi.object({
            id: Joi.string().required(),
            name: Joi.string().required(),
            type: Joi.string().required(),
            subtype: Joi.string().allow(null).optional(),
        })).required(),
        link_session_id: Joi.string().required(),
    }).required(),
});
/**
 * Main exchange Plaid token function
 */
exports.exchangePlaidToken = (0, https_1.onRequest)({
    memory: '256MiB',
    timeoutSeconds: 30,
    cors: true,
    secrets: [plaidClientId, plaidSecret, tokenEncryptionKey],
}, async (req, res) => {
    return new Promise(async (resolve) => {
        try {
            // Apply CORS middleware
            (0, cors_1.corsMiddleware)(req, res, async () => {
                try {
                    await handleTokenExchange(req, res);
                    resolve();
                }
                catch (error) {
                    console.error('Error in CORS middleware handler:', error);
                    handleError(res, error, 'TOKEN_EXCHANGE_ERROR');
                    resolve();
                }
            });
        }
        catch (error) {
            console.error('Error in exchangePlaidToken main function:', error);
            handleError(res, error, 'FUNCTION_ERROR');
            resolve();
        }
    });
});
/**
 * Handles the main token exchange logic
 */
async function handleTokenExchange(req, res) {
    try {
        // Only allow POST requests
        if (req.method !== 'POST') {
            res.status(405).json({
                success: false,
                error: {
                    code: 'METHOD_NOT_ALLOWED',
                    message: 'Only POST requests are allowed',
                },
                timestamp: new Date().toISOString(),
            });
            return;
        }
        // Authenticate user
        const { user } = await (0, auth_1.authenticateRequest)(req, auth_1.UserRole.VIEWER);
        console.log('User authenticated successfully:', { userId: user.uid });
        // Validate request body
        const validationResult = (0, validation_1.validateRequest)(req.body, exchangePlaidTokenSchema);
        if (validationResult.error) {
            throw new Error(`Request validation failed: ${validationResult.error}`);
        }
        const requestData = validationResult.value; // Non-null assertion since we checked for error
        console.log('Request validated successfully');
        console.log('Exchanging public token for user:', user.uid, 'institution:', requestData.metadata.institution.name);
        // Step 1: Exchange public token using new integration client
        const raw_response = await (0, plaid_1.exchange_public_token)(requestData.publicToken);
        const { access_token: accessToken, item_id: itemId } = (0, plaid_1.transform_token_exchange_response)(raw_response);
        // Step 2: Fetch user's groupIds for RBAC
        const { getDocument } = await Promise.resolve().then(() => __importStar(require('../../../../utils/firestore')));
        const userDoc = await getDocument('users', user.uid);
        const groupId = (userDoc === null || userDoc === void 0 ? void 0 : userDoc.familyId) || (userDoc === null || userDoc === void 0 ? void 0 : userDoc.groupId) || null;
        const groupIds = groupId ? [groupId] : [];
        // Step 3: Save Plaid item (stores encrypted access token)
        await (0, plaidAccounts_1.savePlaidItem)(itemId, user.uid, requestData.metadata.institution.institution_id, requestData.metadata.institution.name, accessToken);
        // Step 4: Fetch and save accounts using new architecture
        const trace = {
            trace_id: (0, observability_1.generate_id)(),
            span_id: (0, observability_1.generate_id)(),
        };
        const idempotency_key = `link_plaid_accounts:${user.uid}:${itemId}:${requestData.metadata.link_session_id}`;
        const orchestrator_result = await (0, accounts_1.link_plaid_accounts_orchestrator)(trace, user.uid, {
            access_token: accessToken,
            item_id: itemId,
            institution: {
                institution_id: requestData.metadata.institution.institution_id,
                name: requestData.metadata.institution.name,
            },
            group_ids: groupIds,
            idempotency_key,
        });
        console.log('Plaid accounts linked via new architecture:', {
            accounts_linked: orchestrator_result.accounts_linked,
            trace_id: trace.trace_id,
        });
        console.log('✅ onPlaidItemCreated trigger will handle all sync operations');
        // Map orchestrator result to legacy response format for backwards compatibility
        // The frontend expects ProcessedAccount[] format
        const accounts = orchestrator_result.account_ids.map((id, index) => {
            var _a, _b, _c;
            return ({
                id,
                name: ((_a = requestData.metadata.accounts[index]) === null || _a === void 0 ? void 0 : _a.name) || `Account ${index + 1}`,
                type: ((_b = requestData.metadata.accounts[index]) === null || _b === void 0 ? void 0 : _b.type) || 'unknown',
                subtype: ((_c = requestData.metadata.accounts[index]) === null || _c === void 0 ? void 0 : _c.subtype) || null,
                currentBalance: 0, // Will be populated by balance sync trigger
                availableBalance: null,
                currencyCode: 'USD',
                mask: null,
                officialName: null,
            });
        });
        // Prepare response
        const response = {
            success: true,
            data: {
                itemId,
                accounts,
                institutionName: requestData.metadata.institution.name,
            },
            timestamp: new Date().toISOString(),
        };
        console.log('Token exchange completed successfully', {
            userId: user.uid,
            itemId,
            institutionName: requestData.metadata.institution.name,
            accountCount: orchestrator_result.accounts_linked,
            trace_id: trace.trace_id,
            nextSteps: 'onPlaidItemCreated trigger will sync balances, transactions, and recurring transactions'
        });
        res.status(200).json(response);
    }
    catch (error) {
        console.error('Error in handleTokenExchange:', error);
        throw error; // Re-throw to be handled by caller
    }
}
/**
 * Handles errors with comprehensive logging and consistent response format
 */
function handleError(res, error, defaultCode = 'INTERNAL_ERROR') {
    console.error('Exchange Plaid Token Error:', {
        error: error instanceof Error ? error.message : error,
        stack: error instanceof Error ? error.stack : undefined,
        code: defaultCode,
        timestamp: new Date().toISOString()
    });
    let statusCode = 500;
    let errorCode = defaultCode;
    let errorMessage = 'An unexpected error occurred';
    if (error instanceof Error) {
        errorMessage = error.message;
        // Map specific error types to appropriate status codes
        if (error.message.includes('Authentication required') || error.message.includes('Invalid authentication')) {
            statusCode = 401;
            errorCode = 'AUTHENTICATION_ERROR';
        }
        else if (error.message.includes('validation failed') || error.message.includes('Invalid request')) {
            statusCode = 400;
            errorCode = 'VALIDATION_ERROR';
        }
        else if (error.message.includes('Token exchange failed') || error.message.includes('Plaid')) {
            statusCode = 400;
            errorCode = 'PLAID_API_ERROR';
        }
    }
    const errorResponse = {
        success: false,
        error: {
            code: errorCode,
            message: errorMessage,
            details: process.env.NODE_ENV === 'development' ? {
                stack: error instanceof Error ? error.stack : undefined,
                originalError: error
            } : undefined
        },
        timestamp: new Date().toISOString(),
    };
    res.status(statusCode).json(errorResponse);
}
//# sourceMappingURL=exchangePlaidToken.js.map