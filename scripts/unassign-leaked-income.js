/**
 * Targeted cleanup: unassign income splits that leaked into a budget.
 * For each income transaction, any NON-manual split currently pointing at a
 * budget is reset to 'unassigned' — matching what the fixed assignment engine
 * now computes for income. The onTransactionUpdate trigger then reverses that
 * income out of the budget's spend.
 *
 * Idempotent (skips already-unassigned + manual splits).
 *
 * Usage:
 *   node scripts/unassign-leaked-income.js <uid>            # DRY RUN (no writes)
 *   node scripts/unassign-leaked-income.js <uid> --commit   # apply
 */
const admin = require('firebase-admin');
const KEY =
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  `${process.env.HOME}/google-service-account-key.json`;

const uid = process.argv[2];
const COMMIT = process.argv[3] === '--commit';
if (!uid) {
  console.error('Usage: node scripts/unassign-leaked-income.js <uid> [--commit]');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(require(KEY)),
  projectId: 'family-budget-app-cb59b',
});
const db = admin.firestore();

(async () => {
  const snap = await db
    .collection('transactions')
    .where('userId', '==', uid)
    .where('type', '==', 'income')
    .get();

  let txnsToFix = 0;
  let splitsToFix = 0;
  let batch = db.batch();
  let pending = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    const splits = data.splits || [];
    let changed = false;

    const newSplits = splits.map((s) => {
      const isManual =
        s.manualBudgetAssignment === true ||
        s.budgetAssignmentSource === 'manual';
      const isBudgeted = s.budgetId && s.budgetId !== 'unassigned';
      if (!isManual && isBudgeted) {
        changed = true;
        splitsToFix++;
        return { ...s, budgetId: 'unassigned', budgetName: null };
      }
      return s;
    });

    if (changed) {
      txnsToFix++;
      if (COMMIT) {
        batch.update(doc.ref, {
          splits: newSplits,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        if (++pending >= 400) {
          await batch.commit();
          batch = db.batch();
          pending = 0;
        }
      }
    }
  }
  if (COMMIT && pending > 0) await batch.commit();

  console.log(
    `${COMMIT ? '✅ COMMITTED' : '🔍 DRY RUN'} — income txns: ${snap.size}, ` +
      `txns ${COMMIT ? 'fixed' : 'to fix'}: ${txnsToFix}, splits: ${splitsToFix}`
  );
  if (!COMMIT) console.log('   (re-run with --commit to apply)');
  process.exit(0);
})().catch((e) => {
  console.error('❌ Failed:', e);
  process.exit(1);
});
