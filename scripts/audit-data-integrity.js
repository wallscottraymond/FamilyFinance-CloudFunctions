#!/usr/bin/env node
/**
 * audit-data-integrity.js — READ-ONLY health check of the category/budget data
 * after the Simplified-Transaction-Categories work. Reports; writes nothing.
 */
'use strict';
const path = require('path'), fs = require('fs'), os = require('os');
const admin = require('firebase-admin');
const PROJECT_ID = 'family-budget-app-cb59b';
function cred() {
  const c = [process.env.GOOGLE_APPLICATION_CREDENTIALS, path.join(os.homedir(), 'google-service-account-key.json')].filter(Boolean);
  for (const p of c) { try { if (fs.existsSync(p)) { console.error(`🔑 ${p}`); return admin.credential.cert(require(p)); } } catch (_e) {} }
  return admin.credential.applicationDefault();
}
const isSlug = (s) => typeof s === 'string' && /^[a-z0-9_]+$/.test(s);

async function pageAll(db, coll, cb) {
  let last = null;
  for (;;) {
    let q = db.collection(coll).orderBy(admin.firestore.FieldPath.documentId()).limit(500);
    if (last) q = q.startAfter(last);
    const s = await q.get(); if (s.empty) break;
    for (const d of s.docs) { last = d.id; cb(d); }
    if (s.size < 500) break;
  }
}

async function main() {
  admin.initializeApp({ credential: cred(), projectId: PROJECT_ID });
  const db = admin.firestore();

  // 1. CATEGORIES
  const catDocs = (await db.collection('categories').get()).docs;
  const catIds = new Set(catDocs.map(d => d.id));
  const overallByFirst = {}; const firstSlugs = new Set(); const overallSlugs = new Set();
  let catNoSlug = 0, catInactive = 0, catTypos = 0;
  for (const d of catDocs) { const c = d.data();
    if (!c.overallCategoryId || !c.firstCategoryId) catNoSlug++;
    if (c.isActive !== true) catInactive++;
    if (/Paymentss|Tabacco/.test([c.overall_category, c.first_category, c.second_category].join('|'))) catTypos++;
    if (c.overallCategoryId) overallSlugs.add(c.overallCategoryId);
    if (c.firstCategoryId) firstSlugs.add(c.firstCategoryId);
  }
  console.log('\n=== CATEGORIES ===');
  console.log(JSON.stringify({ total: catDocs.length, missing_slug: catNoSlug, inactive: catInactive, typos_remaining: catTypos, distinct_overall: overallSlugs.size, distinct_first: firstSlugs.size }));

  // 2. SPLITS (active classification)
  let act = 0, classified = 0, nullNoDate = 0, nullOther = 0;
  await pageAll(db, 'transactions', (d) => { const t = d.data();
    if (t.isActive === false || t.isHidden === true) return; act++;
    const sp = t.splits || [];
    if (sp.some(x => x.overallCategoryId)) classified++;
    else if (!t.transactionDate) nullNoDate++; else nullOther++;
  });
  console.log('\n=== SPLIT CLASSIFICATION (active txns) ===');
  console.log(JSON.stringify({ active: act, classified, pct: Math.floor(classified*100/act), null_no_date: nullNoDate, null_other: nullOther }));

  // 3. BUDGETS
  const budDocs = (await db.collection('budgets').get()).docs;
  let ee = 0, realWithCats = 0, emptyNonEE = 0, rawDetailedRemaining = 0, unknownRef = 0;
  const badBudgets = [];
  for (const d of budDocs) { const b = d.data();
    if (b.isSystemEverythingElse || b.isEverythingElse) { ee++; continue; }
    const ids = Array.isArray(b.categoryIds) ? b.categoryIds : [];
    if (ids.length === 0) { emptyNonEE++; continue; }
    realWithCats++;
    for (const id of ids) {
      if (catIds.has(id)) { rawDetailedRemaining++; if (badBudgets.length < 8) badBudgets.push(`${b.name}: raw detailed ${id}`); }
      else if (!isSlug(id)) { unknownRef++; if (badBudgets.length < 8) badBudgets.push(`${b.name}: non-slug ${id}`); }
    }
  }
  console.log('\n=== BUDGETS ===');
  console.log(JSON.stringify({ total: budDocs.length, everything_else: ee, real_with_categories: realWithCats, empty_non_ee: emptyNonEE, raw_detailed_ids_remaining: rawDetailedRemaining, unknown_non_slug_refs: unknownRef }));
  if (badBudgets.length) console.log('  flagged:', badBudgets);

  // 4. BUDGET SPEND sanity (real budget periods)
  let periods = 0, spentPositive = 0, spentZero = 0, spentNull = 0;
  await pageAll(db, 'budget_periods', (d) => { const p = d.data();
    periods++;
    const sp = p.spent;
    if (sp == null) spentNull++; else if (sp > 0) spentPositive++; else spentZero++;
  });
  console.log('\n=== BUDGET_PERIODS spend sanity ===');
  console.log(JSON.stringify({ total_periods: periods, spent_gt_0: spentPositive, spent_0: spentZero, spent_null: spentNull }));

  // 5. JOB QUEUE health
  console.log('\n=== JOB QUEUE ===');
  for (const s of ['pending', 'processing', 'failed', 'dlq']) {
    const c = await db.collection('_jobs').where('status', '==', s).count().get();
    console.log(`  ${s}: ${c.data().count}`);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error('❌', e.message); process.exit(1); });
