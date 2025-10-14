/**
 * Mock Exchange Plaid Token Cloud Function
 * 
 * Temporary mock implementation for exchanging public tokens for access tokens.
 * This provides a working endpoint for testing the complete Plaid Link flow
 * without requiring real Plaid API integration.
 * 
 * Security Features:
 * - User authentication required (VIEWER role minimum)
 * - Mock data generation following Plaid patterns
 * - Proper error handling and validation
 * 
 * Memory: 256MiB, Timeout: 30s
 * CORS: Enabled for mobile app
 * Promise Pattern: ✓
 */

import { onRequest } from 'firebase-functions/v2/https';
import { corsMiddleware } from '../../../middleware/cors';
import { authenticateRequest, UserRole } from '../../../utils/auth';
import { validateRequest } from '../../../utils/validation';
import * as Joi from 'joi';
import { db } from '../../../index';

// Request validation schema
const exchangePlaidTokenSchema = Joi.object({
  publicToken: Joi.string().required(),
  metadata: Joi.object({
    institution: Joi.object({
      name: Joi.string().required(),
      institution_id: Joi.string().required(),
    }).required(),
    accounts: Joi.array().items(
      Joi.object({
        id: Joi.string().required(),
        name: Joi.string().required(),
        type: Joi.string().required(),
        subtype: Joi.string().allow(null).optional(),
      })
    ).required(),
    link_session_id: Joi.string().required(),
  }).required(),
});

interface ExchangePlaidTokenRequest {
  publicToken: string;
  metadata: {
    institution: {
      name: string;
      institution_id: string;
    };
    accounts: Array<{
      id: string;
      name: string;
      type: string;
      subtype?: string | null;
    }>;
    link_session_id: string;
  };
}

interface ExchangePlaidTokenResponse {
  success: boolean;
  data?: {
    itemId: string;
    accounts: Array<{
      id: string;
      name: string;
      type: string;
      subtype: string | null;
      currentBalance: number;
      availableBalance: number | null;
      currencyCode: string;
    }>;
    institutionName: string;
  };
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  message?: string;
}

/**
 * Mock Exchange Plaid Token
 */
export const exchangePlaidToken = onRequest(
  {
    memory: '256MiB',
    timeoutSeconds: 30,
    cors: true,
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

            // Authenticate user (require at least VIEWER role for linking accounts)
            const { user } = await authenticateRequest(req, UserRole.VIEWER);

            // Validate request body
            const validationResult = validateRequest(req.body, exchangePlaidTokenSchema);
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

            const requestData: ExchangePlaidTokenRequest = validationResult.value;

            console.log('Mock exchange for user:', user.uid, 'institution:', requestData.metadata.institution.name);

            // Generate mock account data based on the metadata
            const mockAccounts = requestData.metadata.accounts.map(account => ({
              id: `mock_account_${account.id}`,
              name: account.name,
              type: account.type,
              subtype: account.subtype,
              currentBalance: generateMockBalance(account.type, account.subtype),
              availableBalance: account.type === 'depository' ? generateMockBalance(account.type, account.subtype) * 0.9 : null,
              currencyCode: 'USD',
            }));

            // Create mock item ID
            const mockItemId = `mock_item_${Date.now()}_${user.uid.slice(0, 8)}`;

            // Save mock data to Firestore so the mobile app can read it
            console.log('Saving mock Plaid data to Firestore...');
            
            // Create the Plaid item document in user's subcollection
            await db.collection('users').doc(user.uid).collection('plaidItems').doc(mockItemId).set({
              itemId: mockItemId,
              userId: user.uid,
              institutionId: requestData.metadata.institution.institution_id,
              institutionName: requestData.metadata.institution.name,
              institutionLogo: null,
              accessToken: 'MOCK_ENCRYPTED_TOKEN', // Mock encrypted token
              cursor: null,
              products: ['transactions', 'auth'],
              status: 'GOOD',
              error: null,
              lastWebhookReceived: null,
              isActive: true,
              createdAt: new Date(),
              updatedAt: new Date(),
            });

            // Create account documents in user's subcollection
            for (const account of mockAccounts) {
              await db.collection('users').doc(user.uid).collection('plaidAccounts').doc(account.id).set({
                accountId: account.id,
                itemId: mockItemId,
                userId: user.uid,
                name: account.name,
                type: account.type,
                subtype: account.subtype,
                balances: {
                  available: account.availableBalance,
                  current: account.currentBalance,
                  limit: null,
                  iso_currency_code: account.currencyCode,
                },
                currentBalance: account.currentBalance,
                availableBalance: account.availableBalance,
                currencyCode: account.currencyCode,
                accountName: account.name,
                accountType: account.type,
                accountSubtype: account.subtype,
                isActive: true,
                isSyncEnabled: true,
                lastSyncedAt: new Date(),
                createdAt: new Date(),
                updatedAt: new Date(),
              });
            }

            console.log('Mock Plaid data saved to Firestore successfully');

            // Return mock successful response
            res.status(200).json({
              success: true,
              data: {
                itemId: mockItemId,
                accounts: mockAccounts,
                institutionName: requestData.metadata.institution.name,
              },
              message: 'MOCK: Token exchanged successfully. Configure Plaid secrets to use real API.',
            } as ExchangePlaidTokenResponse);

            console.log('Mock token exchange completed successfully', {
              userId: user.uid,
              itemId: mockItemId,
              institutionName: requestData.metadata.institution.name,
              accountCount: mockAccounts.length,
              isMock: true,
            });

            resolve();
          } catch (error) {
            console.error('Error in mock exchange token:', error);

            // Handle general errors
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            res.status(500).json({
              success: false,
              error: {
                code: 'INTERNAL_ERROR',
                message: errorMessage,
              },
            });

            resolve();
          }
        });
      } catch (error) {
        console.error('Unhandled error in exchangePlaidToken:', error);
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

/**
 * Generate realistic mock balances based on account type
 */
function generateMockBalance(accountType: string, accountSubtype?: string | null): number {
  const random = Math.random();
  
  switch (accountType.toLowerCase()) {
    case 'depository':
      switch (accountSubtype?.toLowerCase()) {
        case 'checking':
          return Math.floor(random * 5000 + 500); // $500 - $5,500
        case 'savings':
          return Math.floor(random * 25000 + 1000); // $1,000 - $26,000
        case 'money market':
          return Math.floor(random * 50000 + 5000); // $5,000 - $55,000
        case 'cd':
          return Math.floor(random * 100000 + 10000); // $10,000 - $110,000
        default:
          return Math.floor(random * 10000 + 500); // Default for other depository
      }
    case 'credit':
      return Math.floor(random * 2500 + 100); // $100 - $2,600 (credit card balance)
    case 'investment':
      return Math.floor(random * 500000 + 5000); // $5,000 - $505,000
    case 'loan':
      return Math.floor(random * 50000 + 1000); // $1,000 - $51,000 (remaining balance)
    default:
      return Math.floor(random * 1000 + 100); // Default fallback
  }
}