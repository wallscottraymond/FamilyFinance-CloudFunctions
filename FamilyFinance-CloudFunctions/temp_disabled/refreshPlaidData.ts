import { onRequest } from "firebase-functions/v2/https";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { Configuration, PlaidApi, PlaidEnvironments, TransactionsSyncRequest, AccountsGetRequest } from "plaid";
import { 
  UserRole,
  PlaidItem,
  PlaidAccount,
  PlaidTransaction,
  Transaction,
  TransactionType,
  TransactionCategory,
  TransactionStatus,
  FunctionResponse
} from "../../types";
import { 
  authMiddleware, 
  createErrorResponse, 
  createSuccessResponse
} from "../../utils/auth";
import { firebaseCors } from "../../middleware/cors";
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
 * Manual refresh of Plaid account and transaction data
 * Allows users to manually trigger a sync of their banking data
 */
export const refreshPlaidData = onRequest({
  region: "us-central1",
  memory: "1GiB",
  timeoutSeconds: 120,
  cors: true
}, async (request, response) => {
  return firebaseCors(request, response, async () => {
    if (request.method !== "POST") {
      return response.status(405).json(
        createErrorResponse("method-not-allowed", "Only POST requests are allowed")
      );
    }

    try {
      // Authenticate user
      const authResult = await authMiddleware(request, UserRole.EDITOR);
      if (!authResult.success || !authResult.user) {
        return response.status(401).json(authResult.error);
      }

      const { user } = authResult;

      // Optional parameters from request body
      const { 
        itemId, 
        accountId, 
        refreshAccounts = true, 
        refreshTransactions = true,
        daysPast = 30,
        forceFullSync = false 
      } = request.body;

      // Use Promise wrapping pattern as requested
      function refreshDataProcess(resolve: Function, reject: Function) {
        (async () => {
          try {
            // Get user's Plaid items
            let itemsQuery = db.collection('plaid_items')
              .where('userId', '==', user.id!)
              .where('isActive', '==', true);

            if (itemId) {
              itemsQuery = itemsQuery.where('itemId', '==', itemId);
            }

            const itemsSnapshot = await itemsQuery.get();

            if (itemsSnapshot.empty) {
              reject({
                success: false,
                error: {
                  code: "no-accounts",
                  message: "No active Plaid accounts found for this user"
                }
              });
              return;
            }

            const refreshResults = [];

            // Process each Plaid item
            for (const itemDoc of itemsSnapshot.docs) {
              const itemData = itemDoc.data() as PlaidItem;

              try {
                // Decrypt access token
                const encryptedAccessToken = JSON.parse(itemData.accessToken);
                const accessToken = decryptAccessToken(encryptedAccessToken);

                const itemResult = {
                  itemId: itemData.itemId,
                  institutionName: itemData.institutionName,
                  accounts: {
                    refreshed: false,
                    count: 0,
                    errors: [] as string[]
                  },
                  transactions: {
                    refreshed: false,
                    added: 0,
                    modified: 0,
                    removed: 0,
                    errors: [] as string[]
                  }
                };

                // Refresh account data if requested
                if (refreshAccounts) {
                  try {
                    const accountsResult = await refreshAccountsForItem(
                      itemData,
                      accessToken,
                      accountId
                    );
                    
                    itemResult.accounts = {
                      refreshed: true,
                      count: accountsResult.accountsUpdated,
                      errors: accountsResult.errors || []
                    };
                  } catch (error: any) {
                    console.error(`Error refreshing accounts for item ${itemData.itemId}:`, error);
                    itemResult.accounts.errors.push(error.message);
                  }
                }

                // Refresh transaction data if requested
                if (refreshTransactions) {
                  try {
                    const transactionResult = await refreshTransactionsForItem(
                      itemData,
                      accessToken,
                      daysPast,
                      forceFullSync,
                      accountId
                    );
                    
                    itemResult.transactions = {
                      refreshed: true,
                      added: transactionResult.transactionsAdded,
                      modified: transactionResult.transactionsModified,
                      removed: transactionResult.transactionsRemoved,
                      errors: transactionResult.errors || []
                    };
                  } catch (error: any) {
                    console.error(`Error refreshing transactions for item ${itemData.itemId}:`, error);
                    itemResult.transactions.errors.push(error.message);
                  }
                }

                // Update item's last synced timestamp
                await itemDoc.ref.update({
                  lastSyncedAt: Timestamp.now(),
                  updatedAt: Timestamp.now()
                });

                refreshResults.push(itemResult);

              } catch (error: any) {
                console.error(`Error processing item ${itemData.itemId}:`, error);
                refreshResults.push({
                  itemId: itemData.itemId,
                  institutionName: itemData.institutionName,
                  error: error.message,
                  accounts: { refreshed: false, count: 0, errors: [error.message] },
                  transactions: { refreshed: false, added: 0, modified: 0, removed: 0, errors: [error.message] }
                });
              }
            }

            // Calculate summary statistics
            const summary = {
              itemsProcessed: refreshResults.length,
              totalAccountsRefreshed: refreshResults.reduce((sum, r) => sum + r.accounts.count, 0),
              totalTransactionsAdded: refreshResults.reduce((sum, r) => sum + r.transactions.added, 0),
              totalTransactionsModified: refreshResults.reduce((sum, r) => sum + r.transactions.modified, 0),
              totalTransactionsRemoved: refreshResults.reduce((sum, r) => sum + r.transactions.removed, 0),
              errors: refreshResults.flatMap(r => [...r.accounts.errors, ...r.transactions.errors])
            };

            resolve({
              success: true,
              summary: summary,
              items: refreshResults,
              refreshedAt: new Date().toISOString()
            });

          } catch (error: any) {
            console.error("Error in refresh data process:", error);
            reject({
              success: false,
              error: {
                code: "refresh-failed",
                message: error.message || "Failed to refresh Plaid data"
              }
            });
          }
        })();
      }

      // Execute with Promise wrapper
      const result = await new Promise(refreshDataProcess);

      if (result.success) {
        return response.status(200).json(createSuccessResponse(result));
      } else {
        return response.status(400).json(result);
      }

    } catch (error: any) {
      console.error("Error in refreshPlaidData:", error);
      return response.status(500).json(
        createErrorResponse("internal-error", "Failed to refresh Plaid data")
      );
    }
  });
});

/**
 * Refreshes account data for a specific Plaid item
 */
async function refreshAccountsForItem(
  itemData: PlaidItem,
  accessToken: string,
  specificAccountId?: string
): Promise<{ accountsUpdated: number; errors?: string[] }> {
  try {
    const accountsRequest: AccountsGetRequest = {
      access_token: accessToken,
    };

    const accountsResponse = await plaidClient.accountsGet(accountsRequest);
    const plaidAccounts = accountsResponse.data.accounts;

    let accountsUpdated = 0;
    const errors: string[] = [];

    for (const account of plaidAccounts) {
      // Skip if specific account requested and this isn't it
      if (specificAccountId && account.account_id !== specificAccountId) {
        continue;
      }

      try {
        // Find existing account in Firestore
        const accountQuery = await db.collection('plaid_accounts')
          .where('accountId', '==', account.account_id)
          .where('itemId', '==', itemData.itemId)
          .limit(1)
          .get();

        if (!accountQuery.empty) {
          // Update existing account
          const accountDoc = accountQuery.docs[0];
          await accountDoc.ref.update({
            name: account.name,
            mask: account.mask || null,
            officialName: account.official_name || null,
            balances: {
              available: account.balances.available,
              current: account.balances.current,
              limit: account.balances.limit || null,
              isoCurrencyCode: account.balances.iso_currency_code || null,
              unofficialCurrencyCode: account.balances.unofficial_currency_code || null,
              lastUpdated: Timestamp.now()
            },
            'metadata.lastBalanceUpdate': Timestamp.now(),
            updatedAt: Timestamp.now()
          });

          accountsUpdated++;
        } else {
          console.log(`Account ${account.account_id} not found in Firestore for item ${itemData.itemId}`);
        }
      } catch (error: any) {
        console.error(`Error updating account ${account.account_id}:`, error);
        errors.push(`Account ${account.mask || account.account_id}: ${error.message}`);
      }
    }

    return { accountsUpdated, errors: errors.length > 0 ? errors : undefined };

  } catch (error: any) {
    console.error('Error refreshing accounts:', error);
    throw error;
  }
}

/**
 * Refreshes transaction data for a specific Plaid item
 */
async function refreshTransactionsForItem(
  itemData: PlaidItem,
  accessToken: string,
  daysPast: number = 30,
  forceFullSync: boolean = false,
  specificAccountId?: string
): Promise<{
  transactionsAdded: number;
  transactionsModified: number;
  transactionsRemoved: number;
  errors?: string[];
}> {
  try {
    let transactionsAdded = 0;
    let transactionsModified = 0;
    let transactionsRemoved = 0;
    const errors: string[] = [];

    // Use cursor-based sync for efficiency unless forcing full sync
    let cursor = forceFullSync ? undefined : itemData.cursor;
    let hasMore = true;

    while (hasMore) {
      const syncRequest: TransactionsSyncRequest = {
        access_token: accessToken,
        cursor: cursor,
        count: 500 // Maximum transactions per request
      };

      const syncResponse = await plaidClient.transactionsSync(syncRequest);
      const { added, modified, removed, next_cursor } = syncResponse.data;
      hasMore = syncResponse.data.has_more;

      // Filter transactions by account if specified
      const filteredAdded = specificAccountId ? 
        added.filter(t => t.account_id === specificAccountId) : added;
      const filteredModified = specificAccountId ? 
        modified.filter(t => t.account_id === specificAccountId) : modified;

      // Process added transactions
      for (const transaction of filteredAdded) {
        try {
          await processPlaidTransaction(transaction, itemData, 'added');
          transactionsAdded++;
        } catch (error: any) {
          console.error(`Error processing added transaction ${transaction.transaction_id}:`, error);
          errors.push(`Added transaction ${transaction.transaction_id}: ${error.message}`);
        }
      }

      // Process modified transactions
      for (const transaction of filteredModified) {
        try {
          await processPlaidTransaction(transaction, itemData, 'modified');
          transactionsModified++;
        } catch (error: any) {
          console.error(`Error processing modified transaction ${transaction.transaction_id}:`, error);
          errors.push(`Modified transaction ${transaction.transaction_id}: ${error.message}`);
        }
      }

      // Process removed transactions
      for (const transactionId of removed) {
        try {
          // Only process if not filtering by account, or if we can't determine the account
          await removeTransaction(transactionId);
          transactionsRemoved++;
        } catch (error: any) {
          console.error(`Error removing transaction ${transactionId}:`, error);
          errors.push(`Removed transaction ${transactionId}: ${error.message}`);
        }
      }

      cursor = next_cursor;
    }

    // Update item cursor
    if (cursor) {
      await db.collection('plaid_items')
        .where('itemId', '==', itemData.itemId)
        .limit(1)
        .get()
        .then(snapshot => {
          if (!snapshot.empty) {
            return snapshot.docs[0].ref.update({
              cursor: cursor,
              updatedAt: Timestamp.now()
            });
          }
        });
    }

    return {
      transactionsAdded,
      transactionsModified,
      transactionsRemoved,
      errors: errors.length > 0 ? errors : undefined
    };

  } catch (error: any) {
    console.error('Error refreshing transactions:', error);
    throw error;
  }
}

/**
 * Processes a single Plaid transaction (shared with webhook handler)
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
      datePosted: Timestamp.fromDate(new Date(plaidTransaction.date)),
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
      isProcessed: false,
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
      if (!transactionData.pending) {
        await createFamilyTransaction(transactionData, itemData);
      }
    } else {
      // Update existing transaction
      const existingDoc = existingQuery.docs[0];
      const existingData = existingDoc.data() as PlaidTransaction;
      
      await existingDoc.ref.update({
        ...transactionData,
        updatedAt: Timestamp.now(),
        syncVersion: existingData.syncVersion + 1
      });
      
      // Update corresponding family transaction if it exists and transaction is no longer pending
      if (!transactionData.pending && existingData.familyTransactionId) {
        await updateFamilyTransaction(transactionData, itemData);
      } else if (!transactionData.pending && !existingData.familyTransactionId) {
        // Create family transaction if it didn't exist but transaction is no longer pending
        await createFamilyTransaction(transactionData, itemData);
      }
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
    const familyTransaction: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'> = {
      userId: itemData.userId,
      familyId: itemData.familyId || '',
      amount: Math.abs(plaidTransactionData.amount),
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
      status: TransactionStatus.APPROVED,
      approvedBy: itemData.userId,
      approvedAt: Timestamp.now(),
      metadata: {
        source: 'plaid',
        plaidTransactionId: plaidTransactionData.transactionId,
        plaidAccountId: plaidTransactionData.accountId,
        plaidCategory: plaidTransactionData.category,
        plaidCategoryId: plaidTransactionData.categoryId,
        institutionName: itemData.institutionName
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
    const familyTransactionQuery = await db.collection('transactions')
      .where('metadata.plaidTransactionId', '==', plaidTransactionData.transactionId)
      .limit(1)
      .get();

    if (!familyTransactionQuery.empty) {
      const familyTransactionDoc = familyTransactionQuery.docs[0];
      
      const updates: Partial<Transaction> = {
        amount: Math.abs(plaidTransactionData.amount),
        description: plaidTransactionData.merchantName || 
                     plaidTransactionData.originalDescription || 
                     familyTransactionDoc.data().description,
        type: plaidTransactionData.amount > 0 ? TransactionType.EXPENSE : TransactionType.INCOME,
        date: plaidTransactionData.dateTransacted,
        updatedAt: Timestamp.now()
      };

      if (plaidTransactionData.location) {
        updates.location = {
          name: plaidTransactionData.merchantName || undefined,
          address: plaidTransactionData.location.address || undefined,
          latitude: plaidTransactionData.location.lat || undefined,
          longitude: plaidTransactionData.location.lon || undefined
        };
      }

      await familyTransactionDoc.ref.update(updates);
    }

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
    const plaidTransactionQuery = await db.collection('plaid_transactions')
      .where('transactionId', '==', transactionId)
      .limit(1)
      .get();

    if (!plaidTransactionQuery.empty) {
      const plaidTransactionData = plaidTransactionQuery.docs[0].data() as PlaidTransaction;
      
      if (plaidTransactionData.familyTransactionId) {
        await db.collection('transactions')
          .doc(plaidTransactionData.familyTransactionId)
          .delete();
      }

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

  return TransactionCategory.OTHER_EXPENSE;
}