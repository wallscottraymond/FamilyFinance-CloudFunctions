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

import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { corsMiddleware } from '../../../../middleware/cors';
import { authenticateRequest, UserRole } from '../../../../utils/auth';
import { validateRequest } from '../../../../utils/validation';
import * as Joi from 'joi';
import { exchangePublicToken } from '../../../../utils/plaidClient';
import { createStandardPlaidClient } from '../../../../utils/plaidClientFactory';
import { fetchPlaidAccounts, savePlaidItem, savePlaidAccounts, ProcessedAccount } from '../../../../utils/plaidAccounts';

// Define secrets for Firebase configuration
const plaidClientId = defineSecret('PLAID_CLIENT_ID');
const plaidSecret = defineSecret('PLAID_SECRET');
const tokenEncryptionKey = defineSecret('TOKEN_ENCRYPTION_KEY');

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
    accounts: ProcessedAccount[];
    institutionName: string;
  };
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  timestamp: string;
}

/**
 * Main exchange Plaid token function
 */
export const exchangePlaidToken = onRequest(
  {
    memory: '256MiB',
    timeoutSeconds: 30,
    cors: true,
    secrets: [plaidClientId, plaidSecret, tokenEncryptionKey],
  },
  async (req, res) => {
    return new Promise<void>(async (resolve) => {
      try {
        // Apply CORS middleware
        corsMiddleware(req, res, async () => {
          try {
            await handleTokenExchange(req, res);
            resolve();
          } catch (error) {
            console.error('Error in CORS middleware handler:', error);
            handleError(res, error, 'TOKEN_EXCHANGE_ERROR');
            resolve();
          }
        });
      } catch (error) {
        console.error('Error in exchangePlaidToken main function:', error);
        handleError(res, error, 'FUNCTION_ERROR');
        resolve();
      }
    });
  }
);

/**
 * Handles the main token exchange logic
 */
async function handleTokenExchange(req: any, res: any): Promise<void> {
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
    const { user } = await authenticateRequest(req, UserRole.VIEWER);
    console.log('User authenticated successfully:', { userId: user.uid });

    // Validate request body
    const validationResult = validateRequest<ExchangePlaidTokenRequest>(req.body, exchangePlaidTokenSchema);
    if (validationResult.error) {
      throw new Error(`Request validation failed: ${validationResult.error}`);
    }
    const requestData = validationResult.value!; // Non-null assertion since we checked for error
    console.log('Request validated successfully');

    console.log('Exchanging public token for user:', user.uid, 'institution:', requestData.metadata.institution.name);

    // Step 1: Create Plaid client and exchange token using centralized factory
    const plaidClient = createStandardPlaidClient();
    const { accessToken, itemId } = await exchangePublicToken(plaidClient, requestData.publicToken);

    // Step 2: Fetch and save account data
    const accounts = await fetchPlaidAccounts(plaidClient, accessToken, itemId);
    
    await savePlaidItem(
      itemId,
      user.uid,
      requestData.metadata.institution.institution_id,
      requestData.metadata.institution.name,
      accessToken
    );

    await savePlaidAccounts(
      accounts,
      itemId,
      user.uid,
      requestData.metadata.institution.institution_id,
      requestData.metadata.institution.name
    );

    console.log('Plaid data saved to Firestore successfully');
    console.log('✅ onPlaidItemCreated trigger will handle all sync operations');

    // Prepare response
    const response: ExchangePlaidTokenResponse = {
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
      accountCount: accounts.length,
      nextSteps: 'onPlaidItemCreated trigger will sync balances, transactions, and recurring transactions'
    });

    res.status(200).json(response);

  } catch (error) {
    console.error('Error in handleTokenExchange:', error);
    throw error; // Re-throw to be handled by caller
  }
}

/**
 * Handles errors with comprehensive logging and consistent response format
 */
function handleError(res: any, error: any, defaultCode: string = 'INTERNAL_ERROR'): void {
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
    } else if (error.message.includes('validation failed') || error.message.includes('Invalid request')) {
      statusCode = 400;
      errorCode = 'VALIDATION_ERROR';
    } else if (error.message.includes('Token exchange failed') || error.message.includes('Plaid')) {
      statusCode = 400;
      errorCode = 'PLAID_API_ERROR';
    }
  }

  const errorResponse: ExchangePlaidTokenResponse = {
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