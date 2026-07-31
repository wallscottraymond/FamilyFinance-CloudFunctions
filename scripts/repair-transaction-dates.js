#!/usr/bin/env node
/**
 * repair-transaction-dates.js — fix active transactions missing `transactionDate`.
 *
 * ~234 active txns have a valid `date` (Timestamp) but NO `transactionDate`, which
 * the assignment engine requires (`transactionDate.toMillis()` → crash → retry→DLQ).
 * This copies `date` → `transactionDate` so they classify. Idempotent.
 *
 * DRY-RUN by default; pass --commit to write. Only touches active txns that are
 * missing transactionDate AND have a usable `date`.
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
  const db = admin.firestore(); const { Timestamp, FieldPath } = admin.firestore;
  console.error(`${COMMIT ? '✍️  COMMIT' : '📖 DRY RUN'} · repair transactionDate · ${PROJECT_ID}\n`);

  let last = null, scanned = 0, fixable = 0, unfixable = 0;
  let batch = db.batch(), n = 0;
  for (;;) {
    let q = db.collection('transactions').orderBy(FieldPath.documentId()).limit(500);
    if (last) q = q.startAfter(last);
    const s = await q.get();
    if (s.empty) break;
    for (const d of s.docs) {
      last = d.id; const t = d.data();
      if (t.isActive === false || t.isHidden === true) continue;
      if (t.transactionDate) continue;              // already has it
      const date = t.date;
      // Accept a Firestore Timestamp or a parseable string/number.
      let ts = null;
      if (date && typeof date.toMillis === 'function') ts = date;
      else if (typeof date === 'string' || typeof date === 'number') { const dd = new Date(date); if (!isNaN(dd.getTime())) ts = Timestamp.fromDate(dd); }
      if (!ts) { unfixable++; continue; }
      fixable++;
      if (COMMIT) {
        batch.set(d.ref, { transactionDate: ts }, { merge: true });
        if (++n >= 400) { await batch.commit(); batch = db.batch(); n = 0; }
      }
    }
    if (s.size < 500) break;
  }
  if (COMMIT && n > 0) await batch.commit();
  console.error(`\n${COMMIT ? '✅ repaired' : 'would repair'} ${fixable} txns (set transactionDate = date). ${unfixable} unfixable (no usable date).`);
  if (!COMMIT) console.error('Re-run with --commit to apply.');
}
main().then(() => process.exit(0)).catch((e) => { console.error('❌', e.message); process.exit(1); });
