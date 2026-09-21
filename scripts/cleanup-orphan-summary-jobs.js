#!/usr/bin/env node
/**
 * One-time cleanup: delete orphaned `update_user_summary` jobs left in `_jobs` after the
 * user_summaries build pipeline was retired. The job handler is gone, so pending jobs would
 * otherwise churn through retry -> DLQ. This deletes them directly instead.
 *
 * SAFETY: dry-run by default (counts only). Pass --confirm to actually delete.
 * Scope: `_jobs` where job_type == 'update_user_summary' AND status == 'pending'.
 *
 * Usage:
 *   node scripts/cleanup-orphan-summary-jobs.js            # dry run (count)
 *   node scripts/cleanup-orphan-summary-jobs.js --confirm  # delete
 *
 * Credentials: same resolution as scripts/inspect-firestore.js (service-account key).
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const admin = require('firebase-admin');

const PROJECT_ID = 'family-budget-app-cb59b';
const CONFIRM = process.argv.includes('--confirm');
const JOB_TYPE = 'update_user_summary';
const STATUS = 'pending';

function resolveCredential() {
  const candidates = [
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    path.join(os.homedir(), 'google-service-account-key.json'),
    path.join(os.homedir(), '.config/firebase/service-accounts', `${PROJECT_ID}.json`),
    path.join(__dirname, '..', 'serviceAccount.json'),
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        console.error(`🔑 Using service-account key: ${p}`);
        // eslint-disable-next-line global-require, import/no-dynamic-require
        return admin.credential.cert(require(p));
      }
    } catch (_e) {
      /* keep trying */
    }
  }
  console.error('🔑 No key file found — falling back to application-default credentials.');
  return admin.credential.applicationDefault();
}

async function main() {
  admin.initializeApp({ credential: resolveCredential(), projectId: PROJECT_ID });
  const db = admin.firestore();

  const baseQuery = db
    .collection('_jobs')
    .where('job_type', '==', JOB_TYPE)
    .where('status', '==', STATUS);

  const countSnap = await baseQuery.count().get();
  const total = countSnap.data().count;
  console.error(`Found ${total} _jobs with job_type=${JOB_TYPE} status=${STATUS}.`);

  if (!CONFIRM) {
    console.error('DRY RUN — pass --confirm to delete. Nothing changed.');
    return;
  }

  const writer = db.bulkWriter();
  let deleted = 0;
  const PAGE = 2000;
  let last = null;
  // Paginate by document id so we only hold a page of refs in memory at a time.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let q = baseQuery.select().orderBy(admin.firestore.FieldPath.documentId()).limit(PAGE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      writer.delete(doc.ref);
      deleted += 1;
    }
    last = snap.docs[snap.docs.length - 1].id;
    await writer.flush();
    console.error(`  …deleted ${deleted}/${total}`);
    if (snap.size < PAGE) break;
  }
  await writer.close();
  console.error(`✅ Deleted ${deleted} orphaned ${JOB_TYPE} jobs.`);
}

main().catch((e) => {
  console.error('❌ Cleanup failed:', e);
  process.exit(1);
});
