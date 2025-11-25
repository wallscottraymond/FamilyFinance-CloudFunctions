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

import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { corsMiddleware } from '../../../../middleware/cors';
import { authenticateRequest, UserRole } from '../../../../utils/auth';
import { validateRequest } from '../../../../utils/validation';
import * as Joi from 'joi';
import {
  PlaidApi,
  LinkTokenCreateRequest,
  CountryCode,
  Products,
  DepositoryAccountSubtype,
  CreditAccountSubtype,
  InvestmentAccountSubtype
} from 'plaid';
import { createStandardPlaidClient } from '../../../../utils/plaidClientFactory';

// Define secrets for Plaid configuration
const plaidClientId = defineSecret('PLAID_CLIENT_ID');
const plaidSecret = defineSecret('PLAID_SECRET');

// Request validation schema
const createLinkTokenSchema = Joi.object({
  userId: Joi.string().optional(), // Optional override for admin users
  redirectUri: Joi.string().uri().optional(), // Optional custom redirect URI
  webhookUrl: Joi.string().uri().optional(), // Optional webhook URL override
});

interface CreateLinkTokenRequest {
  userId?: string;
  redirectUri?: string;
  webhookUrl?: string;
}

interface CreateLinkTokenResponse {
  success: boolean;
  data?: {
    linkToken: string;
    expiration: string;
    requestId: string;
  };
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}

// Use centralized Plaid client factory
function getPlaidClient(): PlaidApi {
  return createStandardPlaidClient();
}

/**
 * Create Plaid Link Token
 */
export const createLinkToken = onRequest(
  {
    memory: '256MiB',
    timeoutSeconds: 30,
    cors: true,
    secrets: [plaidClientId, plaidSecret],
  },
  async (req, res) => {
    return new Promise<void>(async (resolve) => {
      try {
        // Apply CORS middleware
        corsMiddleware(req, res, async () => {
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
            const { user, userData } = await authenticateRequest(req, UserRole.VIEWER);

            // Validate request body
            const validationResult = validateRequest(req.body, createLinkTokenSchema);
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

            const requestData: CreateLinkTokenRequest = validationResult.value;

            // Determine the user ID (allow admin override)
            const targetUserId = requestData.userId && userData.role === UserRole.ADMIN 
              ? requestData.userId 
              : user.uid;

            // Get user data for the target user
            const userDisplayName = userData.displayName || userData.email || 'User';

            // Prepare link token request with credentials from secrets
            const linkTokenRequest: LinkTokenCreateRequest = {
              client_id: plaidClientId.value(),
              secret: plaidSecret.value(),
              products: [Products.Transactions, Products.Auth],
              client_name: 'Family Finance',
              country_codes: [CountryCode.Us],
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
                    DepositoryAccountSubtype.Checking, 
                    DepositoryAccountSubtype.Savings, 
                    DepositoryAccountSubtype.MoneyMarket, 
                    DepositoryAccountSubtype.Cd
                  ],
                },
                credit: {
                  account_subtypes: [CreditAccountSubtype.CreditCard],
                },
                investment: {
                  account_subtypes: [
                    InvestmentAccountSubtype._401k, 
                    InvestmentAccountSubtype._403B, 
                    InvestmentAccountSubtype.Ira, 
                    InvestmentAccountSubtype.Roth, 
                    InvestmentAccountSubtype.Brokerage
                  ],
                },
              },
            };

            // Debug the actual values being passed to Plaid
            console.log('Making Plaid API call with credentials:', {
              client_id_length: linkTokenRequest.client_id?.length || 0,
              client_id_value: linkTokenRequest.client_id || 'MISSING',
              secret_length: linkTokenRequest.secret?.length || 0,
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
            } as CreateLinkTokenResponse);

            console.log('Link token created successfully', {
              userId: targetUserId,
              requestId: response.data.request_id,
              expiration: response.data.expiration,
            });

            resolve();
          } catch (error) {
            console.error('Error creating link token:', error);

            // Handle specific Plaid errors
            if (error && typeof error === 'object' && 'response' in error) {
              const plaidError = error as any;
              res.status(400).json({
                success: false,
                error: {
                  code: 'PLAID_API_ERROR',
                  message: plaidError.response?.data?.error_message || 'Plaid API error occurred',
                  details: {
                    error_type: plaidError.response?.data?.error_type,
                    error_code: plaidError.response?.data?.error_code,
                    display_message: plaidError.response?.data?.display_message,
                  },
                },
              });
            } else {
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
      } catch (error) {
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
  }
);