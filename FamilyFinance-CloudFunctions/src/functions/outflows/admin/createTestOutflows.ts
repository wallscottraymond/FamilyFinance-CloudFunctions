/**
 * Create Test Outflows - Admin Function
 * Creates sample recurring outflows for testing outflow periods functionality
 */

import { onRequest } from 'firebase-functions/v2/https';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { initializeApp, getApps } from 'firebase-admin/app';
import { RecurringOutflow, PlaidRecurringFrequency } from '../../../types';

// Initialize Firebase Admin if not already initialized
if (getApps().length === 0) {
  initializeApp();
}

const db = getFirestore();

export const createTestOutflows = onRequest({
  cors: true,
  memory: '512MiB',
  timeoutSeconds: 60,
}, async (req, res) => {
  try {
    console.log('🏗️ Creating test outflows...');

    // Get target user ID from query params or use default
    const targetUserId = req.query.userId as string || 'IKzBkwEZb6MdJkdDVnVyTFAFj5i1';
    console.log(`Creating outflows for user: ${targetUserId}`);

    const now = Timestamp.now();
    const futureDate = Timestamp.fromDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)); // 30 days from now

    // Sample outflows to create
    const testOutflows: Omit<RecurringOutflow, 'id'>[] = [
      {
        streamId: 'test-stream-1',
        itemId: 'test-item-1',
        userId: targetUserId,
        familyId: 'test-family-1',
        accountId: 'test-account-1',
        isActive: true,
        status: 'MATURE' as any, // PlaidRecurringTransactionStatus.MATURE
        description: 'Internet Bill',
        merchantName: 'Comcast',
        category: ['Service', 'Telecommunication Services'],
        averageAmount: {
          amount: 89.99,
          isoCurrencyCode: 'USD'
        },
        lastAmount: {
          amount: 89.99,
          isoCurrencyCode: 'USD'
        },
        frequency: PlaidRecurringFrequency.MONTHLY,
        firstDate: Timestamp.fromDate(new Date('2024-01-01')),
        lastDate: futureDate,
        transactionIds: [],
        tags: [],
        isHidden: false,
        lastSyncedAt: now,
        syncVersion: 1,
        expenseType: 'utility',
        isEssential: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        streamId: 'test-stream-2',
        itemId: 'test-item-1',
        userId: targetUserId,
        familyId: 'test-family-1',
        accountId: 'test-account-1',
        isActive: true,
        status: 'MATURE' as any,
        description: 'Spotify Premium',
        merchantName: 'Spotify',
        category: ['Entertainment', 'Music and Audio'],
        averageAmount: {
          amount: 14.99,
          isoCurrencyCode: 'USD'
        },
        lastAmount: {
          amount: 14.99,
          isoCurrencyCode: 'USD'
        },
        frequency: PlaidRecurringFrequency.MONTHLY,
        firstDate: Timestamp.fromDate(new Date('2024-01-15')),
        lastDate: futureDate,
        transactionIds: [],
        tags: [],
        isHidden: false,
        lastSyncedAt: now,
        syncVersion: 1,
        expenseType: 'subscription',
        isEssential: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        streamId: 'test-stream-3',
        itemId: 'test-item-1',
        userId: targetUserId,
        familyId: 'test-family-1',
        accountId: 'test-account-1',
        isActive: true,
        status: 'MATURE' as any,
        description: 'Grocery Budget',
        merchantName: 'Various Stores',
        category: ['Food and Drink', 'Groceries'],
        averageAmount: {
          amount: 125.00,
          isoCurrencyCode: 'USD'
        },
        lastAmount: {
          amount: 125.00,
          isoCurrencyCode: 'USD'
        },
        frequency: PlaidRecurringFrequency.WEEKLY,
        firstDate: Timestamp.fromDate(new Date('2024-01-07')),
        lastDate: futureDate,
        transactionIds: [],
        tags: [],
        isHidden: false,
        lastSyncedAt: now,
        syncVersion: 1,
        expenseType: 'other',
        isEssential: true,
        createdAt: now,
        updatedAt: now,
      }
    ];

    const createdOutflows = [];

    console.log(`Creating ${testOutflows.length} test outflows...`);

    // Create each outflow
    for (const [index, outflowData] of testOutflows.entries()) {
      const outflowRef = db.collection('outflows').doc();
      const outflowWithId = {
        id: outflowRef.id,
        ...outflowData
      };

      await outflowRef.set(outflowWithId);
      createdOutflows.push(outflowWithId);
      
      console.log(`✅ Created outflow ${index + 1}/${testOutflows.length}: ${outflowData.description}`);
      
      // Small delay to ensure the onOutflowCreated trigger has time to process
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log(`🎉 Successfully created ${createdOutflows.length} test outflows!`);

    // Wait a bit more for the outflow periods to be generated
    console.log('⏳ Waiting for outflow periods to be generated...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Check if outflow periods were created
    const outflowPeriodsSnapshot = await db.collection('outflow_periods')
      .where('userId', '==', targetUserId)
      .limit(10)
      .get();

    console.log(`📊 Found ${outflowPeriodsSnapshot.size} outflow periods created for user`);

    res.status(200).json({
      success: true,
      message: `Created ${createdOutflows.length} test outflows and ${outflowPeriodsSnapshot.size} outflow periods`,
      data: {
        targetUserId,
        outflowsCreated: createdOutflows.length,
        outflowPeriodsCreated: outflowPeriodsSnapshot.size,
        outflows: createdOutflows.map(o => ({
          id: o.id,
          description: o.description,
          merchantName: o.merchantName,
          amount: o.averageAmount.amount,
          frequency: o.frequency
        }))
      }
    });

  } catch (error) {
    console.error('❌ Error creating test outflows:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});