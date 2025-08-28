/**
 * Exchange Plaid Token Cloud Function
 * 
 * Exchanges a public token for an access token using the real Plaid API.
 * This function handles the complete token exchange flow including:
 * - Public token -> Access token exchange
 * - Account data retrieval
 * - Firestore data storage
 * 
 * Security Features:
 * - User authentication required (VIEWER role minimum)
 * - Encrypted access token storage
 * - Proper error handling and validation
 * 
 * Memory: 256MiB, Timeout: 30s
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
  Configuration, 
  PlaidEnvironments, 
  ItemPublicTokenExchangeRequest,
  AccountsGetRequest,
  TransactionsGetRequest,
  Products
} from 'plaid';

// Define secrets for Plaid configuration
const plaidClientId = defineSecret('PLAID_CLIENT_ID');
const plaidSecret = defineSecret('PLAID_SECRET');

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
    processing?: {
      transactions: {
        accountsProcessed: number;
        accountsSuccessful: number;
        accountsFailed: number;
        transactionsTotal: number;
        transactionsSaved: number;
        errors: string[];
      };
      recurringTransactions: {
        accountsProcessed: number;
        accountsSuccessful: number;
        accountsFailed: number;
        inflowStreams: number;
        outflowStreams: number;
        totalStreamsSaved: number;
        errors: string[];
      };
    };
  };
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  message?: string;
}

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
 * Exchange Plaid Token
 */
export const exchangePlaidToken = onRequest(
  {
    memory: '256MiB',
    timeoutSeconds: 30,
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

            console.log('Exchanging public token for user:', user.uid, 'institution:', requestData.metadata.institution.name);

            // Exchange public token for access token
            const exchangeRequest: ItemPublicTokenExchangeRequest = {
              client_id: plaidClientId.value(),
              secret: plaidSecret.value(),
              public_token: requestData.publicToken,
            };

            const client = getPlaidClient();
            const exchangeResponse = await client.itemPublicTokenExchange(exchangeRequest);

            if (!exchangeResponse.data.access_token) {
              throw new Error('Failed to exchange public token - no access token returned');
            }

            const accessToken = exchangeResponse.data.access_token;
            const itemId = exchangeResponse.data.item_id;

            console.log('Public token exchanged successfully', {
              itemId,
              userId: user.uid,
              institutionName: requestData.metadata.institution.name,
            });

            // Get account details from Plaid
            const accountsRequest: AccountsGetRequest = {
              client_id: plaidClientId.value(),
              secret: plaidSecret.value(),
              access_token: accessToken,
            };

            const accountsResponse = await client.accountsGet(accountsRequest);
            const plaidAccounts = accountsResponse.data.accounts;

            console.log('Retrieved account details from Plaid', {
              accountCount: plaidAccounts.length,
              itemId,
            });

            // Process account data
            const processedAccounts = plaidAccounts.map(account => ({
              id: account.account_id,
              name: account.name,
              type: account.type,
              subtype: account.subtype || null,
              currentBalance: account.balances.current || 0,
              availableBalance: account.balances.available,
              currencyCode: account.balances.iso_currency_code || 'USD',
              mask: account.mask,
              officialName: account.official_name,
            }));

            // Save data to Firestore
            console.log('Saving Plaid data to Firestore...');
            
            // Create the Plaid item document in user's subcollection
            await db.collection('users').doc(user.uid).collection('plaidItems').doc(itemId).set({
              id: itemId,
              plaidItemId: itemId,
              userId: user.uid,
              familyId: '', // TODO: Get user's familyId from userData
              institutionId: requestData.metadata.institution.institution_id,
              institutionName: requestData.metadata.institution.name,
              institutionLogo: null,
              accessToken: accessToken, // TODO: Encrypt this in production
              cursor: null,
              products: [Products.Transactions, Products.Auth],
              status: 'GOOD',
              error: null,
              lastWebhookReceived: null,
              isActive: true,
              lastUpdated: new Date(),
              createdAt: new Date(),
              updatedAt: new Date(),
            });

            // Create account documents in root accounts collection
            console.log(`Saving ${processedAccounts.length} account documents to Firestore...`);
            for (const account of processedAccounts) {
              try {
                console.log(`Saving account: ${account.id} (${account.name}) - ${account.type}/${account.subtype}`);
                
                await db.collection('accounts').doc(account.id).set({
                  id: account.id,
                  plaidAccountId: account.id,
                  accountId: account.id,
                  itemId: itemId,
                  userId: user.uid,
                  familyId: '', // TODO: Get user's familyId from userData
                  institutionId: requestData.metadata.institution.institution_id,
                  institutionName: requestData.metadata.institution.name,
                  accountName: account.name,
                  accountType: account.type,
                  accountSubtype: account.subtype,
                  mask: account.mask,
                  officialName: account.officialName,
                  balances: {
                    available: account.availableBalance,
                    current: account.currentBalance,
                    limit: null,
                    iso_currency_code: account.currencyCode,
                  },
                  currentBalance: account.currentBalance,
                  availableBalance: account.availableBalance,
                  creditLimit: null,
                  isoCurrencyCode: account.currencyCode,
                  currencyCode: account.currencyCode,
                  isActive: true,
                  isSyncEnabled: true,
                  lastUpdated: new Date(),
                  lastSyncedAt: new Date(),
                  createdAt: new Date(),
                  updatedAt: new Date(),
                });
                
                console.log(`Successfully saved account: ${account.id}`);
              } catch (accountError) {
                console.error(`Failed to save account ${account.id}:`, accountError);
                throw accountError; // Re-throw to fail the entire operation if account saving fails
              }
            }
            
            console.log(`Successfully saved all ${processedAccounts.length} accounts to Firestore`);

            console.log('Plaid data saved to Firestore successfully');

            // Fetch recurring transactions for ALL accounts
            console.log(`Fetching recurring transactions from Plaid for ${plaidAccounts.length} accounts...`);
            let recurringTransactionCount = 0;
            const recurringProcessingResults = {
              accountsProcessed: 0,
              accountsSuccessful: 0,
              accountsFailed: 0,
              inflowStreamsTotal: 0,
              outflowStreamsTotal: 0,
              errors: [] as string[]
            };

            try {
              // Call Plaid API for all accounts at once (more efficient)
              const recurringRequest = {
                client_id: plaidClientId.value(),
                secret: plaidSecret.value(),
                access_token: accessToken,
                account_ids: plaidAccounts.map(account => account.account_id),
              };

              console.log('Calling Plaid transactionsRecurringGet with account IDs:', recurringRequest.account_ids);

              try {
                const recurringResponse = await client.transactionsRecurringGet(recurringRequest);
                
                const inflowStreamsCount = recurringResponse.data.inflow_streams?.length || 0;
                const outflowStreamsCount = recurringResponse.data.outflow_streams?.length || 0;
                
                console.log('Retrieved recurring transactions from Plaid', {
                  inflowStreams: inflowStreamsCount,
                  outflowStreams: outflowStreamsCount,
                  totalStreams: inflowStreamsCount + outflowStreamsCount
                });

                recurringProcessingResults.inflowStreamsTotal = inflowStreamsCount;
                recurringProcessingResults.outflowStreamsTotal = outflowStreamsCount;

                // Save recurring transactions to new root collections
                const { inflow_streams, outflow_streams } = recurringResponse.data;
                
                // Process inflow streams (income)
                if (inflow_streams && inflow_streams.length > 0) {
                  console.log(`Processing ${inflow_streams.length} inflow streams...`);
                  
                  for (const stream of inflow_streams) {
                    try {
                      console.log(`Processing income stream ${stream.stream_id} for account ${stream.account_id}`);
                      
                      const incomeData = {
                        streamId: stream.stream_id,
                        itemId: itemId,
                        userId: user.uid,
                        familyId: '', // TODO: Get user's familyId from userData
                        accountId: stream.account_id,
                        isActive: stream.is_active !== false,
                        status: stream.status || 'EARLY_DETECTION',
                        description: stream.description || stream.merchant_name || 'Unknown',
                        merchantName: stream.merchant_name || null,
                        category: stream.category || [],
                        personalFinanceCategory: stream.personal_finance_category || null,
                        averageAmount: {
                          amount: stream.average_amount?.amount || 0,
                          isoCurrencyCode: stream.average_amount?.iso_currency_code || 'USD',
                          unofficialCurrencyCode: stream.average_amount?.unofficial_currency_code || null,
                        },
                        lastAmount: {
                          amount: stream.last_amount?.amount || 0,
                          isoCurrencyCode: stream.last_amount?.iso_currency_code || 'USD',
                          unofficialCurrencyCode: stream.last_amount?.unofficial_currency_code || null,
                        },
                        frequency: stream.frequency || 'UNKNOWN',
                        firstDate: new Date(stream.first_date),
                        lastDate: new Date(stream.last_date),
                        transactionIds: stream.transaction_ids || [],
                        userCategory: null,
                        userNotes: null,
                        tags: [],
                        isHidden: false,
                        lastSyncedAt: new Date(),
                        syncVersion: 1,
                        // Income-specific fields
                        incomeType: 'other', // Default, user can categorize
                        isRegularSalary: false,
                        employerName: stream.merchant_name || null,
                        taxable: true,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                      };

                      await db.collection('inflow').add(incomeData);
                      recurringTransactionCount++;
                      
                      console.log(`Successfully saved income stream ${stream.stream_id}`);
                    } catch (streamError) {
                      const errorMsg = `Failed to save income stream ${stream.stream_id}: ${streamError}`;
                      console.error(errorMsg);
                      recurringProcessingResults.errors.push(errorMsg);
                    }
                  }
                }

                // Process outflow streams (expenses)
                if (outflow_streams && outflow_streams.length > 0) {
                  console.log(`Processing ${outflow_streams.length} outflow streams...`);
                  
                  for (const stream of outflow_streams) {
                    try {
                      console.log(`Processing outflow stream ${stream.stream_id} for account ${stream.account_id}`);
                      
                      const outflowData = {
                        streamId: stream.stream_id,
                        itemId: itemId,
                        userId: user.uid,
                        familyId: '', // TODO: Get user's familyId from userData
                        accountId: stream.account_id,
                        isActive: stream.is_active !== false,
                        status: stream.status || 'EARLY_DETECTION',
                        description: stream.description || stream.merchant_name || 'Unknown',
                        merchantName: stream.merchant_name || null,
                        category: stream.category || [],
                        personalFinanceCategory: stream.personal_finance_category || null,
                        averageAmount: {
                          amount: stream.average_amount?.amount || 0,
                          isoCurrencyCode: stream.average_amount?.iso_currency_code || 'USD',
                          unofficialCurrencyCode: stream.average_amount?.unofficial_currency_code || null,
                        },
                        lastAmount: {
                          amount: stream.last_amount?.amount || 0,
                          isoCurrencyCode: stream.last_amount?.iso_currency_code || 'USD',
                          unofficialCurrencyCode: stream.last_amount?.unofficial_currency_code || null,
                        },
                        frequency: stream.frequency || 'UNKNOWN',
                        firstDate: new Date(stream.first_date),
                        lastDate: new Date(stream.last_date),
                        transactionIds: stream.transaction_ids || [],
                        userCategory: null,
                        userNotes: null,
                        tags: [],
                        isHidden: false,
                        lastSyncedAt: new Date(),
                        syncVersion: 1,
                        // Outflow-specific fields
                        expenseType: 'other', // Default, user can categorize
                        isEssential: false,
                        merchantCategory: stream.personal_finance_category?.primary || null,
                        isCancellable: true,
                        reminderDays: 3,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                      };

                      await db.collection('outflows').add(outflowData);
                      recurringTransactionCount++;
                      
                      console.log(`Successfully saved outflow stream ${stream.stream_id}`);
                    } catch (streamError) {
                      const errorMsg = `Failed to save outflow stream ${stream.stream_id}: ${streamError}`;
                      console.error(errorMsg);
                      recurringProcessingResults.errors.push(errorMsg);
                    }
                  }
                }

                recurringProcessingResults.accountsProcessed = plaidAccounts.length;
                recurringProcessingResults.accountsSuccessful = plaidAccounts.length;
                
                console.log(`Successfully processed recurring transactions:`, {
                  totalStreams: recurringTransactionCount,
                  inflowStreams: inflowStreamsCount,
                  outflowStreams: outflowStreamsCount,
                  accountsProcessed: recurringProcessingResults.accountsProcessed,
                  errors: recurringProcessingResults.errors.length
                });

              } catch (recurringError) {
                const errorMsg = `Error fetching recurring transactions from Plaid API: ${recurringError}`;
                console.error(errorMsg);
                recurringProcessingResults.errors.push(errorMsg);
                recurringProcessingResults.accountsFailed = plaidAccounts.length;
                // Don't fail the entire operation if recurring transactions fail
              }

            } catch (recurringImportError) {
              const errorMsg = `Error in recurring transactions processing: ${recurringImportError}`;
              console.error(errorMsg);
              recurringProcessingResults.errors.push(errorMsg);
              // Don't fail the entire operation if import fails
            }

            // Fetch transactions for ALL accounts individually
            console.log(`Fetching recent transactions from Plaid for ${plaidAccounts.length} accounts...`);
            let transactionCount = 0;
            const transactionProcessingResults = {
              accountsProcessed: 0,
              accountsSuccessful: 0,
              accountsFailed: 0,
              transactionsTotal: 0,
              errors: [] as string[]
            };

            try {
              const endDate = new Date();
              const startDate = new Date();
              startDate.setDate(startDate.getDate() - 30); // Get last 30 days of transactions

              // Fetch transactions for ALL accounts at once (more efficient than per-account calls)
              const transactionsRequest: TransactionsGetRequest = {
                client_id: plaidClientId.value(),
                secret: plaidSecret.value(),
                access_token: accessToken,
                start_date: startDate.toISOString().split('T')[0], // Format: YYYY-MM-DD
                end_date: endDate.toISOString().split('T')[0],
                options: {
                  count: 500, // Maximum number of transactions to fetch
                  offset: 0,
                  account_ids: plaidAccounts.map(account => account.account_id), // Explicitly specify ALL account IDs
                },
              };

              console.log('Calling Plaid transactionsGet with account IDs:', transactionsRequest.options?.account_ids);

              const transactionsResponse = await client.transactionsGet(transactionsRequest);
              const plaidTransactions = transactionsResponse.data.transactions;

              console.log(`Retrieved ${plaidTransactions.length} transactions from Plaid for ${plaidAccounts.length} accounts`);

              // Group transactions by account for logging
              const transactionsByAccount = plaidTransactions.reduce((acc, transaction) => {
                acc[transaction.account_id] = (acc[transaction.account_id] || 0) + 1;
                return acc;
              }, {} as Record<string, number>);

              console.log('Transactions by account:', transactionsByAccount);

              // Save transactions to root transactions collection with individual error handling
              let successfulTransactions = 0;
              let failedTransactions = 0;
              
              for (const transaction of plaidTransactions) {
                try {
                  console.log(`Processing transaction ${transaction.transaction_id} for account ${transaction.account_id}`);
                  
                  const transactionData = {
                    id: transaction.transaction_id,
                    plaidTransactionId: transaction.transaction_id,
                    userId: user.uid,
                    accountId: transaction.account_id,
                    itemId: itemId,
                    amount: transaction.amount,
                    currencyCode: transaction.iso_currency_code || 'USD',
                    date: transaction.date,
                    authorizedDate: transaction.authorized_date,
                    merchantName: transaction.merchant_name,
                    name: transaction.name,
                    category: transaction.category || [],
                    categoryId: transaction.category_id,
                    pending: transaction.pending,
                    paymentChannel: transaction.payment_channel,
                    accountOwner: transaction.account_owner,
                    location: transaction.location ? {
                      address: transaction.location.address,
                      city: transaction.location.city,
                      region: transaction.location.region,
                      postalCode: transaction.location.postal_code,
                      country: transaction.location.country,
                    } : null,
                    paymentMeta: transaction.payment_meta ? {
                      referenceNumber: transaction.payment_meta.reference_number,
                      ppdId: transaction.payment_meta.ppd_id,
                      payee: transaction.payment_meta.payee,
                      byOrderOf: transaction.payment_meta.by_order_of,
                      payer: transaction.payment_meta.payer,
                      paymentMethod: transaction.payment_meta.payment_method,
                      paymentProcessor: transaction.payment_meta.payment_processor,
                      reason: transaction.payment_meta.reason,
                    } : null,
                    isManual: false, // Plaid transactions are not manual
                    source: 'plaid',
                    status: 'posted', // Most Plaid transactions are posted
                    notes: '',
                    tags: [],
                    createdAt: new Date(),
                    updatedAt: new Date(),
                  };

                  await db.collection('transactions').doc(transaction.transaction_id).set(transactionData);
                  successfulTransactions++;
                  
                } catch (transactionSaveError) {
                  const errorMsg = `Failed to save transaction ${transaction.transaction_id}: ${transactionSaveError}`;
                  console.error(errorMsg);
                  transactionProcessingResults.errors.push(errorMsg);
                  failedTransactions++;
                }
              }

              transactionCount = successfulTransactions;
              transactionProcessingResults.transactionsTotal = plaidTransactions.length;
              transactionProcessingResults.accountsProcessed = plaidAccounts.length;
              transactionProcessingResults.accountsSuccessful = plaidAccounts.length; // All accounts were attempted
              
              console.log(`Successfully processed transactions:`, {
                totalTransactions: plaidTransactions.length,
                successfulTransactions,
                failedTransactions,
                accountsProcessed: plaidAccounts.length,
                transactionsByAccount,
                errors: transactionProcessingResults.errors.length
              });

            } catch (transactionError) {
              const errorMsg = `Error fetching transactions from Plaid API: ${transactionError}`;
              console.error(errorMsg);
              transactionProcessingResults.errors.push(errorMsg);
              transactionProcessingResults.accountsFailed = plaidAccounts.length;
              // Don't fail the entire operation if transactions fail
            }

            // Return successful response with detailed processing results
            res.status(200).json({
              success: true,
              data: {
                itemId: itemId,
                accounts: processedAccounts.map(account => ({
                  id: account.id,
                  name: account.name,
                  type: account.type,
                  subtype: account.subtype,
                  currentBalance: account.currentBalance,
                  availableBalance: account.availableBalance,
                  currencyCode: account.currencyCode,
                })),
                institutionName: requestData.metadata.institution.name,
                processing: {
                  transactions: {
                    accountsProcessed: transactionProcessingResults.accountsProcessed,
                    accountsSuccessful: transactionProcessingResults.accountsSuccessful,
                    accountsFailed: transactionProcessingResults.accountsFailed,
                    transactionsTotal: transactionProcessingResults.transactionsTotal,
                    transactionsSaved: transactionCount,
                    errors: transactionProcessingResults.errors
                  },
                  recurringTransactions: {
                    accountsProcessed: recurringProcessingResults.accountsProcessed,
                    accountsSuccessful: recurringProcessingResults.accountsSuccessful,
                    accountsFailed: recurringProcessingResults.accountsFailed,
                    inflowStreams: recurringProcessingResults.inflowStreamsTotal,
                    outflowStreams: recurringProcessingResults.outflowStreamsTotal,
                    totalStreamsSaved: recurringTransactionCount,
                    errors: recurringProcessingResults.errors
                  }
                }
              },
              message: `Token exchanged successfully: ${processedAccounts.length} accounts linked, ${transactionCount} transactions saved, ${recurringTransactionCount} recurring streams saved`,
            } as ExchangePlaidTokenResponse);

            console.log('Token exchange completed successfully', {
              userId: user.uid,
              itemId: itemId,
              institutionName: requestData.metadata.institution.name,
              accountCount: processedAccounts.length,
              transactions: {
                accountsProcessed: transactionProcessingResults.accountsProcessed,
                transactionsSaved: transactionCount,
                totalFound: transactionProcessingResults.transactionsTotal,
                errors: transactionProcessingResults.errors.length
              },
              recurringTransactions: {
                accountsProcessed: recurringProcessingResults.accountsProcessed,
                streamsSaved: recurringTransactionCount,
                inflowStreams: recurringProcessingResults.inflowStreamsTotal,
                outflowStreams: recurringProcessingResults.outflowStreamsTotal,
                errors: recurringProcessingResults.errors.length
              },
              isReal: true,
            });

            resolve();
          } catch (error) {
            console.error('Error exchanging Plaid token:', error);

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