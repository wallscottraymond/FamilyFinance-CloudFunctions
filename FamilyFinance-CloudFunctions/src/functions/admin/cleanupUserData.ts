/**
 * User Data Cleanup Functions
 * 
 * Administrative functions for removing test data during development.
 * These functions delete all user-associated data from various collections.
 * 
 * ⚠️ WARNING: These functions permanently delete data. Use with caution.
 * 
 * Functions:
 * - removeAllUserAccounts: Deletes Plaid items, accounts, and tokens
 * - removeAllUserBudgets: Deletes budgets and budget periods
 * - removeAllUserOutflows: Deletes outflow transactions
 * - removeAllUserInflows: Deletes inflow transactions  
 * - removeAllUserTransactions: Deletes all transactions
 * 
 * Memory: 512MiB, Timeout: 300s (5 minutes)
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { authenticateRequest, UserRole } from '../../utils/auth';
import { queryDocuments, deleteDocument } from '../../utils/firestore';

interface CleanupResponse {
  success: boolean;
  itemsDeleted: number;
  errors: string[];
  message: string;
}

/**
 * Remove all Plaid accounts, items, and associated data for a user
 */
export const removeAllUserAccounts = onCall({
  region: 'us-central1',
  memory: '512MiB',
  timeoutSeconds: 300,
}, async (request): Promise<CleanupResponse> => {
  try {
    // Authenticate user (require VIEWER role for development - will be admin-only in production)
    // Authenticate user (callable function style)
    const { user, userData } = await authenticateRequest(request, UserRole.VIEWER);
    if (!user || !userData) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }
    let totalDeleted = 0;
    const errors: string[] = [];

    console.log(`Starting account cleanup for user ${user.uid}`);

    // Delete Plaid items
    try {
      const plaidItems = await queryDocuments('plaid_items', {
        where: [{ field: 'userId', operator: '==', value: user.uid }]
      });

      for (const item of plaidItems) {
        await deleteDocument('plaid_items', item.id!);
        totalDeleted++;
      }
      console.log(`Deleted ${plaidItems.length} Plaid items`);
    } catch (error) {
      const msg = `Error deleting Plaid items: ${error instanceof Error ? error.message : 'Unknown error'}`;
      errors.push(msg);
      console.error(msg);
    }

    // Delete Plaid accounts
    try {
      const plaidAccounts = await queryDocuments('plaid_accounts', {
        where: [{ field: 'userId', operator: '==', value: user.uid }]
      });

      for (const account of plaidAccounts) {
        await deleteDocument('plaid_accounts', account.id!);
        totalDeleted++;
      }
      console.log(`Deleted ${plaidAccounts.length} Plaid accounts`);
    } catch (error) {
      const msg = `Error deleting Plaid accounts: ${error instanceof Error ? error.message : 'Unknown error'}`;
      errors.push(msg);
      console.error(msg);
    }

    // Delete Plaid transactions (raw data)
    try {
      const plaidTransactions = await queryDocuments('plaid_transactions', {
        where: [{ field: 'userId', operator: '==', value: user.uid }]
      });

      for (const transaction of plaidTransactions) {
        await deleteDocument('plaid_transactions', transaction.id!);
        totalDeleted++;
      }
      console.log(`Deleted ${plaidTransactions.length} raw Plaid transactions`);
    } catch (error) {
      const msg = `Error deleting Plaid transactions: ${error instanceof Error ? error.message : 'Unknown error'}`;
      errors.push(msg);
      console.error(msg);
    }

    // Delete accounts (main accounts collection)
    try {
      const accounts = await queryDocuments('accounts', {
        where: [{ field: 'userId', operator: '==', value: user.uid }]
      });

      for (const account of accounts) {
        await deleteDocument('accounts', account.id!);
        totalDeleted++;
      }
      console.log(`Deleted ${accounts.length} accounts`);
    } catch (error) {
      const msg = `Error deleting accounts: ${error instanceof Error ? error.message : 'Unknown error'}`;
      errors.push(msg);
      console.error(msg);
    }

    return {
      success: errors.length === 0,
      itemsDeleted: totalDeleted,
      errors,
      message: `Account cleanup completed. Deleted ${totalDeleted} items${errors.length > 0 ? ` with ${errors.length} errors` : ''}.`
    };

  } catch (error) {
    console.error('Error in removeAllUserAccounts:', error);
    
    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError('internal', `Account cleanup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});

/**
 * Remove all budgets and budget periods for a user
 */
export const removeAllUserBudgets = onCall({
  region: 'us-central1',
  memory: '512MiB',
  timeoutSeconds: 300,
}, async (request): Promise<CleanupResponse> => {
  try {
    // Authenticate user (callable function style)
    const { user, userData } = await authenticateRequest(request, UserRole.VIEWER);
    if (!user || !userData) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }
    let totalDeleted = 0;
    const errors: string[] = [];

    console.log(`Starting budget cleanup for user ${user.uid}`);

    // Delete budgets
    try {
      const budgets = await queryDocuments('budgets', {
        where: [{ field: 'userId', operator: '==', value: user.uid }]
      });

      for (const budget of budgets) {
        await deleteDocument('budgets', budget.id!);
        totalDeleted++;
      }
      console.log(`Deleted ${budgets.length} budgets`);
    } catch (error) {
      const msg = `Error deleting budgets: ${error instanceof Error ? error.message : 'Unknown error'}`;
      errors.push(msg);
      console.error(msg);
    }

    // Delete budget periods
    try {
      const budgetPeriods = await queryDocuments('budget_periods', {
        where: [{ field: 'userId', operator: '==', value: user.uid }]
      });

      for (const period of budgetPeriods) {
        await deleteDocument('budget_periods', period.id!);
        totalDeleted++;
      }
      console.log(`Deleted ${budgetPeriods.length} budget periods`);
    } catch (error) {
      const msg = `Error deleting budget periods: ${error instanceof Error ? error.message : 'Unknown error'}`;
      errors.push(msg);
      console.error(msg);
    }

    return {
      success: errors.length === 0,
      itemsDeleted: totalDeleted,
      errors,
      message: `Budget cleanup completed. Deleted ${totalDeleted} items${errors.length > 0 ? ` with ${errors.length} errors` : ''}.`
    };

  } catch (error) {
    console.error('Error in removeAllUserBudgets:', error);
    
    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError('internal', `Budget cleanup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});

/**
 * Remove all outflow transactions for a user
 */
export const removeAllUserOutflows = onCall({
  region: 'us-central1',
  memory: '512MiB',
  timeoutSeconds: 300,
}, async (request): Promise<CleanupResponse> => {
  try {
    // Authenticate user (callable function style)
    const { user, userData } = await authenticateRequest(request, UserRole.VIEWER);
    if (!user || !userData) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }
    let totalDeleted = 0;
    const errors: string[] = [];

    console.log(`Starting outflow cleanup for user ${user.uid}`);

    // Delete outflows
    try {
      const outflows = await queryDocuments('outflows', {
        where: [{ field: 'userId', operator: '==', value: user.uid }]
      });

      for (const outflow of outflows) {
        await deleteDocument('outflows', outflow.id!);
        totalDeleted++;
      }
      console.log(`Deleted ${outflows.length} outflows`);
    } catch (error) {
      const msg = `Error deleting outflows: ${error instanceof Error ? error.message : 'Unknown error'}`;
      errors.push(msg);
      console.error(msg);
    }

    // Delete outflow periods
    try {
      const outflowPeriods = await queryDocuments('outflow_periods', {
        where: [{ field: 'userId', operator: '==', value: user.uid }]
      });

      for (const period of outflowPeriods) {
        await deleteDocument('outflow_periods', period.id!);
        totalDeleted++;
      }
      console.log(`Deleted ${outflowPeriods.length} outflow periods`);
    } catch (error) {
      const msg = `Error deleting outflow periods: ${error instanceof Error ? error.message : 'Unknown error'}`;
      errors.push(msg);
      console.error(msg);
    }

    return {
      success: errors.length === 0,
      itemsDeleted: totalDeleted,
      errors,
      message: `Outflow cleanup completed. Deleted ${totalDeleted} items${errors.length > 0 ? ` with ${errors.length} errors` : ''}.`
    };

  } catch (error) {
    console.error('Error in removeAllUserOutflows:', error);
    
    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError('internal', `Outflow cleanup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});

/**
 * Remove all inflow transactions for a user
 */
export const removeAllUserInflows = onCall({
  region: 'us-central1',
  memory: '512MiB',
  timeoutSeconds: 300,
}, async (request): Promise<CleanupResponse> => {
  try {
    // Authenticate user (callable function style)
    const { user, userData } = await authenticateRequest(request, UserRole.VIEWER);
    if (!user || !userData) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }
    let totalDeleted = 0;
    const errors: string[] = [];

    console.log(`Starting inflow cleanup for user ${user.uid}`);

    // Delete inflows
    try {
      const inflows = await queryDocuments('inflows', {
        where: [{ field: 'userId', operator: '==', value: user.uid }]
      });

      for (const inflow of inflows) {
        await deleteDocument('inflows', inflow.id!);
        totalDeleted++;
      }
      console.log(`Deleted ${inflows.length} inflows`);
    } catch (error) {
      const msg = `Error deleting inflows: ${error instanceof Error ? error.message : 'Unknown error'}`;
      errors.push(msg);
      console.error(msg);
    }

    // Delete inflow periods  
    try {
      const inflowPeriods = await queryDocuments('inflow_periods', {
        where: [{ field: 'userId', operator: '==', value: user.uid }]
      });

      for (const period of inflowPeriods) {
        await deleteDocument('inflow_periods', period.id!);
        totalDeleted++;
      }
      console.log(`Deleted ${inflowPeriods.length} inflow periods`);
    } catch (error) {
      const msg = `Error deleting inflow periods: ${error instanceof Error ? error.message : 'Unknown error'}`;
      errors.push(msg);
      console.error(msg);
    }

    return {
      success: errors.length === 0,
      itemsDeleted: totalDeleted,
      errors,
      message: `Inflow cleanup completed. Deleted ${totalDeleted} items${errors.length > 0 ? ` with ${errors.length} errors` : ''}.`
    };

  } catch (error) {
    console.error('Error in removeAllUserInflows:', error);
    
    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError('internal', `Inflow cleanup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});

/**
 * Remove all transactions for a user (including manual and Plaid transactions)
 */
export const removeAllUserTransactions = onCall({
  region: 'us-central1',
  memory: '512MiB',
  timeoutSeconds: 300,
}, async (request): Promise<CleanupResponse> => {
  try {
    // Authenticate user (callable function style)
    const { user, userData } = await authenticateRequest(request, UserRole.VIEWER);
    if (!user || !userData) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }
    let totalDeleted = 0;
    const errors: string[] = [];

    console.log(`Starting transaction cleanup for user ${user.uid}`);

    try {
      // Get all transactions for the user in batches (Firestore limit)
      let hasMore = true;
      let batchCount = 0;

      while (hasMore) {
        const transactions = await queryDocuments('transactions', {
          where: [{ field: 'userId', operator: '==', value: user.uid }],
          limit: 100 // Process in batches to avoid timeouts
        });

        if (transactions.length === 0) {
          hasMore = false;
          break;
        }

        for (const transaction of transactions) {
          await deleteDocument('transactions', transaction.id!);
          totalDeleted++;
        }

        batchCount++;
        console.log(`Processed batch ${batchCount}, deleted ${transactions.length} transactions`);

        // If we got fewer than the limit, we're done
        if (transactions.length < 100) {
          hasMore = false;
        }
      }

      console.log(`Deleted ${totalDeleted} total transactions`);
    } catch (error) {
      const msg = `Error deleting transactions: ${error instanceof Error ? error.message : 'Unknown error'}`;
      errors.push(msg);
      console.error(msg);
    }

    return {
      success: errors.length === 0,
      itemsDeleted: totalDeleted,
      errors,
      message: `Transaction cleanup completed. Deleted ${totalDeleted} items${errors.length > 0 ? ` with ${errors.length} errors` : ''}.`
    };

  } catch (error) {
    console.error('Error in removeAllUserTransactions:', error);
    
    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError('internal', `Transaction cleanup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});

/**
 * Nuclear option: Remove ALL user data across all collections
 */
export const removeAllUserData = onCall({
  region: 'us-central1',
  memory: '1GiB',
  timeoutSeconds: 540, // 9 minutes - maximum allowed
}, async (request): Promise<CleanupResponse> => {
  try {
    // Authenticate user (callable function style)
    const { user, userData } = await authenticateRequest(request, UserRole.VIEWER);
    if (!user || !userData) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }
    let totalDeleted = 0;
    const errors: string[] = [];

    console.log(`🚨 NUCLEAR CLEANUP: Starting complete data cleanup for user ${user.uid}`);

    // Collection cleanup order (important for referential integrity)
    const collections = [
      'plaid_transactions',
      'plaid_accounts', 
      'plaid_items',
      'accounts',
      'transactions',
      'outflow_periods',
      'outflows',
      'inflow_periods',
      'inflows',
      'budget_periods',
      'budgets'
    ];

    for (const collection of collections) {
      try {
        console.log(`Cleaning ${collection}...`);
        
        let hasMore = true;
        let batchCount = 0;

        while (hasMore) {
          const items = await queryDocuments(collection, {
            where: [{ field: 'userId', operator: '==', value: user.uid }],
            limit: 100
          });

          if (items.length === 0) {
            hasMore = false;
            break;
          }

          for (const item of items) {
            await deleteDocument(collection, item.id!);
            totalDeleted++;
          }

          batchCount++;
          console.log(`${collection}: processed batch ${batchCount}, deleted ${items.length} items`);

          if (items.length < 100) {
            hasMore = false;
          }
        }
      } catch (error) {
        const msg = `Error cleaning ${collection}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        errors.push(msg);
        console.error(msg);
      }
    }

    return {
      success: errors.length === 0,
      itemsDeleted: totalDeleted,
      errors,
      message: `🚨 NUCLEAR CLEANUP completed. Deleted ${totalDeleted} total items${errors.length > 0 ? ` with ${errors.length} errors` : ''}.`
    };

  } catch (error) {
    console.error('Error in removeAllUserData:', error);
    
    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError('internal', `Complete cleanup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});