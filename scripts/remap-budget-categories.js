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
 *
 * --first-only : store `firstCategoryId` per category and DO NOT collapse to overall
 *   (the canonical first_category model — Phase 5). Keeps budgets aligned with the flat
 *   first-level picker so the edit-wizard shows a budget's own firsts as selected.
 */
'use strict';
const path = require('path'), fs = require('fs'), os = require('os');
const admin = require('firebase-admin');
const PROJECT_ID = 'family-budget-app-cb59b';
const COMMIT = process.argv.includes('--commit');
// --resolve-conflicts implies first-only (canonical Phase 5 target): store firstCategoryId,
// no overall-collapse, and assign each contested first to ONE budget (most source detaileds
// wins; tie → budget name ascending), dropping it from the others so no category is shared.
const RESOLVE = process.argv.includes('--resolve-conflicts');
const FIRST_ONLY = process.argv.includes('--first-only') || RESOLVE;
// Scope to ONE user's budgets (by ownerId). Conflict resolution runs WITHIN this set only —
// required in the shared dev project so other users' budgets aren't touched or contested.
const uIdx = process.argv.indexOf('--user');
const USER = uIdx >= 0 ? process.argv[uIdx + 1] : null;

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

  // Classify a budget's categoryIds → per-first source counts + preserved (unknown) ids.
  function classify(ids) {
    const firsts = new Map(), kept = new Set();                   // first → source count
    const bump = (f) => firsts.set(f, (firsts.get(f) || 0) + 1);
    for (const id of ids) {
      if (catInfo[id]) bump(catInfo[id].firstCategoryId);         // detailed → first
      else if (allFirsts.has(id)) bump(id);                       // already a first slug
      else if (allOveralls.has(id)) { for (const f of (overallToFirsts[id] || [])) bump(f); } // overall → its firsts
      else kept.add(id);                                          // unknown → preserve
    }
    return { firsts, kept };
  }

  // Collapse helper (legacy default mode): whole-overall coverage → overall slug.
  function collapse(firstsSet) {
    const firsts = new Set(firstsSet), overalls = new Set();
    for (const [ov, firstSet] of Object.entries(overallToFirsts)) {
      if (firstSet.size > 0 && [...firstSet].every((f) => firsts.has(f))) {
        overalls.add(ov);
        for (const f of firstSet) firsts.delete(f);
      }
    }
    return [...overalls, ...firsts];
  }

  let budgetQuery = db.collection('budgets');
  if (USER) budgetQuery = budgetQuery.where('ownerId', '==', USER);
  else console.error('⚠️  No --user given: operating on ALL budgets in the project.\n');
  const snap = await budgetQuery.get();
  // Pass 1: classify every eligible budget.
  const rows = [];
  for (const doc of snap.docs) {
    const b = doc.data();
    if (b.isSystemEverythingElse || b.isEverythingElse) continue;
    const cur = Array.isArray(b.categoryIds) ? b.categoryIds : [];
    if (cur.length === 0) continue;
    const { firsts, kept } = classify(cur);
    rows.push({ doc, name: b.name ?? doc.id, cur, firsts, kept });
  }

  // Pass 2 (RESOLVE only): assign each contested first to ONE budget (max source count;
  // tie → budget name ascending) and drop it from the others.
  const winners = new Map(); // first → row index
  if (RESOLVE) {
    const claims = new Map(); // first → [{i, count, name}]
    rows.forEach((r, i) => r.firsts.forEach((count, f) =>
      (claims.get(f) || claims.set(f, []).get(f)).push({ i, count, name: r.name })));
    for (const [f, cs] of claims) {
      cs.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
      winners.set(f, cs[0].i);
    }
  }

  // Pass 3: compute next[] per budget + write.
  let changed = 0, unchanged = 0, emptied = 0;
  const skipped = snap.size - rows.length;
  let batch = db.batch(), n = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const finalFirsts = RESOLVE
      ? [...r.firsts.keys()].filter((f) => winners.get(f) === i) // only the firsts this budget won
      : [...r.firsts.keys()];
    const next = FIRST_ONLY
      ? [...new Set([...finalFirsts, ...r.kept])]
      : [...new Set([...collapse(new Set(finalFirsts)), ...r.kept])];
    const same = r.cur.length === next.length && r.cur.every((x) => next.includes(x));
    if (same) { unchanged++; continue; }
    changed++;
    if (next.length === 0) emptied++;
    console.error(`• ${r.name}:  [${r.cur.join(', ')}]  →  [${next.join(', ')}]`);
    if (COMMIT) {
      batch.set(r.doc.ref, { categoryIds: next }, { merge: true });
      if (++n >= 400) { await batch.commit(); batch = db.batch(); n = 0; }
    }
  }
  if (COMMIT && n > 0) await batch.commit();
  console.error(`\n${COMMIT ? '✅ remapped' : 'would remap'} ${changed} budgets (${emptied} emptied) · ${unchanged} already-slug/unchanged · ${skipped} skipped (EE/empty).`);
  if (!COMMIT) console.error('Re-run with --commit to apply.');
}
main().then(() => process.exit(0)).catch((e) => { console.error('❌', e.message); process.exit(1); });
