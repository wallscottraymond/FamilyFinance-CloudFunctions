/**
 * One-off: refresh a user's user_summary docs from their CURRENT budget_periods,
 * by enqueuing update_user_summary jobs (processed by the deployed on_job_created).
 * Used after the Per-Period-EE cleanup deleted the legacy monthly-EE's non-prime
 * periods — this rebuilds the affected weekly/biweekly summaries so the stale
 * monthly-EE entries drop out and the new weekly/biweekly EE appear.
 *
 *   node scripts/refresh-user-summaries.js <uid>
 */
const admin = require('firebase-admin');
const KEY =
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  `${process.env.HOME}/google-service-account-key.json`;

const uid = process.argv[2];
if (!uid) {
  console.error('Usage: node scripts/refresh-user-summaries.js <uid>');
  process.exit(1);
}

process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'family-budget-app-cb59b';
admin.initializeApp({
  credential: admin.credential.cert(require(KEY)),
  projectId: 'family-budget-app-cb59b',
});
const db = admin.firestore();

(async () => {
  // eslint-disable-next-line
  const { enqueue_user_summary_updates_from_budget_periods } = require('../lib/functions/orchestrators/summaries');

  const snap = await db.collection('budget_periods').where('userId', '==', uid).get();
  const periodIds = snap.docs.map((d) => d.id);
  console.log(`Enqueuing summary refresh for ${periodIds.length} current budget_periods...`);

  const ctx = { trace_id: `refresh_${uid}`, span_id: `refresh_${uid}` };
  await enqueue_user_summary_updates_from_budget_periods(ctx, uid, periodIds);

  console.log('✅ Enqueued. The deployed pipeline will rebuild the user_summary docs.');
  process.exit(0);
})().catch((e) => {
  console.error('❌ Failed:', e);
  process.exit(1);
});
