/**
 * READ-ONLY pre/post migration inspector for Per-Period Everything-Else.
 *
 * Reports, for a user:
 *   - which EE budgets exist, by lens (monthly/weekly/bi_monthly)
 *   - transaction counts by type
 *   - how many splits already carry the 3 per-lens budget ids vs. still legacy-only
 *
 * Run it BEFORE migration (to size the work) and AFTER (to verify every split got
 * all three lens assignments). No writes.
 *
 *   node scripts/inspect-per-period-ee-migration.js <uid>
 */
const admin = require('firebase-admin');
const KEY =
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  `${process.env.HOME}/google-service-account-key.json`;

const uid = process.argv[2];
if (!uid) {
  console.error('Usage: node scripts/inspect-per-period-ee-migration.js <uid>');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(require(KEY)),
  projectId: 'family-budget-app-cb59b',
});
const db = admin.firestore();

const cadenceOf = (p) => (p === 'weekly' ? 'weekly' : p === 'bi_monthly' ? 'bi_monthly' : 'monthly');

(async () => {
  // 1. EE budgets by lens.
  const budgets = await db
    .collection('budgets')
    .where('userId', '==', uid)
    .where('isSystemEverythingElse', '==', true)
    .get();
  const eeByLens = {};
  budgets.docs.forEach((d) => {
    const data = d.data();
    const lens = data.everythingElsePeriodType || cadenceOf(data.period);
    eeByLens[lens] = d.id;
  });
  console.log('=== Everything Else budgets (by lens) ===');
  ['monthly', 'weekly', 'bi_monthly'].forEach((l) =>
    console.log(`  ${l.padEnd(11)}: ${eeByLens[l] || '(MISSING — provision needed)'}`)
  );

  // 2. Transactions + split lens coverage.
  const txns = await db.collection('transactions').where('userId', '==', uid).get();
  let byType = {};
  let splitsTotal = 0;
  let splitsFullLens = 0; // have all three *BudgetId fields
  let splitsLegacyOnly = 0; // only legacy budgetId
  for (const doc of txns.docs) {
    const d = doc.data();
    byType[d.type] = (byType[d.type] || 0) + 1;
    for (const s of d.splits || []) {
      splitsTotal++;
      const hasAll =
        s.monthlyBudgetId !== undefined &&
        s.weeklyBudgetId !== undefined &&
        s.biWeeklyBudgetId !== undefined;
      if (hasAll) splitsFullLens++;
      else splitsLegacyOnly++;
    }
  }
  console.log('\n=== Transactions ===');
  console.log(`  total: ${txns.size}`, byType);
  console.log('\n=== Split per-lens coverage ===');
  console.log(`  splits total:          ${splitsTotal}`);
  console.log(`  with all 3 lens ids:   ${splitsFullLens}`);
  console.log(`  legacy budgetId only:  ${splitsLegacyOnly}   <- these need the assignment backfill`);
  console.log(
    splitsLegacyOnly === 0
      ? '\n✅ Migration complete — every split has all three lens assignments.'
      : '\n⏳ Migration pending — run provisioning + assignment backfill, then re-check.'
  );
  process.exit(0);
})().catch((e) => {
  console.error('❌ Failed:', e);
  process.exit(1);
});
