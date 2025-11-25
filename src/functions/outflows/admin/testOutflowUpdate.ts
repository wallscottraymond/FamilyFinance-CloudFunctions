/**
 * Test Outflow Update - Admin Function
 *
 * Simulates an outflow update to test the runUpdateOutflowPeriods utility.
 * Updates an outflow's averageAmount and/or userCustomName to trigger the onOutflowUpdated function.
 */

import { onRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

interface TestOutflowUpdateParams {
  outflowId: string;
  newAmount?: number;
  newCustomName?: string;
}

export const testOutflowUpdate = onRequest({
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 60,
}, async (req, res) => {
  console.log('');
  console.log('════════════════════════════════════════════════════');
  console.log('🧪 TEST OUTFLOW UPDATE');
  console.log('════════════════════════════════════════════════════');
  console.log('');

  try {
    const params: TestOutflowUpdateParams = {
      outflowId: req.query.outflowId as string || '',
      newAmount: req.query.newAmount ? parseFloat(req.query.newAmount as string) : undefined,
      newCustomName: req.query.newCustomName as string || undefined,
    };

    console.log('📋 Test Parameters:');
    console.log(`   - Outflow ID: ${params.outflowId}`);
    console.log(`   - New Amount: ${params.newAmount || 'Not changing'}`);
    console.log(`   - New Custom Name: ${params.newCustomName || 'Not changing'}`);
    console.log('');

    if (!params.outflowId) {
      res.status(400).json({
        success: false,
        error: 'Missing required parameter: outflowId',
        usage: '/testOutflowUpdate?outflowId=xxx&newAmount=99.99&newCustomName=MyBill'
      });
      return;
    }

    const db = admin.firestore();

    // Step 1: Fetch the outflow
    console.log('Step 1: Fetching outflow...');
    const outflowRef = db.collection('outflows').doc(params.outflowId);
    const outflowSnap = await outflowRef.get();

    if (!outflowSnap.exists) {
      res.status(404).json({
        success: false,
        error: `Outflow not found: ${params.outflowId}`
      });
      return;
    }

    const outflowData = outflowSnap.data()!;
    console.log(`   ✓ Found outflow: ${outflowData.description}`);
    console.log(`   ✓ Current amount: $${outflowData.averageAmount}`);
    console.log(`   ✓ Current custom name: ${outflowData.userCustomName || '(none)'}`);
    console.log('');

    // Step 2: Build updates
    const updates: any = {
      updatedAt: Timestamp.now()
    };

    if (params.newAmount !== undefined) {
      updates.averageAmount = params.newAmount;
      console.log(`   → Will update averageAmount: $${outflowData.averageAmount} → $${params.newAmount}`);
    }

    if (params.newCustomName !== undefined) {
      updates.userCustomName = params.newCustomName;
      console.log(`   → Will update userCustomName: "${outflowData.userCustomName || '(none)'}" → "${params.newCustomName}"`);
    }

    if (Object.keys(updates).length === 1) {
      res.status(400).json({
        success: false,
        error: 'No updates specified. Provide newAmount and/or newCustomName',
        usage: '/testOutflowUpdate?outflowId=xxx&newAmount=99.99&newCustomName=MyBill'
      });
      return;
    }

    // Step 3: Get outflow periods before update
    console.log('');
    console.log('Step 2: Fetching outflow periods before update...');
    const periodsBeforeSnapshot = await db.collection('outflow_periods')
      .where('outflowId', '==', params.outflowId)
      .get();

    const periodsBefore = periodsBeforeSnapshot.docs.map(doc => ({
      id: doc.id,
      description: doc.data().description,
      averageAmount: doc.data().averageAmount,
      expectedAmount: doc.data().expectedAmount,
      amountWithheld: doc.data().amountWithheld,
      isPaid: doc.data().isPaid,
      isPartiallyPaid: doc.data().isPartiallyPaid,
    }));

    console.log(`   ✓ Found ${periodsBefore.length} periods`);
    periodsBefore.slice(0, 3).forEach(p => {
      console.log(`     - ${p.id}: $${p.expectedAmount} (${p.isPaid ? 'PAID' : p.isPartiallyPaid ? 'PARTIAL' : 'UNPAID'})`);
    });
    if (periodsBefore.length > 3) {
      console.log(`     ... and ${periodsBefore.length - 3} more`);
    }

    // Step 4: Update the outflow (this triggers onOutflowUpdated)
    console.log('');
    console.log('Step 3: Updating outflow (this triggers onOutflowUpdated)...');
    await outflowRef.update(updates);
    console.log('   ✓ Outflow updated!');

    // Step 5: Wait for trigger to complete
    console.log('');
    console.log('Step 4: Waiting 3 seconds for trigger to complete...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Step 6: Get outflow periods after update
    console.log('');
    console.log('Step 5: Fetching outflow periods after update...');
    const periodsAfterSnapshot = await db.collection('outflow_periods')
      .where('outflowId', '==', params.outflowId)
      .get();

    const periodsAfter = periodsAfterSnapshot.docs.map(doc => ({
      id: doc.id,
      description: doc.data().description,
      averageAmount: doc.data().averageAmount,
      expectedAmount: doc.data().expectedAmount,
      amountWithheld: doc.data().amountWithheld,
      isPaid: doc.data().isPaid,
      isPartiallyPaid: doc.data().isPartiallyPaid,
    }));

    console.log(`   ✓ Found ${periodsAfter.length} periods`);

    // Step 7: Compare before/after
    console.log('');
    console.log('Step 6: Comparing before/after...');
    console.log('');

    let changedCount = 0;
    let unchangedCount = 0;

    for (const periodAfter of periodsAfter) {
      const periodBefore = periodsBefore.find(p => p.id === periodAfter.id);
      if (!periodBefore) continue;

      const amountChanged = periodBefore.expectedAmount !== periodAfter.expectedAmount;
      const descChanged = periodBefore.description !== periodAfter.description;

      if (amountChanged || descChanged) {
        changedCount++;
        console.log(`   📝 ${periodAfter.id}:`);
        if (amountChanged) {
          console.log(`      Amount: $${periodBefore.expectedAmount} → $${periodAfter.expectedAmount}`);
        }
        if (descChanged) {
          console.log(`      Description: "${periodBefore.description}" → "${periodAfter.description}"`);
        }
      } else {
        unchangedCount++;
      }
    }

    console.log('');
    console.log('════════════════════════════════════════════════════');
    console.log('📊 RESULTS');
    console.log('════════════════════════════════════════════════════');
    console.log(`   ✓ Periods changed: ${changedCount}`);
    console.log(`   ✓ Periods unchanged: ${unchangedCount}`);
    console.log(`   ✓ Total periods: ${periodsAfter.length}`);
    console.log('');

    res.json({
      success: true,
      outflowId: params.outflowId,
      periodsBefore: periodsBefore.length,
      periodsAfter: periodsAfter.length,
      periodsChanged: changedCount,
      periodsUnchanged: unchangedCount,
      sampleChanges: periodsAfter.slice(0, 5).map(p => ({
        id: p.id,
        expectedAmount: p.expectedAmount,
        description: p.description,
        isPaid: p.isPaid,
      }))
    });

  } catch (error: any) {
    console.error('');
    console.error('❌ ERROR:', error);
    console.error('');
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
