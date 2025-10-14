/**
 * Debug Transaction Matching - Admin Function
 *
 * Helps debug why transactions aren't being matched to outflow periods.
 * Checks:
 * - What transaction IDs are stored in the outflow
 * - Whether those documents exist in the transactions collection
 * - What the actual document IDs are
 *
 * Usage: GET /debugTransactionMatching?outflowId=OUTFLOW_ID
 */

import { onRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

export const debugTransactionMatching = onRequest(
  {
    memory: '256MiB',
    timeoutSeconds: 60,
  },
  async (req, res) => {
    try {
      const { outflowId } = req.query;

      if (!outflowId || typeof outflowId !== 'string') {
        res.status(400).json({ error: 'outflowId query parameter is required' });
        return;
      }

      const db = admin.firestore();

      // Get the outflow document
      const outflowDoc = await db.collection('outflows').doc(outflowId).get();

      if (!outflowDoc.exists) {
        res.status(404).json({ error: `Outflow ${outflowId} not found` });
        return;
      }

      const outflowData = outflowDoc.data();
      const transactionIds = outflowData?.transactionIds || [];

      console.log(`[debugTransactionMatching] Outflow ${outflowId} has ${transactionIds.length} transaction IDs`);

      // Check each transaction ID
      const results = [];
      for (const txnId of transactionIds) {
        console.log(`[debugTransactionMatching] Checking transaction ID: ${txnId}`);

        // Try to fetch transaction directly by ID
        const txnDoc = await db.collection('transactions').doc(txnId).get();

        if (txnDoc.exists) {
          const txnData = txnDoc.data();
          results.push({
            plaidTransactionId: txnId,
            documentExists: true,
            documentId: txnDoc.id,
            userId: txnData?.userId,
            amount: txnData?.amount,
            description: txnData?.description,
            date: txnData?.date?.toDate(),
            splits: txnData?.splits?.length || 0,
            metadata: {
              plaidTransactionId: txnData?.metadata?.plaidTransactionId,
              source: txnData?.metadata?.source
            }
          });
        } else {
          // Try to find by metadata.plaidTransactionId
          const querySnapshot = await db.collection('transactions')
            .where('metadata.plaidTransactionId', '==', txnId)
            .where('userId', '==', outflowData?.userId)
            .limit(1)
            .get();

          if (!querySnapshot.empty) {
            const foundDoc = querySnapshot.docs[0];
            const foundData = foundDoc.data();
            results.push({
              plaidTransactionId: txnId,
              documentExists: false,
              foundViaQuery: true,
              documentId: foundDoc.id,
              userId: foundData.userId,
              amount: foundData.amount,
              description: foundData.description,
              date: foundData.date?.toDate(),
              splits: foundData.splits?.length || 0,
              metadata: {
                plaidTransactionId: foundData.metadata?.plaidTransactionId,
                source: foundData.metadata?.source
              },
              issue: 'Transaction ID in outflow.transactionIds does not match document ID'
            });
          } else {
            results.push({
              plaidTransactionId: txnId,
              documentExists: false,
              foundViaQuery: false,
              issue: 'Transaction not found in database at all'
            });
          }
        }
      }

      // Get summary statistics
      const summary = {
        totalTransactionIds: transactionIds.length,
        foundAsDocumentId: results.filter(r => r.documentExists).length,
        foundViaQuery: results.filter(r => r.foundViaQuery).length,
        notFound: results.filter(r => !r.documentExists && !r.foundViaQuery).length
      };

      res.status(200).json({
        outflowId,
        outflowDescription: outflowData?.description || outflowData?.merchantName,
        userId: outflowData?.userId,
        summary,
        transactionDetails: results,
        diagnosis: summary.foundViaQuery > 0
          ? '⚠️ ISSUE FOUND: Transaction IDs in outflow.transactionIds do not match document IDs. Old transactions may have been created with auto-generated IDs instead of Plaid transaction IDs.'
          : summary.foundAsDocumentId === summary.totalTransactionIds
            ? '✅ ALL GOOD: All transaction IDs match document IDs correctly'
            : '❌ MISSING TRANSACTIONS: Some transactions do not exist in database'
      });

    } catch (error: any) {
      console.error('[debugTransactionMatching] Error:', error);
      res.status(500).json({
        error: error.message || 'Failed to debug transaction matching',
        stack: error.stack
      });
    }
  }
);
