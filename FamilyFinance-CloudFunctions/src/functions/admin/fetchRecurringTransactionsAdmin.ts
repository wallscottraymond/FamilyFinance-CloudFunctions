/**
 * Admin Fetch Recurring Transactions Function
 * 
 * Administrative function to fetch recurring transactions for all users or specific user.
 * This bypasses normal authentication for initial setup or troubleshooting.
 * 
 * SECURITY WARNING: This function should only be used for admin setup and testing.
 * Remove or secure before production deployment.
 */

import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { corsMiddleware } from '../../middleware/cors';
import { db } from '../../index';
import { 
  PlaidApi, 
  Configuration, 
  PlaidEnvironments, 
  TransactionsRecurringGetRequest
} from 'plaid';
import {
  RecurringIncome,
  RecurringOutflow,
  PlaidRecurringTransactionStatus,
  PlaidRecurringTransactionStreamType,
  PlaidRecurringFrequency,
  PlaidRecurringAmount,
  PlaidItem
} from '../../types';
import { Timestamp } from 'firebase-admin/firestore';

// Define secrets for Plaid configuration
const plaidClientId = defineSecret('PLAID_CLIENT_ID');
const plaidSecret = defineSecret('PLAID_SECRET');

// Configure Plaid client
let plaidClient: PlaidApi | null = null;

function getPlaidClient(): PlaidApi {
  if (!plaidClient) {
    console.log('Creating Plaid client for sandbox environment');
    
    const configuration = new Configuration({
      basePath: PlaidEnvironments.sandbox,
    });
    
    plaidClient = new PlaidApi(configuration);
  }
  return plaidClient;
}

/**
 * Admin Fetch Recurring Transactions
 * Processes all users with Plaid items to populate outflows and inflow collections
 */
export const fetchRecurringTransactionsAdmin = onRequest(
  {
    memory: '1GiB',
    timeoutSeconds: 300,
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

            console.log('Starting admin fetch of recurring transactions for all users');

            // Get all active Plaid items across all users
            const allUsersSnapshot = await db.collection('users').get();
            
            let totalUsersProcessed = 0;
            let totalItemsProcessed = 0;
            let totalOutflowsCreated = 0;
            let totalIncomeCreated = 0;
            const userSummary: Array<{
              userId: string;
              email: string;
              outflows: number;
              income: number;
              items: number;
            }> = [];

            for (const userDoc of allUsersSnapshot.docs) {
              const userData = userDoc.data();
              const userId = userDoc.id;
              
              console.log(`Processing user: ${userData.email || userId}`);
              
              // Get user's Plaid items
              const itemsSnapshot = await db.collection('users')
                .doc(userId)
                .collection('plaidItems')
                .where('isActive', '==', true)
                .get();

              if (itemsSnapshot.empty) {
                console.log(`  No active Plaid items for user ${userId}`);
                continue;
              }

              let userOutflows = 0;
              let userIncome = 0;
              let userItems = 0;

              // Process each item for this user
              for (const itemDoc of itemsSnapshot.docs) {
                const itemData = itemDoc.data() as PlaidItem;
                
                try {
                  console.log(`  Processing item: ${itemData.itemId} (${itemData.institutionName})`);
                  
                  const result = await processItemRecurringTransactionsAdmin(itemData);
                  
                  userOutflows += result.outflowStreamsAdded;
                  userIncome += result.incomeStreamsAdded;
                  userItems++;
                  totalItemsProcessed++;
                  
                } catch (error) {
                  console.error(`  Error processing item ${itemData.itemId}:`, error);
                  // Continue processing other items
                }
              }

              if (userItems > 0) {
                totalUsersProcessed++;
                totalOutflowsCreated += userOutflows;
                totalIncomeCreated += userIncome;
                
                userSummary.push({
                  userId,
                  email: userData.email || 'No email',
                  outflows: userOutflows,
                  income: userIncome,
                  items: userItems,
                });

                console.log(`  User ${userData.email} summary: ${userOutflows} outflows, ${userIncome} income, ${userItems} items`);
              }
            }

            res.status(200).json({
              success: true,
              data: {
                totalUsersProcessed,
                totalItemsProcessed,
                totalOutflows: totalOutflowsCreated,
                totalIncome: totalIncomeCreated,
                summary: userSummary,
              },
              message: `Admin fetch completed: Processed ${totalUsersProcessed} users, ${totalItemsProcessed} items`,
            });

            console.log(`Admin recurring transactions fetch completed successfully`, {
              totalUsersProcessed,
              totalItemsProcessed,
              totalOutflowsCreated,
              totalIncomeCreated,
            });

            resolve();
          } catch (error) {
            console.error('Error in admin fetch recurring transactions:', error);
            
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
        console.error('Unhandled error in fetchRecurringTransactionsAdmin:', error);
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
 * Admin version of processItemRecurringTransactions
 */
async function processItemRecurringTransactionsAdmin(
  itemData: PlaidItem
): Promise<{
  itemId: string;
  streamsFound: number;
  streamsAdded: number;
  streamsModified: number;
  incomeStreamsAdded: number;
  outflowStreamsAdded: number;
}> {
  try {
    console.log(`    Processing recurring transactions for item: ${itemData.itemId}`);

    // Get accounts for this item to pass to Plaid API
    const accountsSnapshot = await db.collection('accounts')
      .where('itemId', '==', itemData.itemId)
      .where('isActive', '==', true)
      .get();

    const allAccountIds = accountsSnapshot.docs.map(doc => doc.data().plaidAccountId || doc.data().accountId);
    console.log(`    Found ${allAccountIds.length} active accounts for item ${itemData.itemId}:`, allAccountIds);

    if (allAccountIds.length === 0) {
      console.warn(`    No active accounts found for item ${itemData.itemId}`);
      return {
        itemId: itemData.itemId,
        streamsFound: 0,
        streamsAdded: 0,
        streamsModified: 0,
        incomeStreamsAdded: 0,
        outflowStreamsAdded: 0,
      };
    }

    console.log(`    Using account IDs for Plaid API:`, allAccountIds);

    // Prepare Plaid API request
    const request: TransactionsRecurringGetRequest = {
      client_id: plaidClientId.value(),
      secret: plaidSecret.value(),
      access_token: itemData.accessToken, // TODO: Decrypt this in production
      account_ids: allAccountIds, // Use specific account IDs instead of empty array
    };

    console.log(`    Calling Plaid transactionsRecurringGet with account IDs:`, request.account_ids);

    const client = getPlaidClient();
    const response = await client.transactionsRecurringGet(request);

    if (!response.data) {
      throw new Error('No data returned from Plaid recurring transactions API');
    }

    const { inflow_streams, outflow_streams } = response.data;
    
    console.log(`    Retrieved recurring transactions from Plaid`, {
      itemId: itemData.itemId,
      inflowStreams: inflow_streams?.length || 0,
      outflowStreams: outflow_streams?.length || 0,
    });

    let streamsFound = 0;
    let streamsAdded = 0;
    let streamsModified = 0;
    let incomeStreamsAdded = 0;
    let outflowStreamsAdded = 0;

    // Process inflow streams (save to 'inflow' collection)
    if (inflow_streams) {
      const result = await processRecurringStreamsAdmin(
        inflow_streams, 
        itemData, 
        PlaidRecurringTransactionStreamType.INFLOW
      );
      streamsFound += inflow_streams.length;
      streamsAdded += result.added;
      streamsModified += result.modified;
      incomeStreamsAdded += result.added;
    }

    // Process outflow streams (save to 'outflows' collection)
    if (outflow_streams) {
      const result = await processRecurringStreamsAdmin(
        outflow_streams, 
        itemData, 
        PlaidRecurringTransactionStreamType.OUTFLOW
      );
      streamsFound += outflow_streams.length;
      streamsAdded += result.added;
      streamsModified += result.modified;
      outflowStreamsAdded += result.added;
    }

    return {
      itemId: itemData.itemId,
      streamsFound,
      streamsAdded,
      streamsModified,
      incomeStreamsAdded,
      outflowStreamsAdded,
    };

  } catch (error) {
    console.error(`    Error processing recurring transactions for item ${itemData.itemId}:`, error);
    throw error;
  }
}

/**
 * Admin version of processRecurringStreams
 */
async function processRecurringStreamsAdmin(
  streams: any[], 
  itemData: PlaidItem, 
  streamType: PlaidRecurringTransactionStreamType
): Promise<{ added: number; modified: number }> {
  let added = 0;
  let modified = 0;

  // Determine target collection based on stream type
  const targetCollection = streamType === PlaidRecurringTransactionStreamType.INFLOW ? 'inflow' : 'outflows';
  
  console.log(`    Processing ${streams.length} ${streamType} streams to '${targetCollection}' collection`);

  for (const stream of streams) {
    try {
      // Check if stream already exists in the target collection
      const existingStreamQuery = await db.collection(targetCollection)
        .where('streamId', '==', stream.stream_id)
        .where('itemId', '==', itemData.itemId)
        .limit(1)
        .get();

      // Parse base stream data - using hybrid structure
      const baseData: any = {
        // === QUERY-CRITICAL FIELDS AT ROOT ===
        userId: itemData.userId,
        groupId: itemData.familyId,
        accessibleBy: [itemData.userId],
        streamId: stream.stream_id,
        itemId: itemData.itemId,
        accountId: stream.account_id,
        isActive: stream.is_active !== false,
        status: mapPlaidRecurringStatus(stream.status),

        // === NESTED ACCESS CONTROL ===
        access: {
          ownerId: itemData.userId,
          createdBy: itemData.userId,
          sharedWith: [],
          visibility: 'private' as const,
          permissions: {}
        },

        // === NESTED CATEGORIES ===
        categories: {
          primary: stream.category?.[0] || 'other',
          secondary: stream.category?.[1],
          tags: []
        },

        // === NESTED METADATA ===
        metadata: {
          source: 'plaid' as const,
          createdBy: itemData.userId,
          updatedBy: itemData.userId,
          updatedAt: Timestamp.now(),
          version: 1,
          lastSyncedAt: Timestamp.now(),
          syncVersion: 1,
          plaidPersonalFinanceCategory: stream.personal_finance_category ? {
            primary: stream.personal_finance_category.primary,
            detailed: stream.personal_finance_category.detailed,
            confidenceLevel: stream.personal_finance_category.confidence_level,
          } : undefined
        },

        // === NESTED RELATIONSHIPS ===
        relationships: {
          parentId: itemData.itemId,
          parentType: 'plaid_item' as const,
          linkedIds: [],
          relatedDocs: []
        },

        // === RECURRING TRANSACTION FIELDS ===
        description: stream.description || stream.merchant_name || 'Unknown',
        merchantName: stream.merchant_name || null,
        averageAmount: mapPlaidAmount(stream.average_amount),
        lastAmount: mapPlaidAmount(stream.last_amount),
        frequency: mapPlaidFrequency(stream.frequency),
        firstDate: Timestamp.fromDate(new Date(stream.first_date)),
        lastDate: Timestamp.fromDate(new Date(stream.last_date)),
        isHidden: false,
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
        console.log(`      Added new ${streamType} stream to ${targetCollection}: ${stream.stream_id}`);
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
          categories: documentData.categories,
          'metadata.plaidPersonalFinanceCategory': documentData.metadata.plaidPersonalFinanceCategory,
          averageAmount: documentData.averageAmount,
          lastAmount: documentData.lastAmount,
          frequency: documentData.frequency,
          firstDate: documentData.firstDate,
          lastDate: documentData.lastDate,
          'metadata.lastSyncedAt': documentData.metadata.lastSyncedAt,
          'metadata.syncVersion': (existingData.metadata?.syncVersion || 0) + 1,
          'metadata.updatedAt': Timestamp.now(),
          updatedAt: Timestamp.now(),
        };

        await existingDoc.ref.update(updateData);
        modified++;
        console.log(`      Updated ${streamType} stream in ${targetCollection}: ${stream.stream_id}`);
      }

    } catch (error) {
      console.error(`      Error processing ${streamType} stream ${stream.stream_id}:`, error);
      // Continue processing other streams
    }
  }

  return { added, modified };
}

// Utility functions (copied from original file)
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

function mapPlaidAmount(amount: any): PlaidRecurringAmount {
  return {
    amount: amount?.amount || 0,
    isoCurrencyCode: amount?.iso_currency_code || null,
    unofficialCurrencyCode: amount?.unofficial_currency_code || null,
  };
}

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

function isLikelySalary(description: string, merchantName?: string): boolean {
  const text = `${description} ${merchantName || ''}`.toLowerCase();
  return text.includes('payroll') || text.includes('salary') || text.includes('direct deposit');
}

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

function isEssentialExpense(category: string[], description: string): boolean {
  const essentialCategories = ['rent', 'mortgage', 'utilities', 'insurance', 'loan', 'food'];
  const categoryStr = category.join(' ').toLowerCase();
  return essentialCategories.some(essential => categoryStr.includes(essential));
}

function isCancellableExpense(category: string[], description: string): boolean {
  const cancellableCategories = ['subscription', 'entertainment', 'streaming'];
  const categoryStr = category.join(' ').toLowerCase();
  const descStr = description.toLowerCase();
  return cancellableCategories.some(cancellable => 
    categoryStr.includes(cancellable) || descStr.includes(cancellable)
  );
}

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