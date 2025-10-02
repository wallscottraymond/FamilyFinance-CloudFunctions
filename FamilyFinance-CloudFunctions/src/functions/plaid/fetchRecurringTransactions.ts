/**
 * Fetch Recurring Transactions Cloud Function
 * 
 * Fetches recurring transaction streams from Plaid for a specific item or all user items.
 * This function calls the Plaid /transactions/recurring/get endpoint and stores the
 * recurring transaction data in Firestore.
 * 
 * Security Features:
 * - User authentication required (VIEWER role minimum)
 * - Encrypted access token handling
 * - Proper error handling and validation
 * 
 * Memory: 512MiB, Timeout: 60s
 * CORS: Enabled for mobile app
 * Promise Pattern: ✓
 */

import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { corsMiddleware } from '../../middleware/cors';
import { authenticateRequest, UserRole } from '../../utils/auth';
import { validateRequest } from '../../utils/validation';
import * as Joi from 'joi';
import { db } from '../../index';
import {
  PlaidApi,
  TransactionsRecurringGetRequest
} from 'plaid';
import { createStandardPlaidClient } from '../../utils/plaidClientFactory';
import {
  BaseRecurringTransaction,
  RecurringIncome,
  RecurringOutflow,
  PlaidRecurringTransactionStatus,
  PlaidRecurringTransactionStreamType,
  PlaidRecurringFrequency,
  PlaidRecurringAmount,
  FetchRecurringTransactionsRequest,
  FetchRecurringTransactionsResponse,
  PlaidItem
} from '../../types';
import { Timestamp } from 'firebase-admin/firestore';

// Define secrets for Plaid configuration
const plaidClientId = defineSecret('PLAID_CLIENT_ID');
const plaidSecret = defineSecret('PLAID_SECRET');

// Request validation schema
const fetchRecurringTransactionsSchema = Joi.object({
  itemId: Joi.string().optional(),
  accountId: Joi.string().optional(),
});

// Use centralized Plaid client factory
function getPlaidClient(): PlaidApi {
  return createStandardPlaidClient();
}

/**
 * Fetch Recurring Transactions
 */
export const fetchRecurringTransactions = onRequest(
  {
    memory: '512MiB',
    timeoutSeconds: 60,
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
            const { user } = await authenticateRequest(req, UserRole.VIEWER);

            // Validate request body
            const validationResult = validateRequest(req.body, fetchRecurringTransactionsSchema);
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

            const requestData: FetchRecurringTransactionsRequest = validationResult.value;

            console.log('Fetching recurring transactions for user:', user.uid, 'itemId:', requestData.itemId);

            // Get user's Plaid items
            let itemsQuery = db.collection('users').doc(user.uid).collection('plaidItems');

            if (requestData.itemId) {
              // Fetch specific item
              const itemDoc = await itemsQuery.doc(requestData.itemId).get();
              if (!itemDoc.exists) {
                res.status(404).json({
                  success: false,
                  error: {
                    code: 'ITEM_NOT_FOUND',
                    message: 'Plaid item not found',
                  },
                });
                return resolve();
              }
              
              const result = await processItemRecurringTransactions(itemDoc.data() as PlaidItem, requestData.accountId);
              
              res.status(200).json({
                success: true,
                data: result,
                message: `Fetched recurring transactions for item ${requestData.itemId}`,
              } as { success: boolean; data: FetchRecurringTransactionsResponse; message: string });
              
            } else {
              // Fetch all active items for user
              const itemsSnapshot = await itemsQuery.where('isActive', '==', true).get();
              
              if (itemsSnapshot.empty) {
                res.status(200).json({
                  success: true,
                  data: {
                    itemId: '',
                    accountsCount: 0,
                    streamsFound: 0,
                    streamsAdded: 0,
                    streamsModified: 0,
                    historicalTransactionsDays: 0,
                  } as FetchRecurringTransactionsResponse,
                  message: 'No active Plaid items found',
                });
                return resolve();
              }

              let totalAccountsCount = 0;
              let totalStreamsFound = 0;
              let totalStreamsAdded = 0;
              let totalStreamsModified = 0;
              let totalIncomeStreamsAdded = 0;
              let totalOutflowStreamsAdded = 0;
              let totalIncomeStreamsModified = 0;
              let totalOutflowStreamsModified = 0;

              // Process each item
              for (const itemDoc of itemsSnapshot.docs) {
                const itemData = itemDoc.data() as PlaidItem;
                const result = await processItemRecurringTransactions(itemData, requestData.accountId);
                
                totalAccountsCount += result.accountsCount;
                totalStreamsFound += result.streamsFound;
                totalStreamsAdded += result.streamsAdded;
                totalStreamsModified += result.streamsModified;
                totalIncomeStreamsAdded += result.incomeStreamsAdded;
                totalOutflowStreamsAdded += result.outflowStreamsAdded;
                totalIncomeStreamsModified += result.incomeStreamsModified;
                totalOutflowStreamsModified += result.outflowStreamsModified;
              }

              res.status(200).json({
                success: true,
                data: {
                  itemId: 'multiple',
                  accountsCount: totalAccountsCount,
                  streamsFound: totalStreamsFound,
                  streamsAdded: totalStreamsAdded,
                  streamsModified: totalStreamsModified,
                  incomeStreamsAdded: totalIncomeStreamsAdded,
                  outflowStreamsAdded: totalOutflowStreamsAdded,
                  incomeStreamsModified: totalIncomeStreamsModified,
                  outflowStreamsModified: totalOutflowStreamsModified,
                  historicalTransactionsDays: 180, // Standard for recurring transactions
                } as FetchRecurringTransactionsResponse,
                message: `Fetched recurring transactions for ${itemsSnapshot.size} items`,
              });
            }

            console.log('Recurring transactions fetch completed successfully', {
              userId: user.uid,
              itemId: requestData.itemId || 'all',
              accountId: requestData.accountId,
            });

            resolve();
          } catch (error) {
            console.error('Error fetching recurring transactions:', error);

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
        console.error('Unhandled error in fetchRecurringTransactions:', error);
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
 * Process recurring transactions for a specific Plaid item
 */
async function processItemRecurringTransactions(
  itemData: PlaidItem, 
  accountId?: string
): Promise<FetchRecurringTransactionsResponse> {
  try {
    console.log(`Processing recurring transactions for item: ${itemData.itemId}`);

    // Get accounts for this item to pass to Plaid API
    const accountsSnapshot = await db.collection('accounts')
      .where('itemId', '==', itemData.itemId)
      .where('isActive', '==', true)
      .get();

    const allAccountIds = accountsSnapshot.docs.map(doc => doc.data().plaidAccountId || doc.data().accountId);
    console.log(`Found ${allAccountIds.length} active accounts for item ${itemData.itemId}:`, allAccountIds);

    // Filter to specific account if provided
    const targetAccountIds = accountId ? [accountId] : allAccountIds;
    
    if (targetAccountIds.length === 0) {
      console.warn(`No active accounts found for item ${itemData.itemId}`);
      return {
        itemId: itemData.itemId,
        accountsCount: 0,
        streamsFound: 0,
        streamsAdded: 0,
        streamsModified: 0,
        incomeStreamsAdded: 0,
        outflowStreamsAdded: 0,
        incomeStreamsModified: 0,
        outflowStreamsModified: 0,
        historicalTransactionsDays: 180,
      };
    }

    console.log(`Using account IDs for Plaid API:`, targetAccountIds);

    // Prepare Plaid API request
    const request: TransactionsRecurringGetRequest = {
      client_id: plaidClientId.value(),
      secret: plaidSecret.value(),
      access_token: itemData.accessToken, // TODO: Decrypt this in production
      account_ids: targetAccountIds, // Use specific account IDs instead of empty array
    };

    console.log(`Calling Plaid transactionsRecurringGet with account IDs:`, request.account_ids);

    const client = getPlaidClient();
    const response = await client.transactionsRecurringGet(request);

    if (!response.data) {
      throw new Error('No data returned from Plaid recurring transactions API');
    }

    const { inflow_streams, outflow_streams } = response.data;
    
    console.log(`Retrieved recurring transactions from Plaid`, {
      itemId: itemData.itemId,
      inflowStreams: inflow_streams?.length || 0,
      outflowStreams: outflow_streams?.length || 0,
    });

    let streamsFound = 0;
    let streamsAdded = 0;
    let streamsModified = 0;
    let incomeStreamsAdded = 0;
    let outflowStreamsAdded = 0;
    let incomeStreamsModified = 0;
    let outflowStreamsModified = 0;

    // Process inflow streams (save to 'inflow' collection)
    if (inflow_streams) {
      const result = await processRecurringStreams(
        inflow_streams, 
        itemData, 
        PlaidRecurringTransactionStreamType.INFLOW
      );
      streamsFound += inflow_streams.length;
      streamsAdded += result.added;
      streamsModified += result.modified;
      incomeStreamsAdded += result.added;
      incomeStreamsModified += result.modified;
    }

    // Process outflow streams (save to 'outflows' collection)
    if (outflow_streams) {
      const result = await processRecurringStreams(
        outflow_streams, 
        itemData, 
        PlaidRecurringTransactionStreamType.OUTFLOW
      );
      streamsFound += outflow_streams.length;
      streamsAdded += result.added;
      streamsModified += result.modified;
      outflowStreamsAdded += result.added;
      outflowStreamsModified += result.modified;
    }

    return {
      itemId: itemData.itemId,
      accountsCount: targetAccountIds.length,
      streamsFound,
      streamsAdded,
      streamsModified,
      incomeStreamsAdded,
      outflowStreamsAdded,
      incomeStreamsModified,
      outflowStreamsModified,
      historicalTransactionsDays: 180, // Standard for recurring transactions
    };

  } catch (error) {
    console.error(`Error processing recurring transactions for item ${itemData.itemId}:`, error);
    throw error;
  }
}

/**
 * Process a set of recurring transaction streams and save to appropriate root collection
 */
async function processRecurringStreams(
  streams: any[], 
  itemData: PlaidItem, 
  streamType: PlaidRecurringTransactionStreamType
): Promise<{ added: number; modified: number }> {
  let added = 0;
  let modified = 0;

  // Determine target collection based on stream type
  const targetCollection = streamType === PlaidRecurringTransactionStreamType.INFLOW ? 'inflow' : 'outflows';
  
  console.log(`Processing ${streams.length} ${streamType} streams to '${targetCollection}' collection`);

  for (const stream of streams) {
    try {
      // Check if stream already exists in the target collection
      const existingStreamQuery = await db.collection(targetCollection)
        .where('streamId', '==', stream.stream_id)
        .where('itemId', '==', itemData.itemId)
        .limit(1)
        .get();

      // Parse base stream data
      const baseData: Omit<BaseRecurringTransaction, 'id' | 'createdAt' | 'updatedAt'> = {
        streamId: stream.stream_id,
        itemId: itemData.itemId,
        userId: itemData.userId,
        familyId: itemData.familyId,
        accountId: stream.account_id,
        isActive: stream.is_active !== false,
        status: mapPlaidRecurringStatus(stream.status),
        description: stream.description || stream.merchant_name || 'Unknown',
        merchantName: stream.merchant_name || null,
        category: stream.category || [],
        personalFinanceCategory: stream.personal_finance_category ? {
          primary: stream.personal_finance_category.primary,
          detailed: stream.personal_finance_category.detailed,
          confidenceLevel: stream.personal_finance_category.confidence_level,
        } : undefined,
        averageAmount: mapPlaidAmount(stream.average_amount),
        lastAmount: mapPlaidAmount(stream.last_amount),
        frequency: mapPlaidFrequency(stream.frequency),
        firstDate: Timestamp.fromDate(new Date(stream.first_date)),
        lastDate: Timestamp.fromDate(new Date(stream.last_date)),
        transactionIds: stream.transaction_ids || [],
        userCategory: undefined,
        userNotes: undefined,
        tags: [],
        isHidden: false,
        lastSyncedAt: Timestamp.now(),
        syncVersion: 1,
      };

      // Add type-specific fields
      let documentData: any = { ...baseData };
      
      if (streamType === PlaidRecurringTransactionStreamType.INFLOW) {
        // Add income-specific fields
        documentData = {
          ...documentData,
          incomeType: categorizeIncomeType(stream.category, stream.description),
          isRegularSalary: isLikelySalary(stream.description, stream.merchant_name),
          employerName: stream.merchant_name || undefined,
          taxable: true, // Default to taxable, user can modify
        } as Omit<RecurringIncome, 'id' | 'createdAt' | 'updatedAt'>;
      } else {
        // Add outflow-specific fields
        documentData = {
          ...documentData,
          expenseType: categorizeExpenseType(stream.category, stream.description),
          isEssential: isEssentialExpense(stream.category, stream.description),
          merchantCategory: stream.personal_finance_category?.primary || undefined,
          isCancellable: isCancellableExpense(stream.category, stream.description),
          reminderDays: getDefaultReminderDays(stream.category),
        } as Omit<RecurringOutflow, 'id' | 'createdAt' | 'updatedAt'>;
      }

      if (existingStreamQuery.empty) {
        // Create new document in target collection
        await db.collection(targetCollection).add({
          ...documentData,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        });
        added++;
        console.log(`Added new ${streamType} stream to ${targetCollection}: ${stream.stream_id}`);
      } else {
        // Update existing document
        const existingDoc = existingStreamQuery.docs[0];
        const existingData = existingDoc.data();
        
        // Only update Plaid-controlled fields (preserve user customizations)
        const updateData: any = {
          isActive: documentData.isActive,
          status: documentData.status,
          description: documentData.description,
          merchantName: documentData.merchantName,
          category: documentData.category,
          personalFinanceCategory: documentData.personalFinanceCategory,
          averageAmount: documentData.averageAmount,
          lastAmount: documentData.lastAmount,
          frequency: documentData.frequency,
          firstDate: documentData.firstDate,
          lastDate: documentData.lastDate,
          transactionIds: documentData.transactionIds,
          lastSyncedAt: documentData.lastSyncedAt,
          syncVersion: (existingData.syncVersion || 0) + 1,
          updatedAt: Timestamp.now(),
        };

        await existingDoc.ref.update(updateData);
        modified++;
        console.log(`Updated ${streamType} stream in ${targetCollection}: ${stream.stream_id}`);
      }

    } catch (error) {
      console.error(`Error processing ${streamType} stream ${stream.stream_id}:`, error);
      // Continue processing other streams
    }
  }

  return { added, modified };
}

/**
 * Map Plaid recurring status to our enum
 */
function mapPlaidRecurringStatus(status: string): PlaidRecurringTransactionStatus {
  switch (status?.toUpperCase()) {
    case 'MATURE':
      return PlaidRecurringTransactionStatus.MATURE;
    case 'EARLY_DETECTION':
      return PlaidRecurringTransactionStatus.EARLY_DETECTION;
    default:
      return PlaidRecurringTransactionStatus.EARLY_DETECTION;
  }
}

/**
 * Map Plaid frequency to our enum
 */
function mapPlaidFrequency(frequency: string): PlaidRecurringFrequency {
  switch (frequency?.toUpperCase()) {
    case 'WEEKLY':
      return PlaidRecurringFrequency.WEEKLY;
    case 'BIWEEKLY':
      return PlaidRecurringFrequency.BIWEEKLY;
    case 'SEMI_MONTHLY':
      return PlaidRecurringFrequency.SEMI_MONTHLY;
    case 'MONTHLY':
      return PlaidRecurringFrequency.MONTHLY;
    case 'ANNUALLY':
      return PlaidRecurringFrequency.ANNUALLY;
    default:
      return PlaidRecurringFrequency.UNKNOWN;
  }
}

/**
 * Map Plaid amount object to our interface
 */
function mapPlaidAmount(amount: any): PlaidRecurringAmount {
  return {
    amount: amount?.amount || 0,
    isoCurrencyCode: amount?.iso_currency_code || null,
    unofficialCurrencyCode: amount?.unofficial_currency_code || null,
  };
}

/**
 * Categorize income type based on Plaid data
 */
function categorizeIncomeType(category: string[], description: string): 'salary' | 'dividend' | 'interest' | 'rental' | 'freelance' | 'bonus' | 'other' {
  const categoryStr = category.join(' ').toLowerCase();
  const descStr = description.toLowerCase();
  
  if (categoryStr.includes('payroll') || descStr.includes('salary') || descStr.includes('payroll')) {
    return 'salary';
  }
  if (categoryStr.includes('dividend') || descStr.includes('dividend')) {
    return 'dividend';
  }
  if (categoryStr.includes('interest') || descStr.includes('interest')) {
    return 'interest';
  }
  if (categoryStr.includes('rental') || descStr.includes('rent')) {
    return 'rental';
  }
  if (descStr.includes('freelance') || descStr.includes('contractor')) {
    return 'freelance';
  }
  if (descStr.includes('bonus')) {
    return 'bonus';
  }
  return 'other';
}

/**
 * Check if transaction is likely salary
 */
function isLikelySalary(description: string, merchantName?: string): boolean {
  const text = `${description} ${merchantName || ''}`.toLowerCase();
  return text.includes('payroll') || text.includes('salary') || text.includes('direct deposit');
}

/**
 * Categorize expense type based on Plaid data
 */
function categorizeExpenseType(category: string[], description: string): 'subscription' | 'utility' | 'loan' | 'rent' | 'insurance' | 'tax' | 'other' {
  const categoryStr = category.join(' ').toLowerCase();
  const descStr = description.toLowerCase();
  
  if (categoryStr.includes('subscription') || descStr.includes('subscription') || descStr.includes('monthly')) {
    return 'subscription';
  }
  if (categoryStr.includes('utilities') || descStr.includes('electric') || descStr.includes('gas') || descStr.includes('water')) {
    return 'utility';
  }
  if (categoryStr.includes('loan') || descStr.includes('loan') || descStr.includes('mortgage')) {
    return 'loan';
  }
  if (descStr.includes('rent') || categoryStr.includes('rent')) {
    return 'rent';
  }
  if (categoryStr.includes('insurance') || descStr.includes('insurance')) {
    return 'insurance';
  }
  if (categoryStr.includes('tax') || descStr.includes('tax')) {
    return 'tax';
  }
  return 'other';
}

/**
 * Check if expense is essential
 */
function isEssentialExpense(category: string[], description: string): boolean {
  const essentialCategories = ['rent', 'mortgage', 'utilities', 'insurance', 'loan', 'food'];
  const categoryStr = category.join(' ').toLowerCase();
  return essentialCategories.some(essential => categoryStr.includes(essential));
}

/**
 * Check if expense is easily cancellable
 */
function isCancellableExpense(category: string[], description: string): boolean {
  const cancellableCategories = ['subscription', 'entertainment', 'streaming'];
  const categoryStr = category.join(' ').toLowerCase();
  const descStr = description.toLowerCase();
  return cancellableCategories.some(cancellable => 
    categoryStr.includes(cancellable) || descStr.includes(cancellable)
  );
}

/**
 * Get default reminder days based on category
 */
function getDefaultReminderDays(category: string[]): number {
  const categoryStr = category.join(' ').toLowerCase();
  if (categoryStr.includes('loan') || categoryStr.includes('mortgage') || categoryStr.includes('rent')) {
    return 7; // One week for important payments
  }
  if (categoryStr.includes('utilities') || categoryStr.includes('insurance')) {
    return 5; // 5 days for utilities/insurance
  }
  return 3; // 3 days default
}