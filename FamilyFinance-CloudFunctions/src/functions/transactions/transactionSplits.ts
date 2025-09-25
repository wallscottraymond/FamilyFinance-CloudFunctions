/**
 * Transaction Splitting Management
 * 
 * This module provides Cloud Functions for managing transaction splits across multiple budgets.
 * Allows users to allocate portions of a single transaction to different budget categories.
 * 
 * Features:
 * - Add new splits to existing transactions
 * - Update existing splits (amount, budget assignment, category)
 * - Delete splits from transactions
 * - Automatic validation to ensure split totals don't exceed transaction amount
 * - Real-time budget period and budget ID tracking for efficient queries
 * 
 * Security: Only transaction owners can modify their transaction splits
 * Memory: 512MiB, Timeout: 30s
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { 
  Transaction, 
  TransactionSplit, 
  AddTransactionSplitRequest,
  UpdateTransactionSplitRequest,
  DeleteTransactionSplitRequest,
  TransactionSplitResponse
} from '../../types';

/**
 * Add a new split to an existing transaction
 */
export const addTransactionSplit = onCall({
  region: 'us-central1',
  memory: '512MiB',
  timeoutSeconds: 30,
}, async (request) => {
  try {
    // Validate authentication
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }
    const user = request.auth;
    const { transactionId, budgetId, budgetPeriodId, amount, categoryId, description } = request.data as AddTransactionSplitRequest;

    // Validate required parameters
    if (!transactionId || !budgetId || !budgetPeriodId || typeof amount !== 'number' || amount <= 0) {
      throw new HttpsError('invalid-argument', 'transactionId, budgetId, budgetPeriodId, and positive amount are required');
    }

    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();

    // Get transaction to verify ownership and validate split
    const transactionRef = db.collection('transactions').doc(transactionId);
    const transactionDoc = await transactionRef.get();
    
    if (!transactionDoc.exists) {
      throw new HttpsError('not-found', 'Transaction not found');
    }

    const transactionData = transactionDoc.data() as Transaction;
    
    // Check if user owns this transaction
    if (transactionData.userId !== user.uid) {
      throw new HttpsError('permission-denied', 'You can only modify your own transactions');
    }

    // Validate that adding this split won't exceed transaction amount
    const currentAllocated = transactionData.totalAllocated || 0;
    const newTotalAllocated = currentAllocated + amount;
    
    if (newTotalAllocated > transactionData.amount) {
      throw new HttpsError('invalid-argument', 
        `Split amount would exceed transaction total. Available: ${transactionData.amount - currentAllocated}, Requested: ${amount}`);
    }

    // Get budget period info for denormalization
    const budgetPeriodDoc = await db.collection('budget_periods').doc(budgetPeriodId).get();
    if (!budgetPeriodDoc.exists) {
      throw new HttpsError('not-found', 'Budget period not found');
    }
    const budgetPeriodData = budgetPeriodDoc.data()!;

    // Verify user has access to this budget period
    if (budgetPeriodData.userId !== user.uid && budgetPeriodData.familyId !== transactionData.familyId) {
      throw new HttpsError('permission-denied', 'You do not have access to this budget period');
    }

    // Generate unique ID for the split
    const splitId = db.collection('_dummy').doc().id;
    
    // Create new split
    const newSplit: TransactionSplit = {
      id: splitId,
      budgetId,
      budgetPeriodId,
      budgetName: budgetPeriodData.budgetName,
      categoryId: categoryId || transactionData.category,
      amount,
      description: description || undefined,
      isDefault: false, // User-created splits are never default
      createdAt: now,
      updatedAt: now,
      createdBy: user.uid,
    };

    // Update transaction with new split
    const updatedSplits = [...(transactionData.splits || []), newSplit];
    const updatedTotalAllocated = newTotalAllocated;
    const updatedUnallocated = transactionData.amount - updatedTotalAllocated;
    
    // Update affected budget arrays
    const affectedBudgets = Array.from(new Set([
      ...(transactionData.affectedBudgets || []),
      budgetId
    ]));
    
    const affectedBudgetPeriods = Array.from(new Set([
      ...(transactionData.affectedBudgetPeriods || []),
      budgetPeriodId
    ]));

    // Determine primary budget (largest split amount)
    const primarySplit = updatedSplits.reduce((max, split) => 
      split.amount > max.amount ? split : max
    );

    await transactionRef.update({
      splits: updatedSplits,
      isSplit: updatedSplits.length > 1 || updatedSplits.some(s => !s.isDefault),
      totalAllocated: updatedTotalAllocated,
      unallocated: updatedUnallocated,
      affectedBudgets,
      affectedBudgetPeriods,
      primaryBudgetId: primarySplit.budgetId,
      primaryBudgetPeriodId: primarySplit.budgetPeriodId,
      updatedAt: now,
    });

    console.log(`Added split ${splitId} to transaction ${transactionId}: ${amount} to budget ${budgetId}`);

    // Return updated transaction data
    const updatedTransaction = {
      ...transactionData,
      splits: updatedSplits,
      isSplit: updatedSplits.length > 1 || updatedSplits.some(s => !s.isDefault),
      totalAllocated: updatedTotalAllocated,
      unallocated: updatedUnallocated,
      affectedBudgets,
      affectedBudgetPeriods,
      primaryBudgetId: primarySplit.budgetId,
      primaryBudgetPeriodId: primarySplit.budgetPeriodId,
      updatedAt: now,
    };

    return {
      success: true,
      split: newSplit,
      transaction: updatedTransaction,
      message: 'Transaction split added successfully',
    } as TransactionSplitResponse;

  } catch (error) {
    console.error('Error adding transaction split:', error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError('internal', 'Failed to add transaction split');
  }
});

/**
 * Update an existing transaction split
 */
export const updateTransactionSplit = onCall({
  region: 'us-central1',
  memory: '512MiB',
  timeoutSeconds: 30,
}, async (request) => {
  try {
    // Validate authentication
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }
    const user = request.auth;
    const { transactionId, splitId, budgetId, budgetPeriodId, amount, categoryId, description } = request.data as UpdateTransactionSplitRequest;

    // Validate required parameters
    if (!transactionId || !splitId) {
      throw new HttpsError('invalid-argument', 'transactionId and splitId are required');
    }

    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();

    // Get transaction to verify ownership
    const transactionRef = db.collection('transactions').doc(transactionId);
    const transactionDoc = await transactionRef.get();
    
    if (!transactionDoc.exists) {
      throw new HttpsError('not-found', 'Transaction not found');
    }

    const transactionData = transactionDoc.data() as Transaction;
    
    // Check if user owns this transaction
    if (transactionData.userId !== user.uid) {
      throw new HttpsError('permission-denied', 'You can only modify your own transactions');
    }

    // Find the split to update
    const splitIndex = transactionData.splits.findIndex(split => split.id === splitId);
    if (splitIndex === -1) {
      throw new HttpsError('not-found', 'Transaction split not found');
    }

    const currentSplit = transactionData.splits[splitIndex];
    
    // If amount is being changed, validate the new total
    if (amount !== undefined) {
      const otherSplitsTotal = transactionData.splits
        .filter(split => split.id !== splitId)
        .reduce((sum, split) => sum + split.amount, 0);
      
      const newTotalAllocated = otherSplitsTotal + amount;
      
      if (newTotalAllocated > transactionData.amount) {
        throw new HttpsError('invalid-argument', 
          `Split amount would exceed transaction total. Available: ${transactionData.amount - otherSplitsTotal}, Requested: ${amount}`);
      }
    }

    // Get budget period info if budgetPeriodId is being changed
    let budgetName = currentSplit.budgetName;
    if (budgetPeriodId && budgetPeriodId !== currentSplit.budgetPeriodId) {
      const budgetPeriodDoc = await db.collection('budget_periods').doc(budgetPeriodId).get();
      if (!budgetPeriodDoc.exists) {
        throw new HttpsError('not-found', 'Budget period not found');
      }
      const budgetPeriodData = budgetPeriodDoc.data()!;

      // Verify user has access to this budget period
      if (budgetPeriodData.userId !== user.uid && budgetPeriodData.familyId !== transactionData.familyId) {
        throw new HttpsError('permission-denied', 'You do not have access to this budget period');
      }
      
      budgetName = budgetPeriodData.budgetName;
    }

    // Update the split
    const updatedSplit: TransactionSplit = {
      ...currentSplit,
      budgetId: budgetId !== undefined ? budgetId : currentSplit.budgetId,
      budgetPeriodId: budgetPeriodId !== undefined ? budgetPeriodId : currentSplit.budgetPeriodId,
      budgetName,
      categoryId: categoryId !== undefined ? categoryId : currentSplit.categoryId,
      amount: amount !== undefined ? amount : currentSplit.amount,
      description: description !== undefined ? description : currentSplit.description,
      updatedAt: now,
    };

    // Update splits array
    const updatedSplits = [...transactionData.splits];
    updatedSplits[splitIndex] = updatedSplit;
    
    const updatedTotalAllocated = updatedSplits.reduce((sum, split) => sum + split.amount, 0);
    const updatedUnallocated = transactionData.amount - updatedTotalAllocated;
    
    // Update affected budget arrays
    const affectedBudgets = Array.from(new Set(updatedSplits.map(split => split.budgetId)));
    const affectedBudgetPeriods = Array.from(new Set(updatedSplits.map(split => split.budgetPeriodId)));

    // Determine primary budget (largest split amount)
    const primarySplit = updatedSplits.reduce((max, split) => 
      split.amount > max.amount ? split : max
    );

    await transactionRef.update({
      splits: updatedSplits,
      totalAllocated: updatedTotalAllocated,
      unallocated: updatedUnallocated,
      affectedBudgets,
      affectedBudgetPeriods,
      primaryBudgetId: primarySplit.budgetId,
      primaryBudgetPeriodId: primarySplit.budgetPeriodId,
      updatedAt: now,
    });

    console.log(`Updated split ${splitId} in transaction ${transactionId}`);

    // Return updated transaction data
    const updatedTransaction = {
      ...transactionData,
      splits: updatedSplits,
      totalAllocated: updatedTotalAllocated,
      unallocated: updatedUnallocated,
      affectedBudgets,
      affectedBudgetPeriods,
      primaryBudgetId: primarySplit.budgetId,
      primaryBudgetPeriodId: primarySplit.budgetPeriodId,
      updatedAt: now,
    };

    return {
      success: true,
      split: updatedSplit,
      transaction: updatedTransaction,
      message: 'Transaction split updated successfully',
    } as TransactionSplitResponse;

  } catch (error) {
    console.error('Error updating transaction split:', error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError('internal', 'Failed to update transaction split');
  }
});

/**
 * Delete a transaction split
 */
export const deleteTransactionSplit = onCall({
  region: 'us-central1',
  memory: '512MiB',
  timeoutSeconds: 30,
}, async (request) => {
  try {
    // Validate authentication
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }
    const user = request.auth;
    const { transactionId, splitId } = request.data as DeleteTransactionSplitRequest;

    // Validate required parameters
    if (!transactionId || !splitId) {
      throw new HttpsError('invalid-argument', 'transactionId and splitId are required');
    }

    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();

    // Get transaction to verify ownership
    const transactionRef = db.collection('transactions').doc(transactionId);
    const transactionDoc = await transactionRef.get();
    
    if (!transactionDoc.exists) {
      throw new HttpsError('not-found', 'Transaction not found');
    }

    const transactionData = transactionDoc.data() as Transaction;
    
    // Check if user owns this transaction
    if (transactionData.userId !== user.uid) {
      throw new HttpsError('permission-denied', 'You can only modify your own transactions');
    }

    // Find the split to delete
    const splitIndex = transactionData.splits.findIndex(split => split.id === splitId);
    if (splitIndex === -1) {
      throw new HttpsError('not-found', 'Transaction split not found');
    }

    // Prevent deletion if this is the only split
    if (transactionData.splits.length === 1) {
      throw new HttpsError('invalid-argument', 'Cannot delete the only remaining split. A transaction must have at least one split.');
    }

    // Remove the split
    const updatedSplits = transactionData.splits.filter(split => split.id !== splitId);
    const updatedTotalAllocated = updatedSplits.reduce((sum, split) => sum + split.amount, 0);
    const updatedUnallocated = transactionData.amount - updatedTotalAllocated;
    
    // Update affected budget arrays
    const affectedBudgets = Array.from(new Set(updatedSplits.map(split => split.budgetId)));
    const affectedBudgetPeriods = Array.from(new Set(updatedSplits.map(split => split.budgetPeriodId)));

    // Determine primary budget (largest split amount)
    const primarySplit = updatedSplits.reduce((max, split) => 
      split.amount > max.amount ? split : max
    );

    await transactionRef.update({
      splits: updatedSplits,
      isSplit: updatedSplits.length > 1 || updatedSplits.some(s => !s.isDefault),
      totalAllocated: updatedTotalAllocated,
      unallocated: updatedUnallocated,
      affectedBudgets,
      affectedBudgetPeriods,
      primaryBudgetId: primarySplit.budgetId,
      primaryBudgetPeriodId: primarySplit.budgetPeriodId,
      updatedAt: now,
    });

    console.log(`Deleted split ${splitId} from transaction ${transactionId}`);

    // Return updated transaction data
    const updatedTransaction = {
      ...transactionData,
      splits: updatedSplits,
      isSplit: updatedSplits.length > 1 || updatedSplits.some(s => !s.isDefault),
      totalAllocated: updatedTotalAllocated,
      unallocated: updatedUnallocated,
      affectedBudgets,
      affectedBudgetPeriods,
      primaryBudgetId: primarySplit.budgetId,
      primaryBudgetPeriodId: primarySplit.budgetPeriodId,
      updatedAt: now,
    };

    return {
      success: true,
      transaction: updatedTransaction,
      message: 'Transaction split deleted successfully',
    } as TransactionSplitResponse;

  } catch (error) {
    console.error('Error deleting transaction split:', error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError('internal', 'Failed to delete transaction split');
  }
});