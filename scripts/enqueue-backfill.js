#!/usr/bin/env node
/**
 * enqueue-backfill.js — kick off the transaction-assignment backfill for ALL users.
 *
 * Writes a single `backfill_assignments` coordinator job to `_jobs` (exactly what
 * the `backfill_transaction_assignments` callable does internally). The deployed
 * `on_job_created` trigger routes it → `backfill_assignments_orchestrator`, which
 * self-fans (all users → per-user → per-transaction `assign_transaction`). Each
 * re-runs the v2 engine, populating the new overallCategoryId/firstCategoryId slugs
 * on every split (+ recomputing budget spend). Idempotent.
 *
 * Usage:
 *   node scripts/enqueue-backfill.js               # all users (payload {})
 *   node scripts/enqueue-backfill.js <user_id>     # a single user
 */

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const admin = require('firebase-admin');

const PROJECT_ID = 'family-budget-app-cb59b';

function resolveCredential() {
  const candidates = [
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    path.join(os.homedir(), 'google-service-account-key.json'),
    path.join(os.homedir(), '.config/firebase/service-accounts', `${PROJECT_ID}.json`),
    path.join(__dirname, '..', 'serviceAccount.json'),
  ].filter(Boolean);
  for (const p of candidates) {
    try { if (fs.existsSync(p)) { console.error(`🔑 key: ${p}`); return admin.credential.cert(require(p)); } } catch (_e) { /* next */ }
  }
  return admin.credential.applicationDefault();
}

async function main() {
  const user_id = process.argv[2]; // optional
  admin.initializeApp({ credential: resolveCredential(), projectId: PROJECT_ID });
  const db = admin.firestore();
  const { Timestamp } = admin.firestore;

  const job_id = crypto.randomUUID();
  const trace_id = crypto.randomUUID();
  const now = Timestamp.now();
  const payload = user_id ? { user_id } : {}; // {} = all users

  const job = {
    job_id,
    job_type: 'backfill_assignments',
    payload,
    status: 'pending',
    retry_count: 0,
    max_retries: 3,
    created_at: now,
    updated_at: now,
    trace_id,
  };

  console.error(`✍️  enqueue backfill_assignments · scope=${user_id ?? 'ALL_USERS'} · project=${PROJECT_ID}`);
  await db.collection('_jobs').doc(job_id).set(job);
  console.error(`✅ coordinator job created: _jobs/${job_id} (trace ${trace_id})`);
  console.error('   on_job_created will fan out → per-user → per-transaction assign jobs.');
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('❌ enqueue-backfill failed:', err.message);
  process.exit(1);
});
