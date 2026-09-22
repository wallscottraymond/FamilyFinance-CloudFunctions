#!/usr/bin/env node
/**
 * Read-only accuracy validation for the recurring-matcher change (period-instance candidates →
 * recurring-definition candidates). For every fuzzy-eligible transaction split it builds BOTH
 * candidate sets from LIVE data and runs the SAME pure `match_recurring` scorer (imported from
 * the built lib), then diffs the matched recurring id. Reports agreement + every disagreement.
 *
 *   node scripts/validate-recurring-match.js [--user <uid>] [--limit N]
 *
 * No writes. Credentials: same resolution as scripts/inspect-firestore.js.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const admin = require('firebase-admin');
// The ACTUAL production scorer — only the candidate SETS differ between old and new.
const { match_recurring } = require('../lib/functions/domain/transactions/match_recurring.service');

const PROJECT_ID = 'family-budget-app-cb59b';
const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_MS = 90 * DAY_MS; // old ±90d candidate window

const args = process.argv.slice(2);
const userArg = args.includes('--user') ? args[args.indexOf('--user') + 1] : null;
const limitArg = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1], 10) : Infinity;

function resolveCredential() {
  const candidates = [
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    path.join(os.homedir(), 'google-service-account-key.json'),
    path.join(os.homedir(), '.config/firebase/service-accounts', `${PROJECT_ID}.json`),
    path.join(__dirname, '..', 'serviceAccount.json'),
  ].filter(Boolean);
  for (const p of candidates) {
    try { if (fs.existsSync(p)) { console.error(`🔑 ${p}`); return admin.credential.cert(require(p)); } } catch (_e) { /* next */ }
  }
  return admin.credential.applicationDefault();
}

const ms = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : null);
function freqIntervalMs(frequency) {
  switch ((frequency || '').toLowerCase()) {
    case 'weekly': return 7 * DAY_MS;
    case 'biweekly': case 'bi_weekly': return 14 * DAY_MS;
    case 'semimonthly': case 'semi_monthly': return 15.22 * DAY_MS;
    case 'quarterly': return 91.31 * DAY_MS;
    case 'semiannually': case 'semi_annually': return 182.62 * DAY_MS;
    case 'annually': case 'annual': case 'yearly': return 365.25 * DAY_MS;
    default: return 30.44 * DAY_MS;
  }
}
function nearestOccurrenceMs(anchorMs, intervalMs, targetMs) {
  if (intervalMs <= 0) return anchorMs;
  return anchorMs + Math.round((targetMs - anchorMs) / intervalMs) * intervalMs;
}

// ---- OLD candidate builders (period instances) ----
function oldOutflowCandidates(outflowPeriods, txnMs) {
  return outflowPeriods
    .filter((p) => { const d = ms(p.firstDueDateInPeriod); return d != null && d >= txnMs - WINDOW_MS && d <= txnMs + WINDOW_MS; })
    .map((p) => ({
      period_id: p.__id, recurring_id: p.outflowId,
      merchant_name: p.merchantName ?? p.metadata?.outflowMerchantName ?? null,
      expected_amount: p.amountPerOccurrence ?? p.expectedAmount ?? p.totalAmountDue ?? 0,
      due_date_ms: ms(p.firstDueDateInPeriod),
      is_settled: ((p.transactionSplits) ?? []).length > 0,
    }));
}
function oldInflowCandidates(inflowPeriods, txnMs) {
  return inflowPeriods
    .filter((p) => { const d = ms(p.firstDueDateInPeriod); return d != null && d >= txnMs - WINDOW_MS && d <= txnMs + WINDOW_MS; })
    .map((p) => ({
      period_id: p.__id, recurring_id: p.inflowId,
      merchant_name: p.merchant ?? p.payee ?? null,
      expected_amount: p.expectedAmount ?? 0,
      due_date_ms: ms(p.firstDueDateInPeriod),
      is_settled: ((p.transactionIds) ?? []).length > 0,
    }));
}
// ---- NEW candidate builders (definitions) ----
function newOutflowCandidates(outflows, txnMs) {
  return outflows.map((o) => ({
    period_id: o.__id, recurring_id: o.__id,
    merchant_name: o.merchantName ?? null,
    expected_amount: o.expectedAmountOverride ?? o.averageAmount ?? 0,
    due_date_ms: nearestOccurrenceMs(ms(o.predictedNextDate) ?? ms(o.firstDate) ?? txnMs, freqIntervalMs(o.frequency), txnMs),
    is_settled: false,
  }));
}
function newInflowCandidates(inflows, txnMs) {
  return inflows.map((i) => ({
    period_id: i.__id, recurring_id: i.__id,
    merchant_name: i.merchantName ?? null, // inflow payer = doc.merchantName
    expected_amount: i.expectedAmountOverride ?? i.averageAmount ?? 0,
    due_date_ms: nearestOccurrenceMs(ms(i.predictedNextDate) ?? ms(i.firstDate) ?? txnMs, freqIntervalMs(i.frequency), txnMs),
    is_settled: false,
  }));
}

async function loadCol(db, name, where) {
  let q = db.collection(name);
  for (const [f, v] of where || []) q = q.where(f, '==', v);
  const snap = await q.get();
  return snap.docs.map((d) => ({ __id: d.id, ...d.data() }));
}

async function main() {
  admin.initializeApp({ credential: resolveCredential(), projectId: PROJECT_ID });
  const db = admin.firestore();

  let userId = userArg;
  if (!userId) {
    // Pick the user with the most transactions (the real account in dev==prod).
    const snap = await db.collection('transactions').select('userId').get();
    const counts = {};
    snap.docs.forEach((d) => { const u = d.data().userId; if (u) counts[u] = (counts[u] || 0) + 1; });
    userId = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
    console.error(`No --user given; using busiest user ${userId} (${counts[userId]} txns).`);
  }

  const [outflowsAll, inflowsAll, outflowPeriods, inflowPeriods, txns] = await Promise.all([
    loadCol(db, 'outflows', [['ownerId', userId]]),
    loadCol(db, 'inflows', [['ownerId', userId]]),
    loadCol(db, 'outflow_periods', [['userId', userId]]),
    loadCol(db, 'inflow_periods', [['userId', userId]]),
    loadCol(db, 'transactions', [['userId', userId]]),
  ]);
  const outflows = outflowsAll.filter((o) => o.isActive && !o.isHidden);
  const inflows = inflowsAll.filter((i) => i.isActive && !i.isHidden);
  console.error(`Loaded: ${outflows.length} bills, ${inflows.length} incomes, ${outflowPeriods.length} outflow_periods, ${inflowPeriods.length} inflow_periods, ${txns.length} txns.`);

  // Stream membership (skip deterministically-linked single-split txns — both paths agree there).
  const streamOut = new Map(); outflows.forEach((o) => (o.transactionIds ?? []).forEach((t) => streamOut.set(t, o.__id)));
  const streamIn = new Map(); inflows.forEach((i) => (i.transactionIds ?? []).forEach((t) => streamIn.set(t, i.__id)));

  let evaluated = 0, agree = 0; const disagreements = [];
  for (const txn of txns) {
    if (txn.isActive === false) continue;
    const type = txn.type ?? 'expense';
    if (type !== 'expense' && type !== 'income') continue;
    const isExpense = type === 'expense';
    const splits = txn.splits ?? [];
    const txnMs = ms(txn.transactionDate);
    if (txnMs == null) continue;
    const streamId = (isExpense ? streamOut : streamIn).get(txn.transactionId);
    if (splits.length === 1 && streamId) continue; // deterministic → identical both paths

    const oldC = isExpense ? oldOutflowCandidates(outflowPeriods, txnMs) : oldInflowCandidates(inflowPeriods, txnMs);
    const newC = isExpense ? newOutflowCandidates(outflows, txnMs) : newInflowCandidates(inflows, txnMs);
    for (const s of splits) {
      const t = { merchant_name: txn.merchantName ?? null, amount: Math.abs(s.amount ?? 0), date_ms: txnMs };
      const oldR = match_recurring(t, oldC).recurring_id;
      const newR = match_recurring(t, newC).recurring_id;
      evaluated++;
      if (oldR === newR) { agree++; }
      else {
        disagreements.push({ txn: txn.__id, merchant: txn.merchantName, amount: s.amount, type, old: oldR, new: newR });
      }
    }
    if (evaluated >= limitArg) break;
  }

  console.log('\n=== Recurring-match validation (old period-based vs new definition-based) ===');
  console.log(`Evaluated splits (fuzzy path): ${evaluated}`);
  console.log(`Agree:    ${agree}`);
  console.log(`Disagree: ${disagreements.length}`);
  if (disagreements.length) {
    console.log('\n--- Disagreements ---');
    for (const d of disagreements.slice(0, 100)) {
      console.log(`  ${d.type} ${d.txn}  "${d.merchant}"  $${d.amount}  old=${d.old ?? 'none'}  new=${d.new ?? 'none'}`);
    }
    if (disagreements.length > 100) console.log(`  …and ${disagreements.length - 100} more`);
  } else {
    console.log('\n✅ Old and new matching agree on every fuzzy-path split.');
  }
}

main().catch((e) => { console.error('❌', e); process.exit(1); });
