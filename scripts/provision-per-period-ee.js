/**
 * One-off: provision the per-period Everything Else budgets for a user by calling
 * the deployed (compiled) `createEverythingElseBudget` — idempotent PER LENS, so it
 * creates the missing weekly + bi_monthly EE (upgrading the legacy monthly EE in
 * place) and enqueues their period generation (processed by on_job_created).
 *
 *   node scripts/provision-per-period-ee.js <uid> [currency]
 */
const admin = require('firebase-admin');
const KEY =
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  `${process.env.HOME}/google-service-account-key.json`;

const uid = process.argv[2];
const currency = process.argv[3] || 'USD';
if (!uid) {
  console.error('Usage: node scripts/provision-per-period-ee.js <uid> [currency]');
  process.exit(1);
}

process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'family-budget-app-cb59b';
admin.initializeApp({
  credential: admin.credential.cert(require(KEY)),
  projectId: 'family-budget-app-cb59b',
});

(async () => {
  // eslint-disable-next-line
  const { createEverythingElseBudget } = require('../lib/functions/budgets/utils/createEverythingElseBudget');
  console.log(`Provisioning per-period EE budgets for ${uid}...`);
  const monthlyId = await createEverythingElseBudget(admin.firestore(), uid, currency);
  console.log(`✅ Done. Monthly EE id: ${monthlyId}`);
  console.log('   (weekly + bi_monthly EE created if missing; period generation enqueued)');
  process.exit(0);
})().catch((e) => {
  console.error('❌ Failed:', e);
  process.exit(1);
});
