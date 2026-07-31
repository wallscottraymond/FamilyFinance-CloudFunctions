#!/usr/bin/env node
/**
 * gen-categories-seed.js — regenerate the category SEED files from LIVE Firestore.
 *
 * READ-ONLY against Firestore (only .get()). Writes two LOCAL files so the seed
 * data can never drift from / revert the live `categories` collection:
 *   1. categories-data.json                          (pure data: { categories: {...} })
 *   2. src/functions/admin/uploadCategoriesData.ts   (embedded copy + uploader fn)
 *
 * The regenerated uploader uses `set(..., { merge: true })` so a future re-run can
 * never destroy fields (e.g. the overallCategoryId/firstCategoryId slugs).
 *
 * Usage: node scripts/gen-categories-seed.js
 */

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const admin = require('firebase-admin');

const PROJECT_ID = 'family-budget-app-cb59b';
const ROOT = path.join(__dirname, '..');
const JSON_PATH = path.join(ROOT, 'categories-data.json');
const TS_PATH = path.join(ROOT, 'src', 'functions', 'admin', 'uploadCategoriesData.ts');

function resolveCredential() {
  const candidates = [
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    path.join(os.homedir(), 'google-service-account-key.json'),
    path.join(os.homedir(), '.config/firebase/service-accounts', `${PROJECT_ID}.json`),
    path.join(ROOT, 'serviceAccount.json'),
  ].filter(Boolean);
  for (const p of candidates) {
    try { if (fs.existsSync(p)) { console.error(`🔑 key: ${p}`); return admin.credential.cert(require(p)); } } catch (_e) { /* next */ }
  }
  return admin.credential.applicationDefault();
}

// Stable field order per entry (mirrors the old file's shape + adds slugs).
const FIELD_ORDER = [
  'name', 'primary_plaid_category', 'detailed_plaid_category', 'description', 'type',
  'second_category', 'first_category', 'overall_category',
  'overallCategoryId', 'firstCategoryId',
  'visible_by_default', 'budget_selection', 'income_selection', 'index', 'isActive',
];

function orderFields(data) {
  const out = {};
  for (const k of FIELD_ORDER) if (data[k] !== undefined) out[k] = data[k];
  for (const k of Object.keys(data)) if (!(k in out)) out[k] = data[k]; // any extras, last
  return out;
}

const TS_TAIL = `
// Categories upload function
export const uploadCategoriesData = onCall({ cors: true }, async (request) => {
  try {
    console.log('Starting categories upload...');
    const db = getFirestore();

    const fullCategoriesData = CATEGORIES_DATA;
    const categories = Object.keys(fullCategoriesData) as (keyof typeof fullCategoriesData)[];
    const batchSize = 500;
    let uploadedCount = 0;

    for (let i = 0; i < categories.length; i += batchSize) {
      const batch = db.batch();
      const batchCategories = categories.slice(i, i + batchSize);

      batchCategories.forEach((categoryId) => {
        const categoryRef = db.collection('categories').doc(categoryId);
        // merge:true — never destroy out-of-band fields (e.g. the *CategoryId slugs).
        batch.set(categoryRef, {
          ...fullCategoriesData[categoryId],
          isActive: true,
        }, { merge: true });
      });

      await batch.commit();
      uploadedCount += batchCategories.length;
      console.log(\`Uploaded batch: \${uploadedCount}/\${categories.length} categories\`);
    }

    console.log(\`Successfully uploaded all \${uploadedCount} categories\`);
    return { success: true, count: uploadedCount };
  } catch (error) {
    console.error('Error uploading categories:', error);
    throw new HttpsError('internal', 'Failed to upload categories: ' + (error as Error).message);
  }
});
`;

async function main() {
  admin.initializeApp({ credential: resolveCredential(), projectId: PROJECT_ID });
  const db = admin.firestore();
  console.error(`📖 READ-ONLY · pulling live categories from ${PROJECT_ID}\n`);

  const snap = await db.collection('categories').get();
  const entries = snap.docs
    .map((d) => ({ id: d.id, data: orderFields(d.data()) }))
    .sort((a, b) => (a.data.index ?? 1e9) - (b.data.index ?? 1e9) || a.id.localeCompare(b.id));

  const map = {};
  for (const e of entries) map[e.id] = e.data;

  // 1. categories-data.json
  fs.writeFileSync(JSON_PATH, JSON.stringify({ categories: map }, null, 2) + '\n');

  // 2. uploadCategoriesData.ts
  const header =
    `import { onCall, HttpsError } from 'firebase-functions/v2/https';\n` +
    `import { getFirestore } from 'firebase-admin/firestore';\n\n` +
    `// Embedded categories data (all ${entries.length} categories).\n` +
    `// GENERATED from live Firestore by scripts/gen-categories-seed.js — do NOT hand-edit;\n` +
    `// regenerate after any change to the categories collection so the seed never drifts.\n` +
    `const CATEGORIES_DATA = ${JSON.stringify(map, null, 2)};\n`;
  fs.writeFileSync(TS_PATH, header + TS_TAIL);

  console.error(`✍️  wrote ${entries.length} categories →`);
  console.error(`     ${path.relative(ROOT, JSON_PATH)}`);
  console.error(`     ${path.relative(ROOT, TS_PATH)}`);
  const withSlugs = entries.filter((e) => e.data.overallCategoryId && e.data.firstCategoryId).length;
  console.error(`     (${withSlugs}/${entries.length} carry overallCategoryId + firstCategoryId)\n`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('❌ gen-categories-seed failed:', err.message);
  process.exit(1);
});
