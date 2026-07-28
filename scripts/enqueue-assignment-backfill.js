/**
 * One-off: enqueue the `backfill_assignments` coordinator job for a single user.
 * This is EXACTLY what the deployed `backfill_transaction_assignments` callable
 * does (job_queue.create_job) — just triggered here with the admin service
 * account, scoped to one uid. The deployed on_job_created trigger then fans out
 * per-batch re-assignment + budget recompute.
 *
 * Usage: node scripts/enqueue-assignment-backfill.js <uid>
 */
const admin = require('firebase-admin');
const crypto = require('crypto');

const KEY =
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  `${process.env.HOME}/google-service-account-key.json`;

const uid = process.argv[2];
if (!uid) {
  console.error('Provide a uid: node scripts/enqueue-assignment-backfill.js <uid>');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(require(KEY)),
  projectId: 'family-budget-app-cb59b',
});

const { create_job } = require('../lib/functions/infrastructure/job_queue');

(async () => {
  const trace_id = crypto.randomUUID();
  const job = await create_job(
    'backfill_assignments',
    { user_id: uid },
    { trace_id }
  );
  console.log(`✅ Enqueued backfill_assignments for ${uid}`);
  console.log(`   job_id: ${job.job_id}`);
  console.log(`   trace_id: ${trace_id}`);
  console.log('   The deployed job pipeline will now re-assign this user\'s transactions.');
  process.exit(0);
})().catch((e) => {
  console.error('❌ Failed:', e);
  process.exit(1);
});
