#!/usr/bin/env node
/**
 * smoke-derive-recurring-view.js — READ-ONLY smoke test for Phase 3 of the
 * Derive-On-Read Period Architecture (bills + income).
 *
 * Runs the SHIPPED pure pipeline (generate → reconcile → place) for a sample of
 * real recurring items against LIVE data, exercising the same reads the resolver
 * does. There is NO stored parity target (the stored bills/income period docs are
 * broken), so this validates the pipeline produces a sensible schedule + places
 * occurrences into the viewed cadence + reconciles against the item's ACTUAL
 * linked transactions (paid ≈ #linked payments).
 *
 * NEVER writes: only .get()/.where().
 *
 * Usage:
 *   node scripts/smoke-derive-recurring-view.js [--kind outflow|inflow]
 *                                               [--cadence weekly|monthly|bi_monthly]
 *                                               [--items <n>] [--months <n>]
 *
 * Prereq: `npm run build` (reads compiled services from ./lib).
 */

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const admin = require('firebase-admin');

const PROJECT_ID = 'family-budget-app-cb59b';

function req(rel) {
  const p = path.join(__dirname, '..', 'lib', 'functions', rel);
  if (!fs.existsSync(p)) {
    console.error(`❌ Missing compiled ${p}. Run \`npm run build\`.`);
    process.exit(1);
  }
  // eslint-disable-next-line import/no-dynamic-require, global-require
  return require(p);
}
const { generate_expected_occurrences_in_window } = req('domain/outflows/outflow_period.service.js');
const { reconcile_occurrences } = req('domain/recurring/reconcile_occurrences.service.js');
const { place_occurrences } = req('domain/recurring/occurrence_placement.service.js');

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
        // eslint-disable-next-line global-require, import/no-dynamic-require
        return admin.credential.cert(require(p));
      }
    } catch (_e) { /* keep trying */ }
  }
  return admin.credential.applicationDefault();
}

function parseArgs(argv) {
  const a = { kind: 'outflow', cadence: 'monthly', items: 5, months: 8 };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--kind') a.kind = argv[++i];
    else if (x === '--cadence') a.cadence = argv[++i];
    else if (x === '--items') a.items = parseInt(argv[++i], 10);
    else if (x === '--months') a.months = parseInt(argv[++i], 10);
  }
  return a;
}

const ms = (ts) => (ts && typeof ts.toMillis === 'function' ? ts.toMillis() : null);
const iso = (msVal) => (msVal ? new Date(msVal).toISOString().slice(0, 10) : 'null');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  admin.initializeApp({ credential: resolveCredential(), projectId: PROJECT_ID });
  const db = admin.firestore();

  const collection = args.kind === 'inflow' ? 'inflows' : 'outflows';
  const linkField = args.kind === 'inflow' ? 'inflowId' : 'outflowId';
  console.error(
    `\n▶ Smoke: derive [${args.kind}] view [${args.cadence}] — ${args.items} item(s), ${args.months}mo window\n`
  );

  // Pick active items that HAVE actual transactions (so reconciliation has input).
  const snap = await db.collection(collection).where('isActive', '==', true).limit(200).get();
  const items = snap.docs
    .map((d) => ({ id: d.id, data: d.data() }))
    .filter((it) => Array.isArray(it.data.transactionIds) && it.data.transactionIds.length > 0)
    .slice(0, args.items);

  if (items.length === 0) {
    console.error('No active items with transactionIds found.');
    process.exit(0);
  }

  let okCount = 0;
  for (const it of items) {
    const d = it.data;
    const userId = d.userId || d.ownerId;
    const lastMs = ms(d.lastDate) || Date.now();
    const windowEnd = lastMs;
    const windowStart = lastMs - args.months * 30 * 24 * 60 * 60 * 1000;

    // Buckets: source_periods of the view cadence overlapping the window.
    const spSnap = await db
      .collection('source_periods')
      .where('startDate', '>=', admin.firestore.Timestamp.fromMillis(windowStart - 31 * 864e5))
      .where('startDate', '<=', admin.firestore.Timestamp.fromMillis(windowEnd))
      .get();
    const buckets = spSnap.docs
      .map((b) => b.data())
      .filter((b) => b.type === args.cadence && ms(b.endDate) >= windowStart)
      .map((b) => ({ period_id: b.periodId, start_ms: ms(b.startDate), end_ms: ms(b.endDate) }));
    if (buckets.length === 0) { console.log(`· ${it.id} (${d.frequency}): no ${args.cadence} buckets`); continue; }
    const spanStart = Math.min(...buckets.map((b) => b.start_ms));
    const spanEnd = Math.max(...buckets.map((b) => b.end_ms));

    // Generate expected occurrences (fresh from schedule).
    const expectedRaw = generate_expected_occurrences_in_window(
      { frequency: d.frequency, average_amount: d.averageAmount,
        first_date: d.firstDate, last_date: d.lastDate, predicted_next_date: d.predictedNextDate || null },
      spanStart, spanEnd
    );
    const expected = expectedRaw.map((g) => ({
      occurrence_id: `${it.id}_${g.due_date_ms}`, recurring_id: it.id,
      due_date_ms: g.due_date_ms, amount_due: g.amount_due,
    }));

    // Actual payments: splits linked to this item over the span.
    const txSnap = await db.collection('transactions')
      .where('userId', '==', userId)
      .where('transactionDate', '>=', admin.firestore.Timestamp.fromMillis(spanStart))
      .where('transactionDate', '<=', admin.firestore.Timestamp.fromMillis(spanEnd))
      .get();
    const payments = [];
    for (const t of txSnap.docs) {
      const td = t.data();
      if (td.isActive === false) continue;
      for (const s of td.splits || []) {
        if (s[linkField] === it.id) {
          payments.push({ transaction_id: t.id, split_id: s.splitId || s.id || null,
            date_ms: ms(td.transactionDate), amount: Math.abs(s.amount || 0) });
        }
      }
    }

    const reconciled = reconcile_occurrences(expected, payments);
    const paid = reconciled.filter((o) => o.is_paid).length;
    const groups = place_occurrences(reconciled, buckets);
    const placed = groups.reduce((n, g) => n + g.count_in_period, 0);
    const dueGroups = groups.filter((g) => g.is_due_period);

    const name = d.userCustomName || d.merchantName || d.payerName || d.description || it.id;
    // Sanity: every placed occurrence came from expected; paid ≤ payments; placed ≤ expected.
    const sane = placed <= expected.length && paid <= payments.length && paid <= expected.length;
    if (sane) okCount++;
    console.log(
      `${sane ? '✅' : '❌'} ${name} [${d.frequency}] ${iso(spanStart)}→${iso(spanEnd)}: ` +
      `expected=${expected.length}, payments=${payments.length}, paid=${paid}, ` +
      `placed=${placed} across ${dueGroups.length} due ${args.cadence} period(s)`
    );
    if (dueGroups.length) {
      const g = dueGroups[0];
      console.log(`     e.g. ${g.period_id}: due $${g.total_due}, paid $${g.total_paid}, status ${g.status}`);
    }
  }

  console.log(`\n${okCount === items.length ? '✅' : '⚠️'} ${okCount}/${items.length} items produced sane derivations.`);
  process.exit(okCount === items.length ? 0 : 1);
}

main().catch((e) => { console.error('smoke error:', e); process.exit(2); });
