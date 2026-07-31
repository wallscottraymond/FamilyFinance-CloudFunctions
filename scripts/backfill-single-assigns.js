#!/usr/bin/env node
/**
 * backfill-single-assigns.js — reliable category/assignment backfill.
 *
 * The `backfill_assignments` orchestrator fans out to `assign_transactions_batch`
 * jobs (100 txns each), which are timing out mid-batch and orphaning in
 * "processing" (only ~20% coverage). This bypasses that: it enqueues ONE small
 * `assign_transaction` job PER transaction — the path proven to complete in
 * seconds and write the overallCategoryId/firstCategoryId slugs. Idempotent.
 *
 * DRY-RUN by default (counts only). Pass --commit to enqueue.
 *
 * Usage:
 *   node scripts/backfill-single-assigns.js            # dry run
 *   node scripts/backfill-single-assigns.js --commit   # enqueue all
 */
'use strict';
const path = require('path'), fs = require('fs'), os = require('os'), crypto = require('crypto');
const admin = require('firebase-admin');
const PROJECT_ID = 'family-budget-app-cb59b';
const COMMIT = process.argv.includes('--commit');
const PAGE = 500;
const WRITE_BATCH = 400;

function cred() {
  const c = [process.env.GOOGLE_APPLICATION_CREDENTIALS, path.join(os.homedir(), 'google-service-account-key.json')].filter(Boolean);
  for (const p of c) { try { if (fs.existsSync(p)) { console.error(`🔑 ${p}`); return admin.credential.cert(require(p)); } } catch (_e) {} }
  return admin.credential.applicationDefault();
}

async function main() {
  admin.initializeApp({ credential: cred(), projectId: PROJECT_ID });
  const db = admin.firestore(); const { Timestamp, FieldPath } = admin.firestore;
  console.error(`${COMMIT ? '✍️  COMMIT' : '📖 DRY RUN'} · enqueue per-txn assign_transaction jobs · ${PROJECT_ID}\n`);

  // Page through ALL transactions by document id.
  let last = null, scanned = 0, enqueued = 0, skippedNoUser = 0;
  let batch = db.batch(), inBatch = 0;

  for (;;) {
    let q = db.collection('transactions').orderBy(FieldPath.documentId()).limit(PAGE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      scanned++;
      last = doc.id;
      const d = doc.data();
      const user_id = d.userId || d.ownerId;
      if (!user_id) { skippedNoUser++; continue; }
      if (COMMIT) {
        const job_id = crypto.randomUUID(); const now = Timestamp.now();
        batch.set(db.collection('_jobs').doc(job_id), {
          job_id, job_type: 'assign_transaction',
          payload: { user_id, transaction_id: doc.id },
          status: 'pending', retry_count: 0, max_retries: 3,
          created_at: now, updated_at: now, trace_id: 'backfill-single',
        });
        inBatch++;
        if (inBatch >= WRITE_BATCH) { await batch.commit(); batch = db.batch(); inBatch = 0; }
      }
      enqueued++;
    }
    if (snap.size < PAGE) break;
    if (scanned % 1000 === 0) console.error(`  …scanned ${scanned}`);
  }
  if (COMMIT && inBatch > 0) await batch.commit();

  console.error(`\n${COMMIT ? '✅ enqueued' : 'would enqueue'} ${enqueued} assign_transaction jobs (scanned ${scanned}, skipped ${skippedNoUser} with no user).`);
  if (!COMMIT) console.error('Re-run with --commit to enqueue.');
}
main().then(() => process.exit(0)).catch((e) => { console.error('❌', e.message); process.exit(1); });
