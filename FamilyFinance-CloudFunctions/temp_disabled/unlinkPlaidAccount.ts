import { onRequest } from "firebase-functions/v2/https";
import { getFirestore, Timestamp, FieldValue } from "firebase-admin/firestore";
import { Configuration, PlaidApi, PlaidEnvironments, ItemRemoveRequest } from "plaid";
import { 
  UserRole,
  PlaidItem,
  PlaidAccount,
  PlaidTransaction,
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
 * Unlink Plaid account and remove all associated data
 * Safely disconnects bank account and cleans up all related transactions and data
 */
export const unlinkPlaidAccount = onRequest({
  region: "us-central1",
  memory: "512MiB",
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

      // Validate request body
      const { itemId, confirmUnlink = false, preserveTransactions = false } = request.body;

      if (!itemId) {
        return response.status(400).json(
          createErrorResponse("invalid-request", "Missing required field: itemId")
        );
      }

      if (!confirmUnlink) {
        return response.status(400).json(
          createErrorResponse(
            "confirmation-required", 
            "Account unlinking requires explicit confirmation. Set confirmUnlink: true"
          )
        );
      }

      // Use Promise wrapping pattern as requested
      function unlinkAccountProcess(resolve: Function, reject: Function) {
        (async () => {
          try {
            // Step 1: Verify user owns this Plaid item
            const itemQuery = await db.collection('plaid_items')
              .where('itemId', '==', itemId)
              .where('userId', '==', user.id!)
              .limit(1)
              .get();

            if (itemQuery.empty) {
              reject({
                success: false,
                error: {
                  code: "item-not-found",
                  message: "Plaid item not found or you don't have permission to unlink it"
                }
              });
              return;
            }

            const itemDoc = itemQuery.docs[0];
            const itemData = itemDoc.data() as PlaidItem;

            // Step 2: Get all accounts for this item
            const accountsQuery = await db.collection('plaid_accounts')
              .where('itemId', '==', itemId)
              .get();

            const accounts = accountsQuery.docs.map(doc => ({
              id: doc.id,
              data: doc.data() as PlaidAccount
            }));

            // Step 3: Get transaction count for reporting
            const transactionsQuery = await db.collection('plaid_transactions')
              .where('itemId', '==', itemId)
              .get();

            const plaidTransactionCount = transactionsQuery.size;

            // Step 4: Get family transaction count
            const familyTransactionsQuery = await db.collection('transactions')
              .where('metadata.plaidTransactionId', '!=', null)
              .where('userId', '==', user.id!)
              .get();

            const familyTransactions = familyTransactionsQuery.docs.filter(doc => {
              const metadata = doc.data().metadata;
              return metadata && 
                     transactionsQuery.docs.some(ptDoc => 
                       ptDoc.data().transactionId === metadata.plaidTransactionId
                     );
            });

            // Step 5: Remove item from Plaid (if access token is valid)
            let plaidRemovalSuccess = false;
            try {
              const encryptedAccessToken = JSON.parse(itemData.accessToken);
              const accessToken = decryptAccessToken(encryptedAccessToken);

              const removeRequest: ItemRemoveRequest = {
                access_token: accessToken,
              };

              await plaidClient.itemRemove(removeRequest);
              plaidRemovalSuccess = true;
            } catch (plaidError: any) {
              console.warn(`Failed to remove item from Plaid (continuing with local cleanup):`, plaidError.message);
              // Continue with local cleanup even if Plaid removal fails
            }

            // Step 6: Begin cleanup process
            const cleanupResults = {
              itemRemoved: false,
              accountsRemoved: 0,
              plaidTransactionsRemoved: 0,
              familyTransactionsRemoved: 0,
              familyTransactionsPreserved: 0,
              errors: [] as string[]
            };

            // Step 7: Handle family transactions based on user preference
            if (preserveTransactions) {
              // Preserve family transactions but remove Plaid metadata
              for (const familyTransactionDoc of familyTransactions) {
                try {
                  await familyTransactionDoc.ref.update({
                    'metadata.source': 'plaid_disconnected',
                    'metadata.plaidTransactionId': FieldValue.delete(),
                    'metadata.plaidAccountId': FieldValue.delete(),
                    'metadata.disconnectedAt': Timestamp.now(),
                    updatedAt: Timestamp.now()
                  });
                  cleanupResults.familyTransactionsPreserved++;
                } catch (error: any) {
                  console.error(`Error preserving family transaction ${familyTransactionDoc.id}:`, error);
                  cleanupResults.errors.push(`Failed to preserve transaction: ${error.message}`);
                }
              }
            } else {
              // Remove family transactions
              const batchSize = 500; // Firestore batch limit
              for (let i = 0; i < familyTransactions.length; i += batchSize) {
                const batch = db.batch();
                const batchTransactions = familyTransactions.slice(i, i + batchSize);
                
                batchTransactions.forEach(doc => {
                  batch.delete(doc.ref);
                });

                try {
                  await batch.commit();
                  cleanupResults.familyTransactionsRemoved += batchTransactions.length;
                } catch (error: any) {
                  console.error(`Error removing family transactions batch:`, error);
                  cleanupResults.errors.push(`Failed to remove transaction batch: ${error.message}`);
                }
              }
            }

            // Step 8: Remove Plaid transactions
            for (let i = 0; i < transactionsQuery.docs.length; i += 500) {
              const batch = db.batch();
              const batchDocs = transactionsQuery.docs.slice(i, i + 500);
              
              batchDocs.forEach(doc => {
                batch.delete(doc.ref);
              });

              try {
                await batch.commit();
                cleanupResults.plaidTransactionsRemoved += batchDocs.length;
              } catch (error: any) {
                console.error(`Error removing Plaid transactions batch:`, error);
                cleanupResults.errors.push(`Failed to remove Plaid transactions: ${error.message}`);
              }
            }

            // Step 9: Remove accounts
            for (const account of accounts) {
              try {
                await db.collection('plaid_accounts').doc(account.id).delete();
                cleanupResults.accountsRemoved++;
              } catch (error: any) {
                console.error(`Error removing account ${account.id}:`, error);
                cleanupResults.errors.push(`Failed to remove account ${account.data.name}: ${error.message}`);
              }
            }

            // Step 10: Remove item
            try {
              await itemDoc.ref.delete();
              cleanupResults.itemRemoved = true;
            } catch (error: any) {
              console.error(`Error removing item ${itemId}:`, error);
              cleanupResults.errors.push(`Failed to remove item: ${error.message}`);
            }

            // Step 11: Log the unlink event
            await db.collection('plaid_unlink_events').add({
              userId: user.id!,
              familyId: user.familyId,
              itemId: itemId,
              institutionName: itemData.institutionName,
              accountsRemoved: cleanupResults.accountsRemoved,
              plaidTransactionsRemoved: cleanupResults.plaidTransactionsRemoved,
              familyTransactionsRemoved: cleanupResults.familyTransactionsRemoved,
              familyTransactionsPreserved: cleanupResults.familyTransactionsPreserved,
              preserveTransactions: preserveTransactions,
              plaidRemovalSuccess: plaidRemovalSuccess,
              unlinkReason: request.body.reason || 'user_request',
              createdAt: Timestamp.now()
            });

            resolve({
              success: true,
              itemId: itemId,
              institutionName: itemData.institutionName,
              plaidRemovalSuccess: plaidRemovalSuccess,
              cleanup: cleanupResults,
              summary: {
                accountsUnlinked: cleanupResults.accountsRemoved,
                transactionsAffected: preserveTransactions ? 
                  cleanupResults.familyTransactionsPreserved : 
                  cleanupResults.familyTransactionsRemoved,
                transactionsPreserved: preserveTransactions,
                plaidDataRemoved: cleanupResults.plaidTransactionsRemoved
              },
              unlinkedAt: new Date().toISOString()
            });

          } catch (error: any) {
            console.error("Error in unlink account process:", error);
            reject({
              success: false,
              error: {
                code: "unlink-failed",
                message: error.message || "Failed to unlink Plaid account"
              }
            });
          }
        })();
      }

      // Execute with Promise wrapper
      const result = await new Promise(unlinkAccountProcess);

      if (result.success) {
        return response.status(200).json(createSuccessResponse(result));
      } else {
        return response.status(400).json(result);
      }

    } catch (error: any) {
      console.error("Error in unlinkPlaidAccount:", error);
      return response.status(500).json(
        createErrorResponse("internal-error", "Failed to unlink Plaid account")
      );
    }
  });
});

/**
 * Get unlink preview to show user what will be affected
 * This is a separate helper function that can be called before unlinking
 */
export const getUnlinkPreview = onRequest({
  region: "us-central1",
  memory: "256MiB",
  timeoutSeconds: 30,
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
      const authResult = await authMiddleware(request, UserRole.VIEWER);
      if (!authResult.success || !authResult.user) {
        return response.status(401).json(authResult.error);
      }

      const { user } = authResult;
      const { itemId } = request.body;

      if (!itemId) {
        return response.status(400).json(
          createErrorResponse("invalid-request", "Missing required field: itemId")
        );
      }

      // Use Promise wrapping pattern
      function getPreviewProcess(resolve: Function, reject: Function) {
        (async () => {
          try {
            // Get Plaid item
            const itemQuery = await db.collection('plaid_items')
              .where('itemId', '==', itemId)
              .where('userId', '==', user.id!)
              .limit(1)
              .get();

            if (itemQuery.empty) {
              reject({
                success: false,
                error: {
                  code: "item-not-found",
                  message: "Plaid item not found or you don't have permission to view it"
                }
              });
              return;
            }

            const itemData = itemQuery.docs[0].data() as PlaidItem;

            // Get accounts
            const accountsQuery = await db.collection('plaid_accounts')
              .where('itemId', '==', itemId)
              .get();

            const accounts = accountsQuery.docs.map(doc => {
              const account = doc.data() as PlaidAccount;
              return {
                id: doc.id,
                name: account.name,
                mask: account.mask,
                type: account.type,
                subtype: account.subtype,
                balance: account.balances.current
              };
            });

            // Get transaction counts
            const plaidTransactionsQuery = await db.collection('plaid_transactions')
              .where('itemId', '==', itemId)
              .get();

            const familyTransactionsQuery = await db.collection('transactions')
              .where('userId', '==', user.id!)
              .where('metadata.source', '==', 'plaid')
              .get();

            const familyTransactionsFromThisItem = familyTransactionsQuery.docs.filter(doc => {
              const metadata = doc.data().metadata;
              return metadata && 
                     plaidTransactionsQuery.docs.some(ptDoc => 
                       ptDoc.data().transactionId === metadata.plaidTransactionId
                     );
            });

            resolve({
              success: true,
              preview: {
                institution: {
                  id: itemData.institutionId,
                  name: itemData.institutionName
                },
                accounts: accounts,
                dataImpact: {
                  accountsToRemove: accounts.length,
                  plaidTransactionsToRemove: plaidTransactionsQuery.size,
                  familyTransactionsAffected: familyTransactionsFromThisItem.length
                },
                options: {
                  preserveTransactions: {
                    description: "Keep your transaction history in the app but disconnect from bank",
                    transactionsKept: familyTransactionsFromThisItem.length,
                    transactionsMarkedAs: "disconnected"
                  },
                  removeTransactions: {
                    description: "Completely remove all transaction history for these accounts",
                    transactionsRemoved: familyTransactionsFromThisItem.length,
                    warning: "This action cannot be undone"
                  }
                }
              }
            });

          } catch (error: any) {
            console.error("Error getting unlink preview:", error);
            reject({
              success: false,
              error: {
                code: "preview-failed",
                message: error.message || "Failed to get unlink preview"
              }
            });
          }
        })();
      }

      // Execute with Promise wrapper
      const result = await new Promise(getPreviewProcess);

      if (result.success) {
        return response.status(200).json(createSuccessResponse(result.preview));
      } else {
        return response.status(400).json(result);
      }

    } catch (error: any) {
      console.error("Error in getUnlinkPreview:", error);
      return response.status(500).json(
        createErrorResponse("internal-error", "Failed to get unlink preview")
      );
    }
  });
});