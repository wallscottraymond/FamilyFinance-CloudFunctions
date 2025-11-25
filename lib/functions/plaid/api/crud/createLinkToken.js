"use strict";
/**
 * Create Plaid Link Token Cloud Function
 *
 * Generates a link token required for Plaid Link initialization.
 * This function creates a secure token that allows the mobile app
 * to connect bank accounts through Plaid's Link flow.
 *
 * Security Features:
 * - User authentication required (VIEWER role minimum)
 * - User-specific token generation with client_user_id
 * - Secure product and environment configuration
 * - Error handling and validation
 *
 * Memory: 256MiB, Timeout: 30s
 * CORS: Enabled for mobile app
 * Promise Pattern: ✓
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
exports.createLinkToken = void 0;
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const cors_1 = require("../../../../middleware/cors");
const auth_1 = require("../../../../utils/auth");
const validation_1 = require("../../../../utils/validation");
const Joi = __importStar(require("joi"));
const plaid_1 = require("plaid");
const plaidClientFactory_1 = require("../../../../utils/plaidClientFactory");
// Define secrets for Plaid configuration
const plaidClientId = (0, params_1.defineSecret)('PLAID_CLIENT_ID');
const plaidSecret = (0, params_1.defineSecret)('PLAID_SECRET');
// Request validation schema
const createLinkTokenSchema = Joi.object({
    userId: Joi.string().optional(), // Optional override for admin users
    redirectUri: Joi.string().uri().optional(), // Optional custom redirect URI
    webhookUrl: Joi.string().uri().optional(), // Optional webhook URL override
});
// Use centralized Plaid client factory
function getPlaidClient() {
    return (0, plaidClientFactory_1.createStandardPlaidClient)();
}
/**
 * Create Plaid Link Token
 */
exports.createLinkToken = (0, https_1.onRequest)({
    memory: '256MiB',
    timeoutSeconds: 30,
    cors: true,
    secrets: [plaidClientId, plaidSecret],
}, async (req, res) => {
    return new Promise(async (resolve) => {
        try {
            // Apply CORS middleware
            (0, cors_1.corsMiddleware)(req, res, async () => {
                var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
                try {
                    // Only allow POST requests
                    if (req.method !== 'POST') {
                        res.status(405).json({
                            success: false,
                            error: {
                                code: 'METHOD_NOT_ALLOWED',
                                message: 'Only POST requests are allowed',
                            },
                        });
                        return resolve();
                    }
                    // Authenticate user (require at least VIEWER role)
                    const { user, userData } = await (0, auth_1.authenticateRequest)(req, auth_1.UserRole.VIEWER);
                    // Validate request body
                    const validationResult = (0, validation_1.validateRequest)(req.body, createLinkTokenSchema);
                    if (validationResult.error) {
                        res.status(400).json({
                            success: false,
                            error: {
                                code: 'VALIDATION_ERROR',
                                message: 'Invalid request body',
                                details: validationResult.error,
                            },
                        });
                        return resolve();
                    }
                    const requestData = validationResult.value;
                    // Determine the user ID (allow admin override)
                    const targetUserId = requestData.userId && userData.role === auth_1.UserRole.ADMIN
                        ? requestData.userId
                        : user.uid;
                    // Get user data for the target user
                    const userDisplayName = userData.displayName || userData.email || 'User';
                    // Prepare link token request with credentials from secrets
                    const linkTokenRequest = {
                        client_id: plaidClientId.value(),
                        secret: plaidSecret.value(),
                        products: [plaid_1.Products.Transactions, plaid_1.Products.Auth],
                        client_name: 'Family Finance',
                        country_codes: [plaid_1.CountryCode.Us],
                        language: 'en',
                        user: {
                            client_user_id: targetUserId,
                            legal_name: userDisplayName,
                            email_address: userData.email || undefined,
                        },
                        webhook: requestData.webhookUrl || process.env.PLAID_WEBHOOK_URL || undefined,
                        // redirect_uri: requestData.redirectUri || 'familyfinanceapp://plaidlink', // Temporarily disabled for sandbox testing
                        account_filters: {
                            depository: {
                                account_subtypes: [
                                    plaid_1.DepositoryAccountSubtype.Checking,
                                    plaid_1.DepositoryAccountSubtype.Savings,
                                    plaid_1.DepositoryAccountSubtype.MoneyMarket,
                                    plaid_1.DepositoryAccountSubtype.Cd
                                ],
                            },
                            credit: {
                                account_subtypes: [plaid_1.CreditAccountSubtype.CreditCard],
                            },
                            investment: {
                                account_subtypes: [
                                    plaid_1.InvestmentAccountSubtype._401k,
                                    plaid_1.InvestmentAccountSubtype._403B,
                                    plaid_1.InvestmentAccountSubtype.Ira,
                                    plaid_1.InvestmentAccountSubtype.Roth,
                                    plaid_1.InvestmentAccountSubtype.Brokerage
                                ],
                            },
                        },
                    };
                    // Debug the actual values being passed to Plaid
                    console.log('Making Plaid API call with credentials:', {
                        client_id_length: ((_a = linkTokenRequest.client_id) === null || _a === void 0 ? void 0 : _a.length) || 0,
                        client_id_value: linkTokenRequest.client_id || 'MISSING',
                        secret_length: ((_b = linkTokenRequest.secret) === null || _b === void 0 ? void 0 : _b.length) || 0,
                        secret_exists: !!linkTokenRequest.secret,
                        user_id: targetUserId,
                    });
                    // Create link token via Plaid API
                    const client = getPlaidClient();
                    const response = await client.linkTokenCreate(linkTokenRequest);
                    if (!response.data.link_token) {
                        throw new Error('Failed to create link token - no token returned');
                    }
                    // Return successful response
                    res.status(200).json({
                        success: true,
                        data: {
                            linkToken: response.data.link_token,
                            expiration: response.data.expiration,
                            requestId: response.data.request_id,
                        },
                    });
                    console.log('Link token created successfully', {
                        userId: targetUserId,
                        requestId: response.data.request_id,
                        expiration: response.data.expiration,
                    });
                    resolve();
                }
                catch (error) {
                    console.error('Error creating link token:', error);
                    // Handle specific Plaid errors
                    if (error && typeof error === 'object' && 'response' in error) {
                        const plaidError = error;
                        res.status(400).json({
                            success: false,
                            error: {
                                code: 'PLAID_API_ERROR',
                                message: ((_d = (_c = plaidError.response) === null || _c === void 0 ? void 0 : _c.data) === null || _d === void 0 ? void 0 : _d.error_message) || 'Plaid API error occurred',
                                details: {
                                    error_type: (_f = (_e = plaidError.response) === null || _e === void 0 ? void 0 : _e.data) === null || _f === void 0 ? void 0 : _f.error_type,
                                    error_code: (_h = (_g = plaidError.response) === null || _g === void 0 ? void 0 : _g.data) === null || _h === void 0 ? void 0 : _h.error_code,
                                    display_message: (_k = (_j = plaidError.response) === null || _j === void 0 ? void 0 : _j.data) === null || _k === void 0 ? void 0 : _k.display_message,
                                },
                            },
                        });
                    }
                    else {
                        // Handle general errors
                        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
                        res.status(500).json({
                            success: false,
                            error: {
                                code: 'INTERNAL_ERROR',
                                message: errorMessage,
                            },
                        });
                    }
                    resolve();
                }
            });
        }
        catch (error) {
            console.error('Unhandled error in createLinkToken:', error);
            res.status(500).json({
                success: false,
                error: {
                    code: 'INTERNAL_ERROR',
                    message: 'An unexpected error occurred',
                },
            });
            resolve();
        }
    });
});
//# sourceMappingURL=createLinkToken.js.map