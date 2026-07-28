/**
 * Clean up an Everything Else budget's NON-own-lens periods.
 *
 * Per-Period-EE: each EE budget appears only in its own period view, so it should
 * have ONLY periods of its own cadence. The legacy (pre-migration) monthly EE was
 * created before prime-only suppression, so it still has non-prime weekly/bi_monthly
 * periods that double-count against the new weekly/biweekly EE. This removes them.
 *
 * Safe: EE spend is invalidation-based (recomputed from splits), and removing a
 * redundant non-prime period drops it from the wrong view — no spend is lost from
 * the kept prime periods.
 *
 *   node scripts/clean-ee-nonprime-periods.js <uid>            # DRY RUN
 *   node scripts/clean-ee-nonprime-periods.js <uid> --commit   # apply
 */
const admin = require('firebase-admin');
const KEY =
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  `${process.env.HOME}/google-service-account-key.json`;

const uid = process.argv[2];
const COMMIT = process.argv[3] === '--commit';
if (!uid) {
  console.error('Usage: node scripts/clean-ee-nonprime-periods.js <uid> [--commit]');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(require(KEY)),
  projectId: 'family-budget-app-cb59b',
});
const db = admin.firestore();

const cadenceOf = (p) => (p === 'weekly' ? 'weekly' : p === 'bi_monthly' ? 'bi_monthly' : 'monthly');

(async () => {
  const eeSnap = await db
    .collection('budgets')
    .where('userId', '==', uid)
    .where('isSystemEverythingElse', '==', true)
    .get();

  let toDelete = [];
  for (const ee of eeSnap.docs) {
    const ownLens = ee.data().everythingElsePeriodType || cadenceOf(ee.data().period);
    const periods = await db.collection('budget_periods').where('budgetId', '==', ee.id).get();
    const wrong = periods.docs.filter((p) => p.data().periodType !== ownLens);
    console.log(
      `EE ${ee.data().name} (${ownLens}) [${ee.id}]: ${periods.size} periods, ` +
        `${wrong.length} NOT ${ownLens} → ${COMMIT ? 'deleting' : 'would delete'}`
    );
    toDelete.push(...wrong.map((d) => d.ref));
  }

  if (COMMIT && toDelete.length) {
    let batch = db.batch();
    let n = 0;
    for (const ref of toDelete) {
      batch.delete(ref);
      if (++n >= 400) {
        await batch.commit();
        batch = db.batch();
        n = 0;
      }
    }
    if (n > 0) await batch.commit();
  }

  console.log(
    `${COMMIT ? '✅ DELETED' : '🔍 DRY RUN'} ${toDelete.length} non-own-lens EE periods.` +
      (COMMIT ? '' : ' (re-run with --commit to apply)')
  );
  process.exit(0);
})().catch((e) => {
  console.error('❌ Failed:', e);
  process.exit(1);
});
