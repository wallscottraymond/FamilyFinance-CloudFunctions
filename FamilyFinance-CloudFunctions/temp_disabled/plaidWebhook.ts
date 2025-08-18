import { onRequest } from "firebase-functions/v2/https";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { Configuration, PlaidApi, PlaidEnvironments, TransactionsSyncRequest } from "plaid";
import { 
  PlaidWebhookType,
  PlaidWebhookCode,
  PlaidTransaction,
  PlaidItem,
  Transaction,
  TransactionType,
  TransactionCategory,
  TransactionStatus,
  FunctionResponse
} from "../../types";
import { 
  createErrorResponse, 
  createSuccessResponse
} from "../../utils/auth";
import { processPlaidWebhook } from "../../utils/plaidSync";
import { decryptAccessToken } from "../../utils/plaidSecurity";

/**
 * Plaid Configuration
 */
const PLAID_CLIENT_ID = "6439737b3f59d500139a7d13";
const PLAID_SECRET = "095fcb3d97498b9cddaf4b4f3d4056"; // Sandbox key
const PLAID_ENV = PlaidEnvironments.sandbox;

const configuration = new Configuration({
  basePath: PLAID_ENV,
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': PLAID_CLIENT_ID,
      'PLAID-SECRET': PLAID_SECRET,
    },
  },
});

const plaidClient = new PlaidApi(configuration);
const db = getFirestore();

/**
 * Plaid Webhook Handler for real-time transaction sync
 * Processes webhooks from Plaid and triggers transaction synchronization
 */
export const plaidWebhook = onRequest({
  region: "us-central1",
  memory: "512MiB",
  timeoutSeconds: 60,
  cors: false // Webhooks should not have CORS
}, async (request, response) => {
  // Only accept POST requests
  if (request.method !== "POST") {
    return response.status(405).json(
      createErrorResponse("method-not-allowed", "Only POST requests are allowed")
    );
  }

  try {
    // Get webhook signature from headers
    const signature = request.get('plaid-verification') || '';
    const webhookBody = JSON.stringify(request.body);

    console.log('Received Plaid webhook:', {
      signature: signature ? 'present' : 'missing',
      bodySize: webhookBody.length,
      webhook_type: request.body?.webhook_type,
      webhook_code: request.body?.webhook_code,
      item_id: request.body?.item_id
    });

    // Use Promise wrapping pattern as requested
    function processWebhookPromise(resolve: Function, reject: Function) {
      (async () => {
        try {
          // Process the webhook using existing utility
          const result = await processPlaidWebhook(webhookBody, signature);

          if (!result.success) {
            reject({
              success: false,
              error: {
                code: "webhook-processing-failed",
                message: result.error || "Failed to process webhook"
              }
            });
            return;
          }

          // If this is a transaction update webhook, perform additional sync
          if (request.body?.webhook_type === PlaidWebhookType.TRANSACTIONS) {
            const itemId = request.body?.item_id;
            
            if (itemId) {
              const syncResult = await syncTransactionsForItem(itemId);
              resolve({
                success: true,
                processed: true,
                webhookType: request.body.webhook_type,
                webhookCode: request.body.webhook_code,
                itemId: itemId,
                transactionsSync: syncResult
              });
            } else {
              resolve({
                success: true,
                processed: true,
                webhookType: request.body.webhook_type,
                webhookCode: request.body.webhook_code,
                message: "Webhook processed but no item_id for sync"
              });
            }
          } else {
            resolve({
              success: true,
              processed: true,
              webhookType: request.body.webhook_type,
              webhookCode: request.body.webhook_code,
              message: "Non-transaction webhook processed successfully"
            });
          }

        } catch (error: any) {
          console.error("Error in webhook processing:", error);
          reject({
            success: false,
            error: {
              code: "webhook-error",
              message: error.message || "Webhook processing failed"
            }
          });
        }
      })();
    }

    // Execute with Promise wrapper
    const result = await new Promise(processWebhookPromise);

    if (result.success) {
      return response.status(200).json(createSuccessResponse(result));
    } else {
      console.error("Webhook processing failed:", result.error);
      return response.status(400).json(result);
    }

  } catch (error: any) {
    console.error("Error in plaidWebhook:", error);
    return response.status(500).json(
      createErrorResponse("internal-error", "Failed to process webhook")
    );
  }
});

/**
 * Synchronizes transactions for a specific Plaid item
 * Called when transaction webhooks are received
 */
async function syncTransactionsForItem(itemId: string): Promise<any> {
  try {
    // Get the Plaid item from Firestore
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
      return { skipped: true, reason: 'Item is inactive' };
    }

    // Decrypt access token
    const encryptedAccessToken = JSON.parse(itemData.accessToken);
    const accessToken = decryptAccessToken(encryptedAccessToken);

    // Use cursor-based sync for efficient transaction retrieval
    const cursor = itemData.cursor || undefined;
    
    const syncRequest: TransactionsSyncRequest = {
      access_token: accessToken,
      cursor: cursor,
      count: 500 // Maximum transactions per request
    };

    const syncResponse = await plaidClient.transactionsSync(syncRequest);
    const { added, modified, removed, next_cursor, has_more } = syncResponse.data;

    console.log(`Transaction sync for item ${itemId}:`, {
      added: added.length,
      modified: modified.length,
      removed: removed.length,
      hasMore: has_more
    });

    let processedCount = 0;

    // Process added transactions
    for (const transaction of added) {
      await processPlaidTransaction(transaction, itemData, 'added');
      processedCount++;
    }

    // Process modified transactions
    for (const transaction of modified) {
      await processPlaidTransaction(transaction, itemData, 'modified');
      processedCount++;
    }

    // Process removed transactions
    for (const transactionId of removed) {
      await removeTransaction(transactionId);
      processedCount++;
    }

    // Update cursor and last synced timestamp
    await itemDoc.ref.update({
      cursor: next_cursor,
      lastSyncedAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    });

    return {
      itemId: itemId,
      transactionsAdded: added.length,
      transactionsModified: modified.length,
      transactionsRemoved: removed.length,
      totalProcessed: processedCount,
      hasMore: has_more,
      nextCursor: next_cursor
    };

  } catch (error: any) {
    console.error(`Error syncing transactions for item ${itemId}:`, error);
    throw error;
  }
}

/**
 * Processes a single Plaid transaction and stores/updates it in Firestore
 */
async function processPlaidTransaction(
  plaidTransaction: any,
  itemData: PlaidItem,
  operation: 'added' | 'modified'
): Promise<void> {
  try {
    // Check if transaction already exists
    const existingQuery = await db.collection('plaid_transactions')
      .where('transactionId', '==', plaidTransaction.transaction_id)
      .limit(1)
      .get();

    const transactionData: Omit<PlaidTransaction, 'id' | 'createdAt' | 'updatedAt'> = {
      transactionId: plaidTransaction.transaction_id,
      accountId: plaidTransaction.account_id,
      itemId: itemData.itemId,
      userId: itemData.userId,
      familyId: itemData.familyId,
      persistentTransactionId: plaidTransaction.persistent_transaction_id || undefined,
      amount: plaidTransaction.amount,
      isoCurrencyCode: plaidTransaction.iso_currency_code || undefined,
      unofficialCurrencyCode: plaidTransaction.unofficial_currency_code || undefined,
      category: plaidTransaction.category || [],
      categoryId: plaidTransaction.category_id || '',
      checkNumber: plaidTransaction.check_number || undefined,
      dateTransacted: Timestamp.fromDate(new Date(plaidTransaction.date)),
      datePosted: Timestamp.fromDate(new Date(plaidTransaction.date)), // Use same date if authorized_date not available
      location: plaidTransaction.location ? {
        address: plaidTransaction.location.address || undefined,
        city: plaidTransaction.location.city || undefined,
        region: plaidTransaction.location.region || undefined,
        postalCode: plaidTransaction.location.postal_code || undefined,
        country: plaidTransaction.location.country || undefined,
        lat: plaidTransaction.location.lat || undefined,
        lon: plaidTransaction.location.lon || undefined,
        storeNumber: plaidTransaction.location.store_number || undefined
      } : undefined,
      merchantName: plaidTransaction.merchant_name || undefined,
      merchantEntityId: plaidTransaction.merchant_entity_id || undefined,
      originalDescription: plaidTransaction.original_description || undefined,
      paymentMeta: {
        byOrderOf: plaidTransaction.payment_meta?.by_order_of || undefined,
        payee: plaidTransaction.payment_meta?.payee || undefined,
        payer: plaidTransaction.payment_meta?.payer || undefined,
        paymentMethod: plaidTransaction.payment_meta?.payment_method || undefined,
        paymentProcessor: plaidTransaction.payment_meta?.payment_processor || undefined,
        ppdId: plaidTransaction.payment_meta?.ppd_id || undefined,
        reason: plaidTransaction.payment_meta?.reason || undefined,
        referenceNumber: plaidTransaction.payment_meta?.reference_number || undefined
      },
      pending: plaidTransaction.pending || false,
      pendingTransactionId: plaidTransaction.pending_transaction_id || undefined,
      accountOwner: plaidTransaction.account_owner || undefined,
      authorizedDate: plaidTransaction.authorized_date ? 
        Timestamp.fromDate(new Date(plaidTransaction.authorized_date)) : undefined,
      authorizedDatetime: plaidTransaction.authorized_datetime ? 
        Timestamp.fromDate(new Date(plaidTransaction.authorized_datetime)) : undefined,
      datetime: plaidTransaction.datetime ? 
        Timestamp.fromDate(new Date(plaidTransaction.datetime)) : undefined,
      paymentChannel: plaidTransaction.payment_channel || 'other',
      personalFinanceCategory: plaidTransaction.personal_finance_category ? {
        primary: plaidTransaction.personal_finance_category.primary,
        detailed: plaidTransaction.personal_finance_category.detailed,
        confidenceLevel: plaidTransaction.personal_finance_category.confidence_level
      } : undefined,
      transactionCode: plaidTransaction.transaction_code || undefined,
      transactionType: plaidTransaction.transaction_type || undefined,
      
      // Family Finance specific fields
      isProcessed: false, // Will be processed into family transaction later
      familyTransactionId: undefined,
      isHidden: false,
      userCategory: mapToFamilyFinanceCategory(plaidTransaction.personal_finance_category?.detailed || plaidTransaction.category?.[0]),
      userNotes: undefined,
      tags: [],
      
      // Sync metadata
      lastSyncedAt: Timestamp.now(),
      syncVersion: 1
    };

    if (existingQuery.empty) {
      // Create new transaction
      await db.collection('plaid_transactions').add({
        ...transactionData,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      });
      
      // Create corresponding family finance transaction
      await createFamilyTransaction(transactionData, itemData);
    } else {
      // Update existing transaction
      const existingDoc = existingQuery.docs[0];
      await existingDoc.ref.update({
        ...transactionData,
        updatedAt: Timestamp.now(),
        syncVersion: existingDoc.data().syncVersion + 1
      });
      
      // Update corresponding family transaction if needed
      await updateFamilyTransaction(transactionData, itemData);
    }

  } catch (error: any) {
    console.error('Error processing Plaid transaction:', error);
    throw error;
  }
}

/**
 * Creates a family finance transaction from Plaid transaction data
 */
async function createFamilyTransaction(
  plaidTransactionData: Omit<PlaidTransaction, 'id' | 'createdAt' | 'updatedAt'>,
  itemData: PlaidItem
): Promise<void> {
  try {
    // Only create family transactions for non-pending transactions
    if (plaidTransactionData.pending) {
      return;
    }

    const familyTransaction: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'> = {
      userId: itemData.userId,
      familyId: itemData.familyId || '',
      amount: Math.abs(plaidTransactionData.amount), // Family Finance uses positive amounts
      currency: plaidTransactionData.isoCurrencyCode || 'USD',
      description: plaidTransactionData.merchantName || 
                   plaidTransactionData.originalDescription || 
                   'Bank Transaction',
      category: plaidTransactionData.userCategory || TransactionCategory.OTHER_EXPENSE,
      type: plaidTransactionData.amount > 0 ? TransactionType.EXPENSE : TransactionType.INCOME,
      date: plaidTransactionData.dateTransacted,
      location: plaidTransactionData.location ? {
        name: plaidTransactionData.merchantName || undefined,
        address: plaidTransactionData.location.address || undefined,
        latitude: plaidTransactionData.location.lat || undefined,
        longitude: plaidTransactionData.location.lon || undefined
      } : undefined,
      receiptUrl: undefined,
      tags: plaidTransactionData.tags,
      budgetId: undefined,
      recurringTransactionId: undefined,
      status: TransactionStatus.APPROVED, // Auto-approve bank transactions
      approvedBy: itemData.userId, // Auto-approved by the account owner
      approvedAt: Timestamp.now(),
      metadata: {
        source: 'plaid',
        plaidTransactionId: plaidTransactionData.transactionId,
        plaidAccountId: plaidTransactionData.accountId,
        plaidCategory: plaidTransactionData.category,
        plaidCategoryId: plaidTransactionData.categoryId,
        institutionName: itemData.institutionName,
        accountMask: '' // Could be fetched from account data
      }
    };

    const familyTransactionRef = await db.collection('transactions').add({
      ...familyTransaction,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    });

    // Update the Plaid transaction with the family transaction ID
    const plaidTransactionQuery = await db.collection('plaid_transactions')
      .where('transactionId', '==', plaidTransactionData.transactionId)
      .limit(1)
      .get();

    if (!plaidTransactionQuery.empty) {
      await plaidTransactionQuery.docs[0].ref.update({
        familyTransactionId: familyTransactionRef.id,
        isProcessed: true,
        updatedAt: Timestamp.now()
      });
    }

  } catch (error: any) {
    console.error('Error creating family transaction:', error);
    throw error;
  }
}

/**
 * Updates a family finance transaction from updated Plaid transaction data
 */
async function updateFamilyTransaction(
  plaidTransactionData: Omit<PlaidTransaction, 'id' | 'createdAt' | 'updatedAt'>,
  itemData: PlaidItem
): Promise<void> {
  try {
    // Find the corresponding family transaction
    const familyTransactionQuery = await db.collection('transactions')
      .where('metadata.plaidTransactionId', '==', plaidTransactionData.transactionId)
      .limit(1)
      .get();

    if (familyTransactionQuery.empty) {
      // If no family transaction exists and this is no longer pending, create one
      if (!plaidTransactionData.pending) {
        await createFamilyTransaction(plaidTransactionData, itemData);
      }
      return;
    }

    const familyTransactionDoc = familyTransactionQuery.docs[0];
    const familyTransactionData = familyTransactionDoc.data() as Transaction;

    // Update family transaction with new data
    const updates: Partial<Transaction> = {
      amount: Math.abs(plaidTransactionData.amount),
      description: plaidTransactionData.merchantName || 
                   plaidTransactionData.originalDescription || 
                   familyTransactionData.description,
      type: plaidTransactionData.amount > 0 ? TransactionType.EXPENSE : TransactionType.INCOME,
      date: plaidTransactionData.dateTransacted,
      updatedAt: Timestamp.now()
    };

    // Update location if available
    if (plaidTransactionData.location) {
      updates.location = {
        name: plaidTransactionData.merchantName || undefined,
        address: plaidTransactionData.location.address || undefined,
        latitude: plaidTransactionData.location.lat || undefined,
        longitude: plaidTransactionData.location.lon || undefined
      };
    }

    await familyTransactionDoc.ref.update(updates);

  } catch (error: any) {
    console.error('Error updating family transaction:', error);
    throw error;
  }
}

/**
 * Removes a transaction when it's been removed from Plaid
 */
async function removeTransaction(transactionId: string): Promise<void> {
  try {
    // Find and remove Plaid transaction
    const plaidTransactionQuery = await db.collection('plaid_transactions')
      .where('transactionId', '==', transactionId)
      .limit(1)
      .get();

    if (!plaidTransactionQuery.empty) {
      const plaidTransactionData = plaidTransactionQuery.docs[0].data() as PlaidTransaction;
      
      // Remove corresponding family transaction if it exists
      if (plaidTransactionData.familyTransactionId) {
        await db.collection('transactions')
          .doc(plaidTransactionData.familyTransactionId)
          .delete();
      }

      // Remove Plaid transaction
      await plaidTransactionQuery.docs[0].ref.delete();
    }

  } catch (error: any) {
    console.error('Error removing transaction:', error);
    throw error;
  }
}

/**
 * Maps Plaid category to Family Finance category
 */
function mapToFamilyFinanceCategory(plaidCategory?: string): TransactionCategory {
  if (!plaidCategory) {
    return TransactionCategory.OTHER_EXPENSE;
  }

  const category = plaidCategory.toLowerCase();
  
  // Map Plaid categories to Family Finance categories
  if (category.includes('food') || category.includes('restaurant') || category.includes('grocery')) {
    return TransactionCategory.FOOD;
  }
  if (category.includes('transport') || category.includes('gas') || category.includes('uber') || category.includes('taxi')) {
    return TransactionCategory.TRANSPORTATION;
  }
  if (category.includes('rent') || category.includes('mortgage') || category.includes('housing')) {
    return TransactionCategory.HOUSING;
  }
  if (category.includes('utilities') || category.includes('electric') || category.includes('water')) {
    return TransactionCategory.UTILITIES;
  }
  if (category.includes('medical') || category.includes('health') || category.includes('doctor')) {
    return TransactionCategory.HEALTHCARE;
  }
  if (category.includes('education') || category.includes('school') || category.includes('tuition')) {
    return TransactionCategory.EDUCATION;
  }
  if (category.includes('entertainment') || category.includes('movie') || category.includes('music')) {
    return TransactionCategory.ENTERTAINMENT;
  }
  if (category.includes('clothing') || category.includes('apparel')) {
    return TransactionCategory.CLOTHING;
  }
  if (category.includes('personal') || category.includes('beauty') || category.includes('salon')) {
    return TransactionCategory.PERSONAL_CARE;
  }
  if (category.includes('insurance')) {
    return TransactionCategory.INSURANCE;
  }
  if (category.includes('tax')) {
    return TransactionCategory.TAXES;
  }
  if (category.includes('charity') || category.includes('donation')) {
    return TransactionCategory.CHARITY;
  }
  if (category.includes('salary') || category.includes('payroll') || category.includes('income')) {
    return TransactionCategory.SALARY;
  }
  if (category.includes('transfer')) {
    return TransactionCategory.OTHER_INCOME; // Handle transfers as income for now
  }

  return TransactionCategory.OTHER_EXPENSE;
}