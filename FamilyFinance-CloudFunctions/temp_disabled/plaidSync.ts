import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { 
  PlaidTransaction, 
  PlaidAccount, 
  PlaidItem, 
  PlaidWebhook,
  PlaidWebhookType,
  PlaidWebhookCode,
  PlaidWebhookProcessingStatus,
  PlaidTransactionSyncResponse
} from '../types';
import { decryptAccessToken, verifyWebhookSignature } from './plaidSecurity';

/**
 * Plaid Synchronization Utilities
 * 
 * Handles real-time webhook processing and transaction synchronization
 * Manages data consistency and handles Plaid API interactions
 */

const db = getFirestore();

/**
 * Webhook processing result
 */
interface WebhookProcessingResult {
  success: boolean;
  processed: boolean;
  error?: string;
  transactionsAffected?: number;
  accountsAffected?: number;
}

/**
 * Transaction sync options
 */
interface SyncOptions {
  itemId?: string;
  accountId?: string;
  userId?: string;
  startDate?: Date;
  endDate?: Date;
  maxDays?: number;
  forceFullSync?: boolean;
}

/**
 * Processes an incoming Plaid webhook
 * 
 * @param webhookBody - Raw webhook body
 * @param signature - Webhook signature for verification
 * @returns Processing result
 */
export async function processPlaidWebhook(
  webhookBody: string,
  signature: string
): Promise<WebhookProcessingResult> {
  try {
    // Verify webhook signature
    const verification = verifyWebhookSignature(webhookBody, signature);
    if (!verification.isValid) {
      console.error('Invalid webhook signature:', verification.error);
      return {
        success: false,
        processed: false,
        error: verification.error
      };
    }

    // Parse webhook payload
    let payload: any;
    try {
      payload = JSON.parse(webhookBody);
    } catch (error) {
      console.error('Invalid webhook JSON:', error);
      return {
        success: false,
        processed: false,
        error: 'Invalid webhook JSON'
      };
    }

    // Create webhook record for tracking
    const webhookRecord: Omit<PlaidWebhook, 'id' | 'createdAt' | 'updatedAt'> = {
      webhookType: payload.webhook_type,
      webhookCode: payload.webhook_code,
      itemId: payload.item_id || null,
      environmentId: payload.environment || 'unknown',
      requestId: payload.request_id || '',
      payload: payload,
      processingStatus: PlaidWebhookProcessingStatus.PENDING,
      retryCount: 0,
      signature: signature,
      isValid: true
    };

    const webhookRef = await db.collection('plaid_webhooks').add({
      ...webhookRecord,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    });

    // Mark webhook as processing
    await webhookRef.update({
      processingStatus: PlaidWebhookProcessingStatus.PROCESSING,
      updatedAt: Timestamp.now()
    });

    let result: WebhookProcessingResult;

    try {
      // Process webhook based on type and code
      switch (payload.webhook_type) {
        case PlaidWebhookType.TRANSACTIONS:
          result = await processTransactionWebhook(payload);
          break;
        
        case PlaidWebhookType.ITEM:
          result = await processItemWebhook(payload);
          break;
        
        default:
          console.log(`Unhandled webhook type: ${payload.webhook_type}`);
          result = {
            success: true,
            processed: false,
            error: `Unhandled webhook type: ${payload.webhook_type}`
          };
      }

      // Update webhook record with result
      await webhookRef.update({
        processingStatus: result.success ? 
          PlaidWebhookProcessingStatus.COMPLETED : 
          PlaidWebhookProcessingStatus.FAILED,
        processedAt: result.success ? Timestamp.now() : null,
        processingError: result.error || null,
        updatedAt: Timestamp.now()
      });

      return result;

    } catch (error) {
      console.error('Error processing webhook:', error);
      
      // Update webhook record with error
      await webhookRef.update({
        processingStatus: PlaidWebhookProcessingStatus.FAILED,
        processingError: error.message,
        retryCount: FieldValue.increment(1),
        updatedAt: Timestamp.now()
      });

      return {
        success: false,
        processed: false,
        error: error.message
      };
    }

  } catch (error) {
    console.error('Error in webhook processing:', error);
    return {
      success: false,
      processed: false,
      error: error.message
    };
  }
}

/**
 * Processes transaction-related webhooks
 * 
 * @param payload - Webhook payload
 * @returns Processing result
 */
async function processTransactionWebhook(payload: any): Promise<WebhookProcessingResult> {
  const itemId = payload.item_id;
  
  if (!itemId) {
    throw new Error('Missing item_id in transaction webhook');
  }

  switch (payload.webhook_code) {
    case PlaidWebhookCode.SYNC_UPDATES_AVAILABLE:
    case PlaidWebhookCode.DEFAULT_UPDATE:
    case PlaidWebhookCode.INITIAL_UPDATE:
    case PlaidWebhookCode.HISTORICAL_UPDATE:
      return await syncTransactionsForItem(itemId);
    
    case PlaidWebhookCode.TRANSACTIONS_REMOVED:
      return await handleRemovedTransactions(payload);
    
    default:
      console.log(`Unhandled transaction webhook code: ${payload.webhook_code}`);
      return {
        success: true,
        processed: false,
        error: `Unhandled transaction webhook code: ${payload.webhook_code}`
      };
  }
}

/**
 * Processes item-related webhooks
 * 
 * @param payload - Webhook payload
 * @returns Processing result
 */
async function processItemWebhook(payload: any): Promise<WebhookProcessingResult> {
  const itemId = payload.item_id;
  
  if (!itemId) {
    throw new Error('Missing item_id in item webhook');
  }

  switch (payload.webhook_code) {
    case PlaidWebhookCode.ERROR:
      return await handleItemError(itemId, payload.error);
    
    case PlaidWebhookCode.PENDING_EXPIRATION:
      return await handleItemPendingExpiration(itemId);
    
    case PlaidWebhookCode.USER_PERMISSION_REVOKED:
      return await handleUserPermissionRevoked(itemId);
    
    case PlaidWebhookCode.NEW_ACCOUNTS_AVAILABLE:
      return await handleNewAccountsAvailable(itemId);
    
    default:
      console.log(`Unhandled item webhook code: ${payload.webhook_code}`);
      return {
        success: true,
        processed: false,
        error: `Unhandled item webhook code: ${payload.webhook_code}`
      };
  }
}

/**
 * Synchronizes transactions for a specific Plaid item
 * 
 * @param itemId - Plaid item ID
 * @returns Processing result
 */
async function syncTransactionsForItem(itemId: string): Promise<WebhookProcessingResult> {
  try {
    // Get item document
    const itemQuery = await db.collection('plaid_items')
      .where('itemId', '==', itemId)
      .limit(1)
      .get();

    if (itemQuery.empty) {
      throw new Error(`Plaid item not found: ${itemId}`);
    }

    const itemDoc = itemQuery.docs[0];
    const itemData = itemDoc.data() as PlaidItem;

    if (!itemData.isActive) {
      console.log(`Skipping sync for inactive item: ${itemId}`);
      return {
        success: true,
        processed: false,
        error: 'Item is inactive'
      };
    }

    // Update last webhook received timestamp
    await itemDoc.ref.update({
      lastWebhookReceived: Timestamp.now(),
      updatedAt: Timestamp.now()
    });

    // Perform transaction sync
    const syncResult = await syncTransactionsForUser(itemData.userId, { itemId });

    return {
      success: true,
      processed: true,
      transactionsAffected: syncResult.transactionsAdded + syncResult.transactionsModified
    };

  } catch (error) {
    console.error(`Error syncing transactions for item ${itemId}:`, error);
    throw error;
  }
}

/**
 * Handles removed transactions webhook
 * 
 * @param payload - Webhook payload
 * @returns Processing result
 */
async function handleRemovedTransactions(payload: any): Promise<WebhookProcessingResult> {
  try {
    const removedTransactions = payload.removed_transactions || [];
    let removedCount = 0;

    for (const transactionId of removedTransactions) {
      const transactionQuery = await db.collection('plaid_transactions')
        .where('transactionId', '==', transactionId)
        .limit(1)
        .get();

      if (!transactionQuery.empty) {
        await transactionQuery.docs[0].ref.delete();
        removedCount++;
      }
    }

    return {
      success: true,
      processed: true,
      transactionsAffected: removedCount
    };

  } catch (error) {
    console.error('Error handling removed transactions:', error);
    throw error;
  }
}

/**
 * Handles item error webhook
 * 
 * @param itemId - Plaid item ID
 * @param error - Error details from webhook
 * @returns Processing result
 */
async function handleItemError(itemId: string, error: any): Promise<WebhookProcessingResult> {
  try {
    const itemQuery = await db.collection('plaid_items')
      .where('itemId', '==', itemId)
      .limit(1)
      .get();

    if (itemQuery.empty) {
      throw new Error(`Plaid item not found: ${itemId}`);
    }

    const itemDoc = itemQuery.docs[0];

    await itemDoc.ref.update({
      status: 'ERROR',
      error: {
        errorType: error.error_type,
        errorCode: error.error_code,
        displayMessage: error.display_message,
        lastOccurredAt: Timestamp.now(),
        retryCount: 0
      },
      updatedAt: Timestamp.now()
    });

    return {
      success: true,
      processed: true
    };

  } catch (error) {
    console.error(`Error handling item error for ${itemId}:`, error);
    throw error;
  }
}

/**
 * Handles item pending expiration webhook
 * 
 * @param itemId - Plaid item ID
 * @returns Processing result
 */
async function handleItemPendingExpiration(itemId: string): Promise<WebhookProcessingResult> {
  try {
    const itemQuery = await db.collection('plaid_items')
      .where('itemId', '==', itemId)
      .limit(1)
      .get();

    if (itemQuery.empty) {
      throw new Error(`Plaid item not found: ${itemId}`);
    }

    const itemDoc = itemQuery.docs[0];

    await itemDoc.ref.update({
      status: 'PENDING_EXPIRATION',
      updatedAt: Timestamp.now()
    });

    return {
      success: true,
      processed: true
    };

  } catch (error) {
    console.error(`Error handling pending expiration for ${itemId}:`, error);
    throw error;
  }
}

/**
 * Handles user permission revoked webhook
 * 
 * @param itemId - Plaid item ID
 * @returns Processing result
 */
async function handleUserPermissionRevoked(itemId: string): Promise<WebhookProcessingResult> {
  try {
    const itemQuery = await db.collection('plaid_items')
      .where('itemId', '==', itemId)
      .limit(1)
      .get();

    if (itemQuery.empty) {
      throw new Error(`Plaid item not found: ${itemId}`);
    }

    const itemDoc = itemQuery.docs[0];

    await itemDoc.ref.update({
      status: 'EXPIRED',
      isActive: false,
      updatedAt: Timestamp.now()
    });

    return {
      success: true,
      processed: true
    };

  } catch (error) {
    console.error(`Error handling permission revoked for ${itemId}:`, error);
    throw error;
  }
}

/**
 * Handles new accounts available webhook
 * 
 * @param itemId - Plaid item ID
 * @returns Processing result
 */
async function handleNewAccountsAvailable(itemId: string): Promise<WebhookProcessingResult> {
  try {
    // This would trigger a re-sync of accounts for the item
    // Implementation depends on Plaid client setup
    console.log(`New accounts available for item: ${itemId}`);
    
    return {
      success: true,
      processed: true
    };

  } catch (error) {
    console.error(`Error handling new accounts for ${itemId}:`, error);
    throw error;
  }
}

/**
 * Synchronizes transactions for a user with various filtering options
 * 
 * @param userId - User ID
 * @param options - Sync options
 * @returns Sync response with statistics
 */
export async function syncTransactionsForUser(
  userId: string,
  options: SyncOptions = {}
): Promise<PlaidTransactionSyncResponse> {
  try {
    const {
      itemId,
      accountId,
      startDate,
      endDate,
      maxDays = 90,
      forceFullSync = false
    } = options;

    // Get user's Plaid items
    let itemsQuery = db.collection('plaid_items')
      .where('userId', '==', userId)
      .where('isActive', '==', true);

    if (itemId) {
      itemsQuery = itemsQuery.where('itemId', '==', itemId);
    }

    const itemsSnapshot = await itemsQuery.get();

    if (itemsSnapshot.empty) {
      return {
        itemId: itemId || '',
        accountsCount: 0,
        transactionsAdded: 0,
        transactionsModified: 0,
        transactionsRemoved: 0,
        hasMore: false
      };
    }

    let totalTransactionsAdded = 0;
    let totalTransactionsModified = 0;
    let totalAccountsCount = 0;

    // Process each item
    for (const itemDoc of itemsSnapshot.docs) {
      const itemData = itemDoc.data() as PlaidItem;
      
      // Get accounts for this item
      let accountsQuery = db.collection('plaid_accounts')
        .where('itemId', '==', itemData.itemId)
        .where('isActive', '==', true)
        .where('isSyncEnabled', '==', true);

      if (accountId) {
        accountsQuery = accountsQuery.where('accountId', '==', accountId);
      }

      const accountsSnapshot = await accountsQuery.get();
      totalAccountsCount += accountsSnapshot.size;

      // Here you would integrate with the actual Plaid API
      // This is a placeholder for the integration
      console.log(`Syncing transactions for item: ${itemData.itemId}`);
      
      // Update item's last sync timestamp
      await itemDoc.ref.update({
        lastSyncedAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      });
    }

    return {
      itemId: itemId || '',
      accountsCount: totalAccountsCount,
      transactionsAdded: totalTransactionsAdded,
      transactionsModified: totalTransactionsModified,
      transactionsRemoved: 0,
      hasMore: false
    };

  } catch (error) {
    console.error('Error syncing transactions:', error);
    throw error;
  }
}

/**
 * Gets the sync status for a user's Plaid items
 * 
 * @param userId - User ID
 * @returns Array of item sync statuses
 */
export async function getUserSyncStatus(userId: string): Promise<any[]> {
  try {
    const itemsSnapshot = await db.collection('plaid_items')
      .where('userId', '==', userId)
      .where('isActive', '==', true)
      .get();

    const statuses = [];

    for (const itemDoc of itemsSnapshot.docs) {
      const itemData = itemDoc.data() as PlaidItem;
      
      // Get account count
      const accountsSnapshot = await db.collection('plaid_accounts')
        .where('itemId', '==', itemData.itemId)
        .where('isActive', '==', true)
        .get();

      // Get recent transactions count
      const recentTransactionsSnapshot = await db.collection('plaid_transactions')
        .where('itemId', '==', itemData.itemId)
        .where('dateTransacted', '>=', Timestamp.fromDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)))
        .get();

      statuses.push({
        itemId: itemData.itemId,
        institutionName: itemData.institutionName,
        status: itemData.status,
        accountsCount: accountsSnapshot.size,
        recentTransactionsCount: recentTransactionsSnapshot.size,
        lastSyncedAt: itemData.lastSyncedAt,
        lastWebhookReceived: itemData.lastWebhookReceived,
        error: itemData.error
      });
    }

    return statuses;

  } catch (error) {
    console.error('Error getting sync status:', error);
    throw error;
  }
}

/**
 * Retry failed webhook processing
 * 
 * @param webhookId - Webhook document ID
 * @returns Processing result
 */
export async function retryWebhookProcessing(webhookId: string): Promise<WebhookProcessingResult> {
  try {
    const webhookDoc = await db.collection('plaid_webhooks').doc(webhookId).get();
    
    if (!webhookDoc.exists) {
      throw new Error('Webhook not found');
    }

    const webhookData = webhookDoc.data() as PlaidWebhook;
    
    if (webhookData.processingStatus === PlaidWebhookProcessingStatus.COMPLETED) {
      return {
        success: true,
        processed: false,
        error: 'Webhook already processed'
      };
    }

    // Increment retry count
    await webhookDoc.ref.update({
      retryCount: FieldValue.increment(1),
      processingStatus: PlaidWebhookProcessingStatus.PROCESSING,
      updatedAt: Timestamp.now()
    });

    // Re-process the webhook
    return await processPlaidWebhook(
      JSON.stringify(webhookData.payload),
      webhookData.signature
    );

  } catch (error) {
    console.error('Error retrying webhook processing:', error);
    throw error;
  }
}

/**
 * Clean up old webhook records
 * 
 * @param olderThanDays - Delete webhooks older than this many days
 * @returns Number of webhooks deleted
 */
export async function cleanupWebhookRecords(olderThanDays: number = 30): Promise<number> {
  try {
    const cutoffDate = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    
    const oldWebhooksSnapshot = await db.collection('plaid_webhooks')
      .where('createdAt', '<', Timestamp.fromDate(cutoffDate))
      .get();

    let deletedCount = 0;
    const batch = db.batch();

    oldWebhooksSnapshot.docs.forEach(doc => {
      batch.delete(doc.ref);
      deletedCount++;
    });

    if (deletedCount > 0) {
      await batch.commit();
    }

    return deletedCount;

  } catch (error) {
    console.error('Error cleaning up webhook records:', error);
    throw error;
  }
}