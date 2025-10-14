/**
 * Plaid Webhook Testing Functions
 *
 * These functions trigger Plaid webhooks in the sandbox environment for testing purposes.
 * Based on Plaid's sandbox webhook endpoints:
 * - /sandbox/item/fire_webhook
 * - /sandbox/income/fire_webhook
 * - /sandbox/transfer/fire_webhook
 *
 * IMPORTANT NOTES:
 * - Sandbox items may not have webhooks configured, resulting in SANDBOX_WEBHOOK_INVALID errors
 * - ITEM_LOGIN_REQUIRED errors indicate items need re-authentication via Plaid Link update mode
 * - These functions are for development testing only and should not be used in production
 * - Webhook testing requires active Plaid items with valid access tokens
 *
 * Memory: 256MiB, Timeout: 30s
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { authenticateRequest, UserRole } from '../../../utils/auth';
import { db } from '../../../index';
import {
  PlaidApi,
  SandboxItemFireWebhookRequest,
  SandboxItemFireWebhookRequestWebhookCodeEnum
} from 'plaid';
import { createStandardPlaidClient } from '../../../utils/plaidClientFactory';

// Define secrets for Plaid configuration
const plaidClientId = defineSecret('PLAID_CLIENT_ID');
const plaidSecret = defineSecret('PLAID_SECRET');

// Use centralized Plaid client factory
function getPlaidClient(): PlaidApi {
  return createStandardPlaidClient();
}

/**
 * Helper function to find a Plaid item by itemId across different storage locations
 */
async function findPlaidItem(userId: string, itemId: string) {
  // Strategy 1: Try direct document lookup using itemId as document ID
  try {
    console.log(`🔍 Strategy 1: Looking for item ${itemId} as document ID in subcollection for user ${userId}`);
    const itemDoc = await db.collection('users')
      .doc(userId)
      .collection('plaidItems')
      .doc(itemId)
      .get();

    console.log(`🔍 Document exists: ${itemDoc.exists}`);
    if (itemDoc.exists) {
      const data = itemDoc.data();
      console.log(`🔍 Item data:`, {
        isActive: data?.isActive,
        institutionName: data?.institutionName,
        hasAccessToken: !!data?.accessToken,
        allFields: Object.keys(data || {})
      });

      // Check if item is active
      if (data?.isActive === false) {
        console.log(`⚠️ Item ${itemId} exists but is not active`);
        return null;
      }

      console.log(`✅ Found active item ${itemId} in subcollection for user ${userId}`);
      return itemDoc;
    } else {
      console.log(`❌ Item ${itemId} not found as document ID in subcollection`);
    }
  } catch (error) {
    console.log('❌ Subcollection document lookup failed:', error);
  }

  // Strategy 2: Query by itemId field in subcollection
  try {
    console.log(`🔍 Strategy 2: Searching by itemId field in subcollection`);
    const itemQuery = await db.collection('users')
      .doc(userId)
      .collection('plaidItems')
      .where('itemId', '==', itemId)
      .where('isActive', '==', true)
      .limit(1)
      .get();

    console.log(`🔍 Query by itemId field result: ${itemQuery.size} documents found`);
    if (!itemQuery.empty) {
      const itemDoc = itemQuery.docs[0];
      console.log(`✅ Found item ${itemId} by itemId field in subcollection for user ${userId}`);
      return itemDoc;
    }
  } catch (error) {
    console.log('❌ Subcollection itemId query failed:', error);
  }

  // Strategy 3: Query by plaidItemId field in subcollection
  try {
    console.log(`🔍 Strategy 3: Searching by plaidItemId field in subcollection`);
    const itemQuery = await db.collection('users')
      .doc(userId)
      .collection('plaidItems')
      .where('plaidItemId', '==', itemId)
      .where('isActive', '==', true)
      .limit(1)
      .get();

    console.log(`🔍 Query by plaidItemId field result: ${itemQuery.size} documents found`);
    if (!itemQuery.empty) {
      const itemDoc = itemQuery.docs[0];
      console.log(`✅ Found item ${itemId} by plaidItemId field in subcollection for user ${userId}`);
      return itemDoc;
    }
  } catch (error) {
    console.log('❌ Subcollection plaidItemId query failed:', error);
  }

  // Strategy 4: Direct lookup in top-level plaid_items collection using itemId as document ID
  try {
    console.log(`🔍 Strategy 4: Direct lookup in plaid_items collection`);
    const itemDoc = await db.collection('plaid_items')
      .doc(itemId)
      .get();

    console.log(`🔍 Document exists: ${itemDoc.exists}`);
    if (itemDoc.exists) {
      const data = itemDoc.data();
      console.log(`🔍 Item data:`, {
        userId: data?.userId,
        isActive: data?.isActive,
        institutionName: data?.institutionName,
        hasAccessToken: !!data?.accessToken,
        allFields: Object.keys(data || {})
      });

      // Verify this item belongs to the user
      if (data?.userId === userId) {
        console.log(`✅ Found item ${itemId} in plaid_items collection for user ${userId}`);
        return itemDoc;
      } else {
        console.log(`❌ Item ${itemId} exists but belongs to different user (expected: ${userId}, actual: ${data?.userId})`);
      }
    } else {
      console.log(`❌ Item ${itemId} not found as document ID in plaid_items collection`);
    }
  } catch (error) {
    console.log('❌ plaid_items document lookup failed:', error);
  }

  // Final attempt: List all items for this user to see what we actually have
  try {
    console.log(`🔍 Final debug: listing all plaidItems for user ${userId}...`);
    const allItemsQuery = await db.collection('users')
      .doc(userId)
      .collection('plaidItems')
      .get();

    console.log(`🔍 Total items found for user: ${allItemsQuery.size}`);
    allItemsQuery.docs.forEach((doc, index) => {
      const data = doc.data();
      console.log(`🔍 Item ${index + 1}: docId=${doc.id}, isActive=${data?.isActive}, institution=${data?.institutionName}`);
    });
  } catch (listError) {
    console.log(`❌ Error listing items for debug:`, listError);
  }

  console.log(`❌ Item ${itemId} not found anywhere for user ${userId}`);
  return null;
}

/**
 * Fire a transaction webhook for testing
 */
export const fireTransactionWebhook = onCall(
  {
    memory: '256MiB',
    timeoutSeconds: 30,
    secrets: [plaidClientId, plaidSecret],
  },
  async (request) => {
    // Declare variables outside try block so they're accessible in catch block
    let userId: string | undefined;
    let itemId: string | undefined;

    try {
      // Authenticate user (any authenticated user can test their own webhooks)
      const authResult = await authenticateRequest(request, UserRole.VIEWER);
      userId = authResult.user.uid;

      const requestData = request.data;
      itemId = requestData.itemId;
      const webhookCode = requestData.webhookCode;

      if (!itemId) {
        throw new HttpsError('invalid-argument', 'itemId is required');
      }

      // Validate webhook code
      const validCodes = [
        'SYNC_UPDATES_AVAILABLE',
        'HISTORICAL_UPDATE',
        'INITIAL_UPDATE',
        'DEFAULT_UPDATE',
        'TRANSACTIONS_REMOVED'
      ];

      if (!webhookCode || !validCodes.includes(webhookCode)) {
        throw new HttpsError('invalid-argument', `Invalid webhook code. Valid codes: ${validCodes.join(', ')}`);
      }

      // Get the access token for this item
      const itemDoc = await findPlaidItem(userId, itemId);

      if (!itemDoc) {
        // Add debug info to help diagnose the issue
        const debugInfo = {
          userId,
          itemId,
          searchPaths: [
            `users/${userId}/plaidItems/${itemId}`,
            `plaid_items where itemId=${itemId} and userId=${userId}`
          ]
        };
        throw new HttpsError('not-found', `Plaid item not found. Debug: ${JSON.stringify(debugInfo)}`);
      }

      const itemData = itemDoc.data();
      if (!itemData) {
        throw new HttpsError('not-found', 'Plaid item data not found');
      }

      // Note: In a real implementation, you would decrypt the access token
      const accessToken = itemData.accessToken;

      // Fire the webhook
      const client = getPlaidClient();
      const fireWebhookRequest: SandboxItemFireWebhookRequest = {
        access_token: accessToken,
        webhook_code: webhookCode as SandboxItemFireWebhookRequestWebhookCodeEnum,
      };

      const response = await client.sandboxItemFireWebhook(fireWebhookRequest);

      console.log(`Fired ${webhookCode} webhook for item ${itemId}:`, response.data);

      return {
        success: true,
        message: `Successfully fired ${webhookCode} webhook for item ${itemId}`,
        webhook_fired: true,
        webhook_code: webhookCode,
        item_id: itemId
      };

    } catch (error: any) {
      console.error('Error firing transaction webhook:', error);

      if (error instanceof HttpsError) {
        throw error;
      }

      // Check if this is a Plaid API error that requires re-authentication
      if (error.response?.data?.error_code) {
        const plaidError = error.response.data;

        // Delegate error handling to centralized handler
        if (itemId && userId) {
          console.log(`🔧 Delegating Plaid error handling for item ${itemId} to centralized handler`);
          // Import and call the handler directly (same runtime context)
          const { handlePlaidErrorInternal } = await import('../utils/plaidErrorHandler');
          // Fire-and-forget error handling - don't await to avoid delaying error response
          handlePlaidErrorInternal(itemId, userId, error, 'fire-transaction-webhook').catch(err =>
            console.error('Centralized error handler failed:', err)
          );
        }

        throw new HttpsError('failed-precondition',
          `Plaid API Error: ${plaidError.error_code} - ${plaidError.error_message}`);
      }

      throw new HttpsError('internal', error.message || 'Failed to fire webhook');
    }
  }
);

/**
 * Fire an income webhook for testing
 */
export const fireIncomeWebhook = onCall(
  {
    memory: '256MiB',
    timeoutSeconds: 30,
    secrets: [plaidClientId, plaidSecret],
  },
  async (request) => {
    try {
      // Authenticate user (any authenticated user can test their own webhooks)
      const authResult = await authenticateRequest(request, UserRole.VIEWER);
      const userId = authResult.user.uid;

      const { itemId, webhookCode } = request.data;

      if (!itemId) {
        throw new HttpsError('invalid-argument', 'itemId is required');
      }

      // Validate webhook code
      const validCodes = [
        'RECURRING_TRANSACTIONS_UPDATE',
        'SYNC_UPDATES_AVAILABLE'
      ];

      if (!webhookCode || !validCodes.includes(webhookCode)) {
        throw new HttpsError('invalid-argument', `Invalid webhook code. Valid codes: ${validCodes.join(', ')}`);
      }

      // Get the access token for this item
      const itemDoc = await findPlaidItem(userId, itemId);

      if (!itemDoc) {
        throw new HttpsError('not-found', 'Plaid item not found');
      }

      const itemData = itemDoc.data();
      if (!itemData) {
        throw new HttpsError('not-found', 'Plaid item data not found');
      }
      const accessToken = itemData.accessToken;

      // Fire the income webhook using the item webhook endpoint
      // (Plaid uses the same endpoint for recurring transactions)
      const client = getPlaidClient();
      const fireWebhookRequest: SandboxItemFireWebhookRequest = {
        access_token: accessToken,
        webhook_code: webhookCode as SandboxItemFireWebhookRequestWebhookCodeEnum,
      };

      const response = await client.sandboxItemFireWebhook(fireWebhookRequest);

      console.log(`Fired ${webhookCode} income webhook for item ${itemId}:`, response.data);

      return {
        success: true,
        message: `Successfully fired ${webhookCode} income webhook for item ${itemId}`,
        webhook_fired: true,
        webhook_code: webhookCode,
        item_id: itemId
      };

    } catch (error: any) {
      console.error('Error firing income webhook:', error);

      if (error instanceof HttpsError) {
        throw error;
      }

      // Check if this is a Plaid API error and provide more helpful message
      if (error.response?.data?.error_code) {
        const plaidError = error.response.data;
        throw new HttpsError('failed-precondition',
          `Plaid API Error: ${plaidError.error_code} - ${plaidError.error_message}`);
      }

      throw new HttpsError('internal', error.message || 'Failed to fire income webhook');
    }
  }
);

/**
 * Fire an item webhook for testing
 */
export const fireItemWebhook = onCall(
  {
    memory: '256MiB',
    timeoutSeconds: 30,
    secrets: [plaidClientId, plaidSecret],
  },
  async (request) => {
    try {
      // Authenticate user (any authenticated user can test their own webhooks)
      const authResult = await authenticateRequest(request, UserRole.VIEWER);
      const userId = authResult.user.uid;

      const { itemId, webhookCode } = request.data;

      if (!itemId) {
        throw new HttpsError('invalid-argument', 'itemId is required');
      }

      // Validate webhook code for item webhooks
      const validCodes = [
        'ERROR',
        'PENDING_EXPIRATION',
        'USER_PERMISSION_REVOKED',
        'NEW_ACCOUNTS_AVAILABLE'
      ];

      if (!webhookCode || !validCodes.includes(webhookCode)) {
        throw new HttpsError('invalid-argument', `Invalid webhook code. Valid codes: ${validCodes.join(', ')}`);
      }

      // Get the access token for this item
      const itemDoc = await findPlaidItem(userId, itemId);

      if (!itemDoc) {
        throw new HttpsError('not-found', 'Plaid item not found');
      }

      const itemData = itemDoc.data();
      if (!itemData) {
        throw new HttpsError('not-found', 'Plaid item data not found');
      }
      const accessToken = itemData.accessToken;

      // Fire the item webhook using the transaction webhook endpoint
      // (Plaid uses the same endpoint for item webhooks)
      const client = getPlaidClient();
      const fireWebhookRequest: SandboxItemFireWebhookRequest = {
        access_token: accessToken,
        webhook_code: webhookCode as SandboxItemFireWebhookRequestWebhookCodeEnum,
      };

      const response = await client.sandboxItemFireWebhook(fireWebhookRequest);

      console.log(`Fired ${webhookCode} item webhook for item ${itemId}:`, response.data);

      return {
        success: true,
        message: `Successfully fired ${webhookCode} item webhook for item ${itemId}`,
        webhook_fired: true,
        webhook_code: webhookCode,
        item_id: itemId
      };

    } catch (error: any) {
      console.error('Error firing item webhook:', error);

      if (error instanceof HttpsError) {
        throw error;
      }

      // Check if this is a Plaid API error and provide more helpful message
      if (error.response?.data?.error_code) {
        const plaidError = error.response.data;
        throw new HttpsError('failed-precondition',
          `Plaid API Error: ${plaidError.error_code} - ${plaidError.error_message}`);
      }

      throw new HttpsError('internal', error.message || 'Failed to fire item webhook');
    }
  }
);

/**
 * Get user's Plaid items for webhook testing
 */
export const getUserPlaidItems = onCall(
  {
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (request) => {
    try {
      // Authenticate user
      const authResult = await authenticateRequest(request, UserRole.VIEWER);
      const userId = authResult.user.uid;

      // Get user's Plaid items - try subcollection first (matches mobile app)
      let itemsQuery;
      try {
        // First try the subcollection approach (same as mobile app)
        itemsQuery = await db.collection('users')
          .doc(userId)
          .collection('plaidItems')
          .where('isActive', '==', true)
          .get();

        console.log(`Found ${itemsQuery.size} items in subcollection for user ${userId}`);
      } catch (error) {
        console.log('Subcollection query failed, trying top-level collection:', error);
      }

      // If no items found in subcollection, try top-level collection
      if (!itemsQuery || itemsQuery.empty) {
        itemsQuery = await db.collection('plaid_items')
          .where('userId', '==', userId)
          .where('isActive', '==', true)
          .get();

        console.log(`Found ${itemsQuery.size} items in top-level collection for user ${userId}`);
      }

      const items = itemsQuery.docs.map(doc => {
        const data = doc.data();
        console.log(`🔍 Processing Plaid item ${doc.id}:`, {
          itemId: data.itemId,
          institutionName: data.institutionName,
          hasAccounts: !!data.accounts,
          accountsLength: data.accounts?.length || 0,
          accountsData: data.accounts,
          allFields: Object.keys(data)
        });

        // Use itemId field if it exists, otherwise fall back to document ID
        const actualItemId = data.itemId || doc.id;

        return {
          id: doc.id,
          itemId: actualItemId,
          institutionName: data.institutionName,
          institutionId: data.institutionId,
          accounts: data.accounts || [],
          status: data.status || 'ACTIVE',
          lastSyncedAt: data.lastSyncedAt
        };
      });

      return {
        success: true,
        items,
        count: items.length
      };

    } catch (error: any) {
      console.error('Error getting user Plaid items:', error);

      if (error instanceof HttpsError) {
        throw error;
      }

      throw new HttpsError('internal', error.message || 'Failed to get Plaid items');
    }
  }
);

