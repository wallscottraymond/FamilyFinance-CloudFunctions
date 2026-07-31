#!/usr/bin/env node
/**
 * seed-missing-categories.js — add category docs for Plaid detaileds not yet in
 * the `categories` collection (surfaced by the Phase-4 backfill). Each new doc's
 * id == its Plaid detailed, mapped into an EXISTING overall bucket + slug so it
 * classifies consistently. Uses merge:true (idempotent).
 *
 * DRY-RUN by default; pass --commit to write.
 * After committing, re-run gen-categories-seed.js to keep the seed files in sync.
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

// New docs keyed by id (== detailed_plaid_category). Mapped into existing overalls/slugs.
const NEW = {
  OTHER_OTHER: {
    primary_plaid_category: 'OTHER', type: 'Outflow',
    overall_category: 'Other', first_category: 'Other', second_category: 'Uncategorized',
    overallCategoryId: 'other', firstCategoryId: 'other',
    description: 'Uncategorized / other transactions',
    visible_by_default: true, budget_selection: true, income_selection: false, index: 200,
  },
  // The engine defaults a split with no/unknown Plaid category to "OTHER_EXPENSE";
  // seeding it makes every uncategorized txn (present + future) resolve to "Other".
  OTHER_EXPENSE: {
    primary_plaid_category: 'OTHER', type: 'Outflow',
    overall_category: 'Other', first_category: 'Other', second_category: 'Uncategorized',
    overallCategoryId: 'other', firstCategoryId: 'other',
    description: 'Default bucket for transactions with no/unknown category',
    visible_by_default: true, budget_selection: true, income_selection: false, index: 206,
  },
  INCOME_SALARY: {
    primary_plaid_category: 'INCOME', type: 'Income',
    overall_category: 'Income', first_category: 'Wages', second_category: 'Salary',
    overallCategoryId: 'income', firstCategoryId: 'wages',
    description: 'Salary income',
    visible_by_default: true, budget_selection: false, income_selection: true, index: 201,
  },
  INCOME_OTHER: {
    primary_plaid_category: 'INCOME', type: 'Income',
    overall_category: 'Income', first_category: 'Other Income', second_category: 'Other Income',
    overallCategoryId: 'income', firstCategoryId: 'other_income',
    description: 'Other income',
    visible_by_default: true, budget_selection: false, income_selection: true, index: 202,
  },
  TRANSFER_OUT_TRANSFER_OUT_FROM_APPS: {
    primary_plaid_category: 'TRANSFER_OUT', type: 'Outflow',
    overall_category: 'Outbound Account Transfer', first_category: 'Outbound Transfer', second_category: 'App Transfer',
    overallCategoryId: 'outbound_account_transfer', firstCategoryId: 'outbound_transfer',
    description: 'Outbound transfer via payment apps',
    visible_by_default: true, budget_selection: false, income_selection: false, index: 203,
  },
  TRANSFER_IN_TRANSFER_IN_FROM_APPS: {
    primary_plaid_category: 'TRANSFER_IN', type: 'Income',
    overall_category: 'Inbound Account Transfer', first_category: 'Inbound Transfer', second_category: 'App Transfer',
    overallCategoryId: 'inbound_account_transfer', firstCategoryId: 'inbound_transfer',
    description: 'Inbound transfer via payment apps',
    visible_by_default: true, budget_selection: false, income_selection: false, index: 204,
  },
  LOAN_PAYMENTS_BNPL: {
    primary_plaid_category: 'LOAN_PAYMENTS', type: 'Outflow',
    overall_category: 'Loan Payment', first_category: 'Loan Payment', second_category: 'Buy Now Pay Later',
    overallCategoryId: 'loan_payment', firstCategoryId: 'loan_payment',
    description: 'Buy Now Pay Later installment payments',
    visible_by_default: true, budget_selection: true, income_selection: false, index: 205,
  },
};

async function main() {
  admin.initializeApp({ credential: cred(), projectId: PROJECT_ID });
  const db = admin.firestore();
  console.error(`${COMMIT ? '✍️  COMMIT' : '📖 DRY RUN'} · seed ${Object.keys(NEW).length} category docs · ${PROJECT_ID}\n`);

  let created = 0, exists = 0;
  for (const [id, fields] of Object.entries(NEW)) {
    const ref = db.collection('categories').doc(id);
    const snap = await ref.get();
    const doc = { name: id, detailed_plaid_category: id, ...fields, isActive: true };
    console.error(`• ${id}  →  ${fields.overall_category} / ${fields.first_category} / ${fields.second_category}  [${fields.type}]  ${snap.exists ? '(exists — will merge)' : '(NEW)'}`);
    if (snap.exists) exists++; else created++;
    if (COMMIT) await ref.set(doc, { merge: true });
  }
  console.error(`\n${COMMIT ? '✅ wrote' : 'would write'} ${Object.keys(NEW).length} (${created} new, ${exists} existing).`);
  if (!COMMIT) console.error('Re-run with --commit to apply, then re-run gen-categories-seed.js.');
}
main().then(() => process.exit(0)).catch((e) => { console.error('❌', e.message); process.exit(1); });
