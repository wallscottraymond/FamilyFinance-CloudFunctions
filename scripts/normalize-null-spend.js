#!/usr/bin/env node
/**
 * normalize-null-spend.js — set `spent: 0` (+ `remaining: allocated`) on budget_periods
 * whose `spent` was never computed (null). These all belong to untouched budgets (0
 * spending) — verified 0 null-spent on touched budgets. Cosmetic tidy so periods read 0
 * instead of null. DRY-RUN by default; --commit to write.
 */
'use strict';
const path = require('path'), fs = require('fs'), os = require('os');
const admin = require('firebase-admin');
const PROJECT_ID = 'family-budget-app-cb59b';
const COMMIT = process.argv.includes('--commit');
function cred() {
  const c = [process.env.GOOGLE_APPLICATION_CREDENTIALS, path.join(os.homedir(), 'google-service-account-key.json')].filter(Boolean);
  for (const p of c) { try { if (fs.existsSync(p)) { console.error(`🔑 ${p}`); return admin.credential.cert(require(p)); } } catch (_e) {} }
  return admin.credential.applicationDefault();
}
async function main() {
  admin.initializeApp({ credential: cred(), projectId: PROJECT_ID });
  const db = admin.firestore();
  console.error(`${COMMIT ? '✍️  COMMIT' : '📖 DRY RUN'} · normalize null spent → 0 · ${PROJECT_ID}\n`);
  let last = null, fixed = 0, batch = db.batch(), n = 0;
  for (;;) {
    let q = db.collection('budget_periods').orderBy(admin.firestore.FieldPath.documentId()).limit(500);
    if (last) q = q.startAfter(last);
    const s = await q.get(); if (s.empty) break;
    for (const d of s.docs) {
      last = d.id; const p = d.data();
      if (p.spent != null) continue;
      const allocated = p.modifiedAmount ?? p.allocatedAmount ?? p.originalAmount ?? 0;
      fixed++;
      if (COMMIT) {
        batch.set(d.ref, { spent: 0, remaining: allocated }, { merge: true });
        if (++n >= 400) { await batch.commit(); batch = db.batch(); n = 0; }
      }
    }
    if (s.size < 500) break;
  }
  if (COMMIT && n > 0) await batch.commit();
  console.error(`${COMMIT ? '✅ normalized' : 'would normalize'} ${fixed} periods (spent→0, remaining→allocated).`);
}
main().then(() => process.exit(0)).catch((e) => { console.error('❌', e.message); process.exit(1); });
