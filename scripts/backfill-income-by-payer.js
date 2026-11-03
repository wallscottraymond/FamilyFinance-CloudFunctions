#!/usr/bin/env node
/**
 * backfill-income-by-payer.js — link past deposits to the income line whose description they
 * exactly match, for the ones Plaid never listed (AF-08). The same decision and writes as a sync.
 *
 * DRY-RUN by default (reads only), printing every deposit it would link; --commit to write.
 * Run `npm run build` first.
 *   node scripts/backfill-income-by-payer.js [--user <uid>] [--commit]
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
admin.firestore().settings({ ignoreUndefinedProperties: true }); // as the deployed functions
const L = (rel) => require(path.join(__dirname, '..', 'lib', 'functions', rel));

(async () => {
  const { link_income_by_payer_orchestrator } = L('orchestrators/plaid/link_income_by_payer.orchestrator.js');
  const { run_sync_follow_ups } = L('orchestrators/plaid/sync_follow_ups.js');
  const { match_deposits_to_income_lines } = L('domain/recurring/income_payer_match.service.js');
  const { is_other_income_split } = L('domain/recurring/stream_membership.js');
  const { load_category_catalog } = L('resolvers/shared/category_catalog.resolver.js');
  const { resolve_split_category } = L('domain/transactions/split_category.service.js');
  const { split_category_input_from_raw } = L('domain/transactions/split_category_edit.service.js');
  const { inflow_repo } = L('repositories/inflow.repo.js');
  const { transaction_repo } = L('repositories/transaction.repo.js');
  const ctx = { trace_id: 'backfill-income-payer', span_id: 'x' };
  const catalog = await load_category_catalog(ctx);
  const users = ONLY_USER ? [ONLY_USER] : (await admin.firestore().collection('users').select().get()).docs.map((d) => d.id);
  let total = 0;
  for (const uid of users) {
    const txns = await transaction_repo.get_active_in_date_range(ctx, uid, Date.UTC(2020, 0, 1), Date.now());
    const docs = txns.map((t) => t.data).filter((d) => d.userId === uid && d.type === 'income');
    if (!docs.length) continue;
    const lines = await inflow_repo.get_by_user_id(ctx, uid);
    const deposits = docs.map((d) => ({
      plaid_id: d.transactionId, name: d.name ?? null, account_id: d.accountId ?? null,
      date_ms: d.transactionDate.toMillis(), is_pending: d.isPending === true,
      is_other_income: (d.splits ?? []).length > 0 && (d.splits ?? []).every((s) => is_other_income_split(
        s, resolve_split_category(split_category_input_from_raw(s, d, catalog), catalog).semantic_code, false, true)),
    }));
    const found = match_deposits_to_income_lines(deposits, lines.map((l) => ({
      id: l.id, description: l.description, account_id: l.account_id,
      first_date_ms: l.first_date ? l.first_date.toMillis() : null,
      is_active: l.is_active, is_hidden: l.is_hidden, transaction_ids: l.transaction_ids ?? [],
      removal_intervals: l.removal_intervals ?? [],
    })));
    const count = [...found.values()].flat().length;
    console.log(`${uid}: ${docs.length} deposits, ${lines.length} income lines, ${count} to link`);
    for (const [line, ids] of found) {
      for (const d of docs.filter((x) => ids.includes(x.transactionId))) {
        console.log(`  ${d.transactionDate.toDate().toISOString().slice(0, 10)} ${Number(d.amount).toFixed(2).padStart(10)} ${String(d.name).slice(0, 44)} → ${line.slice(0, 8)}`);
      }
    }
    // An earlier run may have stopped between the line and the transaction: this finishes it.
    const unfinished = docs.filter((d) => lines.some((l) => (l.payer_matched_transaction_ids ?? []).includes(d.transactionId))
      && (d.splits ?? []).every((sp) => !sp.inflowId));
    for (const d of unfinished) console.log(`  unfinished: ${d.transactionDate.toDate().toISOString().slice(0, 10)} ${Number(d.amount).toFixed(2)} ${String(d.name).slice(0, 44)}`);
    if (COMMIT && (count || unfinished.length)) {
      const r = await link_income_by_payer_orchestrator(ctx, uid, `backfill_${Date.now()}`, docs);
      await run_sync_follow_ups(ctx, uid, r.follow_ups);
    }
    total += count;
  }
  console.log(`${COMMIT ? 'LINKED' : 'DRY RUN, would link'} ${total}`);
})().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
