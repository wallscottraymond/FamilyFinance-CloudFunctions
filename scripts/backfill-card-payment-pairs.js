#!/usr/bin/env node
/**
 * backfill-card-payment-pairs.js — mark which past card payments have both sides in their view
 * (`cardPaymentPaired`, Trustworthy-Numbers D6). The classifier keeps the last 180 days current;
 * this covers history. Same decision as the classifier (resolve_card_payment_pairs, built lib/).
 *
 * DRY-RUN by default (reads only), printing every pair it would mark; --commit to write. Only
 * changed marks are written. Run `npm run build` first.
 *   node scripts/backfill-card-payment-pairs.js [--user <uid>] [--commit]
 */
'use strict';
const path = require('path'), fs = require('fs'), os = require('os');
const admin = require('firebase-admin');
const COMMIT = process.argv.includes('--commit');
const userArg = process.argv.indexOf('--user');
const ONLY_USER = userArg > 0 ? process.argv[userArg + 1] : null;
const key = [process.env.GOOGLE_APPLICATION_CREDENTIALS, path.join(os.homedir(), 'google-service-account-key.json')]
  .filter(Boolean).find((p) => fs.existsSync(p));
admin.initializeApp({ credential: admin.credential.cert(require(key)), projectId: 'family-budget-app-cb59b' });
const L = (rel) => require(path.join(__dirname, '..', 'lib', 'functions', rel));

(async () => {
  const { resolve_card_payment_pairs } = L('resolvers/transactions/transfer_roles.resolver.js');
  const { load_category_catalog } = L('resolvers/shared/category_catalog.resolver.js');
  const { transaction_repo } = L('repositories/transaction.repo.js');
  const ctx = { trace_id: 'backfill-card-pairs', span_id: 'x' };
  const catalog = await load_category_catalog(ctx);
  const from = Date.UTC(2020, 0, 1), to = Date.now();
  const users = ONLY_USER ? [ONLY_USER] : (await admin.firestore().collection('users').select().get()).docs.map((d) => d.id);
  let total = 0;
  for (const uid of users) {
    const txns = await transaction_repo.get_active_in_date_range(ctx, uid, from, to);
    if (!txns.length) continue;
    const paired = await resolve_card_payment_pairs(ctx, uid, from, to, catalog, txns);
    const changed = new Map();
    for (const t of txns) {
      if (t.data.userId !== uid) continue;
      const next = paired.has(t.id);
      if (next !== (t.data.cardPaymentPaired === true)) changed.set(t.id, next);
    }
    console.log(`${uid}: ${txns.length} transactions, ${paired.size} paired, ${changed.size} to write`);
    for (const t of txns) {
      if (!changed.has(t.id)) continue;
      console.log(`  ${t.data.transactionDate.toDate().toISOString().slice(0, 10)} ${String(t.data.type).padEnd(7)} ${Number(t.data.amount).toFixed(2).padStart(10)} ${t.data.plaidDetailedCategory} | ${String(t.data.name).slice(0, 40)}`);
    }
    if (COMMIT && changed.size) await transaction_repo.set_card_payment_paired(ctx, changed, `backfill_${Date.now()}`);
    total += changed.size;
  }
  console.log(`${COMMIT ? 'WROTE' : 'DRY RUN, would write'} ${total}`);
})().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
