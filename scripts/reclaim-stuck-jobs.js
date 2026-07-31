#!/usr/bin/env node
/**
 * reclaim-stuck-jobs.js — mark orphaned `_jobs` (status "processing" but stale) as
 * "failed" so they stop clogging the queue. Only touches jobs whose updated_at is older
 * than STALE_MIN (default 15) — never a genuinely in-flight job. Non-destructive (keeps
 * the doc + a reclaim note; failed jobs are terminal, never re-run). DRY-RUN by default.
 */
'use strict';
const path = require('path'), fs = require('fs'), os = require('os');
const admin = require('firebase-admin');
const PROJECT_ID = 'family-budget-app-cb59b';
const COMMIT = process.argv.includes('--commit');
const STALE_MIN = 15;
function cred() {
  const c = [process.env.GOOGLE_APPLICATION_CREDENTIALS, path.join(os.homedir(), 'google-service-account-key.json')].filter(Boolean);
  for (const p of c) { try { if (fs.existsSync(p)) { console.error(`🔑 ${p}`); return admin.credential.cert(require(p)); } } catch (_e) {} }
  return admin.credential.applicationDefault();
}
async function main() {
  admin.initializeApp({ credential: cred(), projectId: PROJECT_ID });
  const db = admin.firestore(); const { Timestamp } = admin.firestore;
  console.error(`${COMMIT ? '✍️  COMMIT' : '📖 DRY RUN'} · reclaim stuck "processing" jobs (>${STALE_MIN}m) · ${PROJECT_ID}\n`);
  const cutoffMs = Date.now() - STALE_MIN * 60000;
  const snap = await db.collection('_jobs').where('status', '==', 'processing').get();
  const byType = {};
  let stale = 0, fresh = 0, batch = db.batch(), n = 0;
  for (const d of snap.docs) {
    const j = d.data();
    const ageOk = j.updated_at && j.updated_at.toMillis && j.updated_at.toMillis() < cutoffMs;
    if (!ageOk) { fresh++; continue; }
    stale++; byType[j.job_type] = (byType[j.job_type] || 0) + 1;
    if (COMMIT) {
      batch.set(d.ref, { status: 'failed', error_message: 'reclaimed: orphaned in processing', updated_at: Timestamp.now() }, { merge: true });
      if (++n >= 400) { await batch.commit(); batch = db.batch(); n = 0; }
    }
  }
  if (COMMIT && n > 0) await batch.commit();
  console.error(`${COMMIT ? '✅ reclaimed' : 'would reclaim'} ${stale} stale jobs`, byType, `· left ${fresh} fresh (<${STALE_MIN}m) untouched.`);
}
main().then(() => process.exit(0)).catch((e) => { console.error('❌', e.message); process.exit(1); });
