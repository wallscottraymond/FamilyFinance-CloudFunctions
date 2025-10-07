/**
 * Analyze Transaction Categories
 *
 * Helper function to analyze existing transactions and their categories
 * to help determine which categories to use for testing budget spending updates.
 */

import { onRequest } from 'firebase-functions/v2/https';
import { db } from '../../index';
import { Transaction, TransactionStatus, TransactionType } from '../../types';

export const analyzeTransactionCategories = onRequest({
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 60,
  cors: true
}, async (req, res) => {
  try {
    console.log('📊 Analyzing transaction categories...');

    // Get all approved expense transactions
    const transactionsSnapshot = await db.collection('transactions')
      .where('status', '==', TransactionStatus.APPROVED)
      .where('type', '==', TransactionType.EXPENSE)
      .get();

    console.log(`Found ${transactionsSnapshot.size} approved expense transactions`);

    // Count by category
    const categoryCounts: { [key: string]: number } = {};
    const categorySpending: { [key: string]: number } = {};
    const categoryTransactions: { [key: string]: string[] } = {};

    transactionsSnapshot.forEach(doc => {
      const transaction = { id: doc.id, ...doc.data() } as Transaction;
      const splits = transaction.splits || [];

      splits.forEach(split => {
        const category = split.categoryId || 'uncategorized';

        categoryCounts[category] = (categoryCounts[category] || 0) + 1;
        categorySpending[category] = (categorySpending[category] || 0) + (split.amount || 0);

        if (!categoryTransactions[category]) {
          categoryTransactions[category] = [];
        }
        categoryTransactions[category].push(transaction.description || 'No description');
      });
    });

    // Sort by count
    const sortedCategories = Object.entries(categoryCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([category, count]) => ({
        category,
        transactionCount: count,
        totalSpending: categorySpending[category],
        sampleTransactions: categoryTransactions[category].slice(0, 3)
      }));

    const response = {
      totalTransactions: transactionsSnapshot.size,
      categorySummary: sortedCategories,
      recommendation: sortedCategories.length > 0
        ? `Best category for testing: "${sortedCategories[0].category}" with ${sortedCategories[0].transactionCount} transactions and $${sortedCategories[0].totalSpending.toFixed(2)} total spending`
        : 'No transactions found'
    };

    console.log('Analysis complete:', response);

    res.status(200).json(response);

  } catch (error) {
    console.error('Error analyzing transactions:', error);
    res.status(500).json({
      error: 'Failed to analyze transactions',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});
