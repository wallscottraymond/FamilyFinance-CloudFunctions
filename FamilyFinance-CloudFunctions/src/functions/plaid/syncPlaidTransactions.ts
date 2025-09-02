/**
 * Manual Plaid Transaction Sync Function
 * 
 * Provides a callable Cloud Function for manually triggering Plaid transaction sync.
 * Creates transactions with proper splits structure and handles batch processing.
 * 
 * This function can be called from:
 * - Mobile app for user-initiated sync
 * - Admin interface for troubleshooting
 * - Scheduled jobs for regular sync
 * 
 * Memory: 512MiB, Timeout: 300s (5 minutes)
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { authMiddleware, UserRole } from '../../utils/auth';
import { queryDocuments } from '../../utils/firestore';
import { syncTransactions } from '../../utils/syncTransactions';
import { createPlaidClient } from '../../utils/plaidClient';
import { defineSecret } from 'firebase-functions/params';

// Define secrets for Plaid configuration
const plaidClientId = defineSecret('PLAID_CLIENT_ID');
const plaidSecret = defineSecret('PLAID_SECRET');

interface SyncPlaidTransactionsRequest {
  itemId?: string; // Optional: sync specific item only
  forceFullSync?: boolean; // Optional: sync all transactions regardless of processed status
  maxTransactions?: number; // Optional: limit number of transactions to sync
}

interface SyncPlaidTransactionsResponse {
  success: boolean;
  itemsSynced: number;
  transactionsAdded: number;
  transactionsUpdated: number;
  errors: string[];
  message: string;
}

/**
 * Manually sync Plaid transactions with splits support
 */
export const syncPlaidTransactions = onCall({
  region: 'us-central1',
  memory: '512MiB',
  timeoutSeconds: 300,
  secrets: [plaidClientId, plaidSecret],
}, async (request): Promise<SyncPlaidTransactionsResponse> => {
  try {
    // Authenticate user
    const authResult = await authMiddleware(request, UserRole.VIEWER);
    if (!authResult.success || !authResult.user) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { user } = authResult;
    const { itemId, forceFullSync = false, maxTransactions = 500 } = request.data as SyncPlaidTransactionsRequest;

    console.log(`🚀 Starting unified manual Plaid sync for user ${user.id}`, { itemId, forceFullSync, maxTransactions });

    // Create Plaid client
    const plaidClient = createPlaidClient(plaidClientId.value(), plaidSecret.value());

    // Get user's Plaid items from user subcollection (new structure)
    console.log(`📋 Fetching Plaid items for user ${user.id}`);
    let itemsQuery: any = {
      where: [
        { field: 'userId', operator: '==', value: user.id },
        { field: 'isActive', operator: '==', value: true }
      ]
    };

    if (itemId) {
      itemsQuery.where.push({ field: 'id', operator: '==', value: itemId });
    }

    const plaidItems = await queryDocuments(`users/${user.id}/plaidItems`, itemsQuery);

    if (plaidItems.length === 0) {
      console.log(`ℹ️ No active Plaid items found for user ${user.id}`);
      return {
        success: true,
        itemsSynced: 0,
        transactionsAdded: 0,
        transactionsUpdated: 0,
        errors: [],
        message: 'No active Plaid items found for user'
      };
    }

    console.log(`✅ Found ${plaidItems.length} Plaid items to sync`);

    let totalTransactionsProcessed = 0;
    let totalErrors: string[] = [];
    let itemsSynced = 0;
    let totalProcessingTimeMs = 0;

    // Process each Plaid item using unified sync function
    for (const plaidItem of plaidItems) {
      try {
        const item = plaidItem as any;
        console.log(`🔄 Syncing item: ${item.id} (${item.institutionName})`);
        
        // Use our new unified sync function
        const syncResult = await syncTransactions(
          plaidClient,
          item.id,
          item.accessToken,
          user.id!
        );

        totalTransactionsProcessed += syncResult.successfullyProcessed;
        totalErrors.push(...syncResult.errors);
        totalProcessingTimeMs += syncResult.processingTimeMs;
        
        if (syncResult.successfullyProcessed > 0) {
          itemsSynced++;
        }

        console.log(`✅ Item ${item.id} sync complete:`, {
          totalTransactions: syncResult.totalTransactions,
          successful: syncResult.successfullyProcessed,
          failed: syncResult.failed,
          errors: syncResult.errors.length,
          processingTimeMs: syncResult.processingTimeMs
        });

      } catch (error) {
        const item = plaidItem as any;
        const errorMessage = `❌ Error syncing item ${item.id}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        console.error(errorMessage);
        console.error('🔍 Item sync error details:', {
          itemId: item.id,
          institutionName: item.institutionName,
          error: error instanceof Error ? error.stack : error
        });
        totalErrors.push(errorMessage);
      }
    }

    const response: SyncPlaidTransactionsResponse = {
      success: totalErrors.length === 0,
      itemsSynced,
      transactionsAdded: totalTransactionsProcessed, // Using unified processing count
      transactionsUpdated: 0, // Unified sync doesn't distinguish between add/update
      errors: totalErrors,
      message: `🎯 Unified sync completed: ${totalTransactionsProcessed} transactions processed across ${itemsSynced} items (${totalProcessingTimeMs}ms)`
    };

    console.log('🎉 Manual unified Plaid sync completed:', response);
    return response;

  } catch (error) {
    console.error('Error in manual Plaid sync:', error);
    
    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError('internal', `Manual sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});

/**
 * Get sync status for user's Plaid items
 */
export const getPlaidSyncStatus = onCall({
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 30,
}, async (request) => {
  try {
    // Authenticate user
    const authResult = await authMiddleware(request, UserRole.VIEWER);
    if (!authResult.success || !authResult.user) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { user } = authResult;

    // Get user's Plaid items with sync status
    const plaidItems = await queryDocuments('plaid_items', {
      where: [
        { field: 'userId', operator: '==', value: user.id },
        { field: 'isActive', operator: '==', value: true }
      ]
    });

    const itemStatuses = [];

    for (const item of plaidItems) {
      // Count unprocessed transactions for this item
      const unprocessedCount = await queryDocuments('plaid_transactions', {
        where: [
          { field: 'itemId', operator: '==', value: (item as any).itemId },
          { field: 'userId', operator: '==', value: user.id },
          { field: 'isProcessed', operator: '==', value: false }
        ]
      });

      // Count total transactions for this item
      const totalCount = await queryDocuments('plaid_transactions', {
        where: [
          { field: 'itemId', operator: '==', value: (item as any).itemId },
          { field: 'userId', operator: '==', value: user.id }
        ]
      });

      itemStatuses.push({
        itemId: (item as any).itemId,
        institutionName: (item as any).institutionName,
        isActive: (item as any).isActive,
        lastSyncedAt: (item as any).lastSyncedAt,
        lastWebhookReceived: (item as any).lastWebhookReceived,
        totalTransactions: totalCount.length,
        unprocessedTransactions: unprocessedCount.length,
        syncProgress: totalCount.length > 0 ? 
          Math.round(((totalCount.length - unprocessedCount.length) / totalCount.length) * 100) : 100
      });
    }

    return {
      success: true,
      items: itemStatuses,
      totalItems: itemStatuses.length,
      totalUnprocessed: itemStatuses.reduce((sum, item) => sum + item.unprocessedTransactions, 0)
    };

  } catch (error) {
    console.error('Error getting Plaid sync status:', error);
    
    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError('internal', `Failed to get sync status: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});