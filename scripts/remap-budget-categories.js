#!/usr/bin/env node
/**
 * remap-budget-categories.js — Phase 4b: migrate budgets from Plaid-detailed
 * `categoryIds` to slug-level (`firstCategoryId`, collapsing to `overallCategoryId`
 * when a whole overall is covered). This makes a budget mean "the category" (and
 * auto-include NEW detaileds) instead of a frozen list of detaileds.
 *
 * Rules per budget (skips system Everything-Else + empty budgets):
 *   - each detailed docId → its firstCategoryId  (dedupe)
 *   - already-slug ids (first/overall) kept as-is (idempotent)
 *   - unknown ids preserved untouched (never lose a reference)
 *   - if the budget covers ALL firsts of an overall → replace them with the overall slug
 *
 * DRY-RUN by default; pass --commit to write. match_budget matches detaileds AND
 * slugs, so this is safe to run before/after with no gap.
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
  console.error(`${COMMIT ? '✍️  COMMIT' : '📖 DRY RUN'} · remap budget categoryIds → slugs · ${PROJECT_ID}\n`);

  // Build lookups from the category docs.
  const catInfo = {};                 // docId (detailed) → {overallCategoryId, firstCategoryId}
  const overallToFirsts = {};         // overallCategoryId → Set(firstCategoryId)
  const allFirsts = new Set(), allOveralls = new Set();
  (await db.collection('categories').get()).docs.forEach((d) => {
    const c = d.data();
    const o = c.overallCategoryId, f = c.firstCategoryId;
    if (o && f) {
      catInfo[d.id] = { overallCategoryId: o, firstCategoryId: f };
      (overallToFirsts[o] = overallToFirsts[o] || new Set()).add(f);
      allFirsts.add(f); allOveralls.add(o);
    }
  });

  function remap(ids) {
    const firsts = new Set(), overalls = new Set(), kept = new Set();
    for (const id of ids) {
      if (catInfo[id]) firsts.add(catInfo[id].firstCategoryId);   // detailed → first
      else if (allFirsts.has(id)) firsts.add(id);                 // already a first slug
      else if (allOveralls.has(id)) overalls.add(id);             // already an overall slug
      else kept.add(id);                                          // unknown → preserve
    }
    // Collapse: whole-overall coverage → overall slug.
    for (const [ov, firstSet] of Object.entries(overallToFirsts)) {
      if (firstSet.size > 0 && [...firstSet].every((f) => firsts.has(f))) {
        overalls.add(ov);
        for (const f of firstSet) firsts.delete(f);
      }
    }
    return [...new Set([...overalls, ...firsts, ...kept])];
  }

  const snap = await db.collection('budgets').get();
  let changed = 0, skipped = 0, unchanged = 0;
  let batch = db.batch(), n = 0;
  for (const doc of snap.docs) {
    const b = doc.data();
    if (b.isSystemEverythingElse || b.isEverythingElse) { skipped++; continue; }
    const cur = Array.isArray(b.categoryIds) ? b.categoryIds : [];
    if (cur.length === 0) { skipped++; continue; }
    const next = remap(cur);
    const same = cur.length === next.length && cur.every((x) => next.includes(x));
    if (same) { unchanged++; continue; }
    changed++;
    console.error(`• ${b.name ?? doc.id}:  [${cur.join(', ')}]  →  [${next.join(', ')}]`);
    if (COMMIT) {
      batch.set(doc.ref, { categoryIds: next }, { merge: true });
      if (++n >= 400) { await batch.commit(); batch = db.batch(); n = 0; }
    }
  }
  if (COMMIT && n > 0) await batch.commit();
  console.error(`\n${COMMIT ? '✅ remapped' : 'would remap'} ${changed} budgets · ${unchanged} already-slug/unchanged · ${skipped} skipped (EE/empty).`);
  if (!COMMIT) console.error('Re-run with --commit to apply.');
}
main().then(() => process.exit(0)).catch((e) => { console.error('❌', e.message); process.exit(1); });
