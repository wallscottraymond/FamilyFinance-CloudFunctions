#!/usr/bin/env node
/**
 * enqueue-assign.js — enqueue a single `assign_transaction` job (diagnostic).
 * Usage: node scripts/enqueue-assign.js <user_id> <transaction_id>
 */
'use strict';
const path = require('path'), fs = require('fs'), os = require('os'), crypto = require('crypto');
const admin = require('firebase-admin');
const PROJECT_ID = 'family-budget-app-cb59b';
function cred() {
  const c = [process.env.GOOGLE_APPLICATION_CREDENTIALS, path.join(os.homedir(), 'google-service-account-key.json')].filter(Boolean);
  for (const p of c) { try { if (fs.existsSync(p)) return admin.credential.cert(require(p)); } catch (_e) {} }
  return admin.credential.applicationDefault();
}
async function main() {
  const [user_id, transaction_id] = process.argv.slice(2);
  if (!user_id || !transaction_id) { console.error('usage: enqueue-assign.js <user_id> <transaction_id>'); process.exit(1); }
  admin.initializeApp({ credential: cred(), projectId: PROJECT_ID });
  const db = admin.firestore(); const { Timestamp } = admin.firestore;
  const job_id = crypto.randomUUID(); const now = Timestamp.now();
  await db.collection('_jobs').doc(job_id).set({
    job_id, job_type: 'assign_transaction', payload: { user_id, transaction_id },
    status: 'pending', retry_count: 0, max_retries: 3, created_at: now, updated_at: now, trace_id: crypto.randomUUID(),
  });
  console.error(`✅ assign_transaction job _jobs/${job_id} for txn ${transaction_id}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error('❌', e.message); process.exit(1); });
