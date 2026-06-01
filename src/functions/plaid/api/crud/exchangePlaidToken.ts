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
import { exchange_public_token, transform_token_exchange_response } from '../../../integrations/plaid';
import { savePlaidItem, ProcessedAccount } from '../../../../utils/plaidAccounts';
import { link_plaid_accounts_orchestrator } from '../../../orchestrators/accounts';
import { generate_id } from '../../../observability';
import { TraceContext } from '../../../types';

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

    // Step 1: Exchange public token using new integration client
    const raw_response = await exchange_public_token(requestData.publicToken);
    const { access_token: accessToken, item_id: itemId } = transform_token_exchange_response(raw_response);

    // Step 2: Fetch user's groupIds for RBAC
    const { getDocument } = await import('../../../../utils/firestore');
    const userDoc = await getDocument('users', user.uid);
    const groupId = (userDoc as any)?.familyId || (userDoc as any)?.groupId || null;
    const groupIds: string[] = groupId ? [groupId] : [];

    // Step 3: Save Plaid item (stores encrypted access token)
    await savePlaidItem(
      itemId,
      user.uid,
      requestData.metadata.institution.institution_id,
      requestData.metadata.institution.name,
      accessToken
    );

    // Step 4: Fetch and save accounts using new architecture
    const trace: TraceContext = {
      trace_id: generate_id(),
      span_id: generate_id(),
    };

    const idempotency_key = `link_plaid_accounts:${user.uid}:${itemId}:${requestData.metadata.link_session_id}`;

    const orchestrator_result = await link_plaid_accounts_orchestrator(
      trace,
      user.uid,
      {
        access_token: accessToken,
        item_id: itemId,
        institution: {
          institution_id: requestData.metadata.institution.institution_id,
          name: requestData.metadata.institution.name,
        },
        group_ids: groupIds,
        idempotency_key,
      }
    );

    console.log('Plaid accounts linked via new architecture:', {
      accounts_linked: orchestrator_result.accounts_linked,
      trace_id: trace.trace_id,
    });
    console.log('✅ onPlaidItemCreated trigger will handle all sync operations');

    // Map orchestrator result to legacy response format for backwards compatibility
    // The frontend expects ProcessedAccount[] format
    const accounts: ProcessedAccount[] = orchestrator_result.account_ids.map((id, index) => ({
      id,
      name: requestData.metadata.accounts[index]?.name || `Account ${index + 1}`,
      type: requestData.metadata.accounts[index]?.type || 'unknown',
      subtype: requestData.metadata.accounts[index]?.subtype || null,
      currentBalance: 0, // Will be populated by balance sync trigger
      availableBalance: null,
      currencyCode: 'USD',
      mask: null,
      officialName: null,
    }));

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
      accountCount: orchestrator_result.accounts_linked,
      trace_id: trace.trace_id,
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