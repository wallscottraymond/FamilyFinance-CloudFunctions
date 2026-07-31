#!/usr/bin/env node
/**
 * migrate-categories-slugs.js — Phase 1 of Simplified-Transaction-Categories.
 *
 * DRY-RUN BY DEFAULT. Prints a full diff and writes NOTHING unless you pass
 * --commit. Even then, only touches the `categories` collection (config data;
 * no triggers) — never transactions/budgets.
 *
 * What it does:
 *   1. Applies a small set of STRUCTURAL cleanups to `categories` docs
 *      (fill empty overall, fix clear inversions, typos, dupe/degenerate labels).
 *      Cosmetic renaming is intentionally left to live curation in Firestore.
 *   2. Mints stable slug anchors on every doc:
 *        overallCategoryId = slug(overall_category)   (grouping key)
 *        firstCategoryId   = slug(first_category)
 *      (the `second`/detail anchor is the Plaid detailed = doc id, already 1:1).
 *   3. Reports firstCategoryId collisions across different overalls (would need
 *      namespacing) — surfaced, not auto-resolved.
 *
 * Usage:
 *   node scripts/migrate-categories-slugs.js            # dry run (default)
 *   node scripts/migrate-categories-slugs.js --commit   # APPLY (needs authorization)
 *   node scripts/migrate-categories-slugs.js --json      # machine-readable diff
 *
 * Credentials: same resolution as inspect-firestore.js.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const admin = require('firebase-admin');

const PROJECT_ID = 'family-budget-app-cb59b';
const COMMIT = process.argv.includes('--commit');
const AS_JSON = process.argv.includes('--json');

// ---------------------------------------------------------------------------
// Structural cleanups, keyed by doc id (== detailed_plaid_category).
// Only fields that CHANGE are listed. Everything else is left for live curation.
// ---------------------------------------------------------------------------
const CLEANUPS = {
  // Empty overall_category → fill + promote the specific into first.
  ENTERTAINMENT_MUSIC_AND_AUDIO: { overall_category: 'Entertainment', first_category: 'Digital Music' },

  // Inversion: overall "Eating Out" was NARROWER than first "Food and Drink" → swap.
  FOOD_AND_DRINK_COFFEE: { overall_category: 'Food and Drink', first_category: 'Eating Out' },
  FOOD_AND_DRINK_OTHER_FOOD_AND_DRINK: { overall_category: 'Food and Drink', first_category: 'Eating Out' },
  FOOD_AND_DRINK_RESTAURANT: { overall_category: 'Food and Drink', first_category: 'Eating Out', second_category: 'Restaurants' },
  FOOD_AND_DRINK_FAST_FOOD: { overall_category: 'Food and Drink', first_category: 'Eating Out' },
  FOOD_AND_DRINK_VENDING_MACHINES: { overall_category: 'Food and Drink', first_category: 'Eating Out' },

  // Keep as their OWN overall (user pref) — fix first so it isn't the broader "Entertainment".
  ENTERTAINMENT_CASINOS_AND_GAMBLING: { first_category: 'Gambling' },
  ENTERTAINMENT_VIDEO_GAMES: { first_category: 'Video Games' },

  // Duplicate `second` label within the same first → disambiguate.
  MEDICAL_PRIMARY_CARE: { second_category: 'Primary Care' },

  // Degenerate Income → Income → Income.
  INCOME_WAGES: { first_category: 'Wages', second_category: 'Wages' },

  // Typos.
  GENERAL_MERCHANDISE_TOBACCO_AND_VAPE: { first_category: 'Tobacco and Vape', second_category: 'Tobacco and Vape' },
  GOVERNMENT_AND_NON_PROFIT_OTHER_GOVERNMENT_AND_NON_PROFIT: { overall_category: 'Government Payments' },
  GOVERNMENT_AND_NON_PROFIT_GOVERNMENT_DEPARTMENTS_AND_AGENCIES: { overall_category: 'Government Payments' },
  GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT: { overall_category: 'Government Payments' },
};

// ---------------------------------------------------------------------------
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
        return admin.credential.cert(require(p));
      }
    } catch (_e) { /* keep trying */ }
  }
  console.error('🔑 No key file found — falling back to application-default credentials.');
  return admin.credential.applicationDefault();
}

function slug(s) {
  return (s == null ? '' : String(s))
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
}

async function main() {
  admin.initializeApp({ credential: resolveCredential(), projectId: PROJECT_ID });
  const db = admin.firestore();
  console.error(`\n${COMMIT ? '✍️  COMMIT MODE — WILL WRITE' : '📖 DRY RUN — no writes'} · project=${PROJECT_ID} · collection=categories\n`);

  const snap = await db.collection('categories').get();
  const plans = [];
  const firstSlugToOveralls = new Map(); // firstSlug -> Set(overallSlug)

  snap.docs.forEach((doc) => {
    const cur = doc.data();
    const fix = CLEANUPS[doc.id] || {};
    const next = {
      overall_category: fix.overall_category ?? cur.overall_category ?? '',
      first_category: fix.first_category ?? cur.first_category ?? '',
      second_category: fix.second_category ?? cur.second_category ?? '',
    };
    const overallCategoryId = slug(next.overall_category);
    const firstCategoryId = slug(next.first_category);

    if (!firstSlugToOveralls.has(firstCategoryId)) firstSlugToOveralls.set(firstCategoryId, new Set());
    firstSlugToOveralls.get(firstCategoryId).add(overallCategoryId);

    const nameChanges = [];
    for (const f of ['overall_category', 'first_category', 'second_category']) {
      if ((cur[f] ?? '') !== next[f]) nameChanges.push({ field: f, old: cur[f] ?? '(empty)', new: next[f] });
    }
    plans.push({
      id: doc.id, type: cur.type, next, overallCategoryId, firstCategoryId,
      nameChanges,
      addsOverallId: cur.overallCategoryId !== overallCategoryId,
      addsFirstId: cur.firstCategoryId !== firstCategoryId,
    });
  });

  // Collisions: same firstCategoryId under >1 overall.
  const collisions = [...firstSlugToOveralls.entries()].filter(([, set]) => set.size > 1);

  if (AS_JSON) {
    console.log(JSON.stringify({ plans, collisions: collisions.map(([f, s]) => ({ firstCategoryId: f, overalls: [...s] })) }, null, 2));
  } else {
    const changed = plans.filter((p) => p.nameChanges.length);
    console.log('=== STRUCTURAL NAME CHANGES ===');
    changed.forEach((p) => {
      console.log(`\n• ${p.id}`);
      p.nameChanges.forEach((c) => console.log(`    ${c.field}: "${c.old}" → "${c.new}"`));
    });
    console.log(`\n(${changed.length} docs get name changes; ${plans.length - changed.length} unchanged)\n`);

    const overalls = [...new Set(plans.map((p) => `${p.overallCategoryId}`))].sort();
    console.log(`=== SLUGS TO MINT (all ${plans.length} docs) ===`);
    console.log(`overallCategoryId — ${overalls.length} distinct: ${overalls.join(', ')}`);
    console.log(`firstCategoryId   — ${new Set(plans.map((p) => p.firstCategoryId)).size} distinct`);

    console.log(`\n=== firstCategoryId COLLISIONS (same first-slug under >1 overall) ===`);
    if (!collisions.length) console.log('  none ✓');
    else collisions.forEach(([f, s]) => console.log(`  ⚠️  "${f}" appears under overalls: ${[...s].join(', ')}`));
  }

  if (!COMMIT) {
    console.error('\n📖 DRY RUN complete — nothing written. Re-run with --commit to apply.\n');
    return;
  }

  // --- WRITE PATH (only with --commit) ---
  let batch = db.batch();
  let n = 0, total = 0;
  for (const p of plans) {
    batch.set(db.collection('categories').doc(p.id), {
      overall_category: p.next.overall_category,
      first_category: p.next.first_category,
      second_category: p.next.second_category,
      overallCategoryId: p.overallCategoryId,
      firstCategoryId: p.firstCategoryId,
    }, { merge: true });
    n++; total++;
    if (n >= 400) { await batch.commit(); batch = db.batch(); n = 0; }
  }
  if (n) await batch.commit();
  console.error(`\n✍️  COMMITTED ${total} category docs (slugs minted + structural fixes).\n`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('❌ migrate-categories-slugs failed:', err.message);
  process.exit(1);
});
