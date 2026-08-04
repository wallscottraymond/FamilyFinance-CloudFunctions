#!/usr/bin/env node
/**
 * ab-spend-match.js — READ-ONLY A/B: on-read spend matching vs the stored assignment.
 *
 * For a sample of budgets, computes a period's `spent` two ways over the same
 * transactions and compares:
 *   - STORED: sum splits whose stored monthly assignment (`monthlyBudgetId` ??
 *     `budgetId`) == the budget (what the app shows today).
 *   - ON-READ: resolve each split's owner on read via the SHIPPED pure matcher
 *     (`owned_splits_for_budget` → `match_budget`: manual pin → category → EE),
 *     then sum — the "instant budgets" path.
 *
 * Real budgets should match closely (proves on-read reproduces today's numbers
 * with no write-time assignment). Everything-Else is EXPECTED to differ — on-read
 * computes the single correct EE (unmatched splits), vs today's 3-separate-EE
 * undercount. NEVER writes.
 *
 * Usage: node scripts/ab-spend-match.js [--budgets <n>] [--month YYYY-MM] [--tolerance <cents>]
 * Prereq: `npm run build`.
 */

'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const admin = require('firebase-admin');
const PROJECT_ID = 'family-budget-app-cb59b';

function req(rel) {
  const p = path.join(__dirname, '..', 'lib', 'functions', rel);
  if (!fs.existsSync(p)) { console.error(`❌ Missing ${p}. Run \`npm run build\`.`); process.exit(1); }
  // eslint-disable-next-line import/no-dynamic-require, global-require
  return require(p);
}
const { owned_splits_for_budget } = req('domain/budgets/budget_spend_match.service.js');
const { compute_budget_spent } = req('domain/budgets/budget_spend.service.js');

function resolveCredential() {
  const cands = [
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    path.join(os.homedir(), 'google-service-account-key.json'),
    path.join(__dirname, '..', 'serviceAccount.json'),
  ].filter(Boolean);
  for (const p of cands) {
    try { if (fs.existsSync(p)) { console.error(`🔑 key: ${p}`); return admin.credential.cert(require(p)); } } catch (_e) { /* */ }
  }
  return admin.credential.applicationDefault();
}
function parseArgs(a) {
  const o = { budgets: 20, month: '2026-06', tolerance: 1 };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--budgets') o.budgets = parseInt(a[++i], 10);
    else if (a[i] === '--month') o.month = a[++i];
    else if (a[i] === '--tolerance') o.tolerance = parseFloat(a[++i]);
  }
  return o;
}
const ms = (ts) => (ts && ts.toMillis ? ts.toMillis() : 0);
const toCadence = (p) => (p === 'weekly' ? 'weekly' : p === 'bi_monthly' ? 'bi_monthly' : 'monthly');
const spendStatus = (s) => s.spendStatus || (s.isIgnored === true ? 'ignored' : s.isRefund === true ? 'refund' : 'counted');

async function main() {
  const args = parseArgs(process.argv.slice(2));
  admin.initializeApp({ credential: resolveCredential(), projectId: PROJECT_ID });
  const db = admin.firestore();
  const [y, m] = args.month.split('-').map(Number);
  const startMs = Date.UTC(y, m - 1, 1);
  const endMs = Date.UTC(y, m, 0, 23, 59, 59);
  console.error(`\n▶ A/B spend match — ${args.budgets} budget(s), month ${args.month}, tol ${args.tolerance}¢\n`);

  const bSnap = await db.collection('budgets').where('isActive', '==', true).limit(400).get();
  const byUser = {};
  bSnap.docs.forEach((d) => {
    const data = d.data();
    const uid = data.userId || data.ownerId;
    if (!uid) return;
    (byUser[uid] = byUser[uid] || []).push({ id: d.id, ...data });
  });

  // build per-user real budgets + EE, and a flat sample list of targets
  const targets = [];
  const userCtx = {};
  for (const uid of Object.keys(byUser)) {
    const budgets = byUser[uid];
    const real = [];
    let monthlyEE = null, anyEE = null;
    for (const b of budgets) {
      if (b.isSystemEverythingElse) { anyEE = anyEE || b.id; if (b.period === 'monthly') monthlyEE = b.id; continue; }
      real.push({ id: b.id, category_ids: b.categoryIds || [], start_ms: b.startDate ? ms(b.startDate) : 0,
        end_ms: b.isOngoing === false && b.endDate ? ms(b.endDate) : null, is_ongoing: b.isOngoing !== false, cadence: toCadence(b.period) });
    }
    userCtx[uid] = { real, monthlyEE, anyEE };
    for (const b of budgets) {
      if (targets.length >= args.budgets) break;
      targets.push({ uid, id: b.id, name: b.name || b.id, isEE: !!b.isSystemEverythingElse });
    }
  }

  const stats = { real: 0, realMatch: 0, realDiff: 0, ee: 0, eeDiff: 0 };
  const worst = [];
  const txnCache = {};
  async function loadSplits(uid) {
    if (txnCache[uid]) return txnCache[uid];
    const t = await db.collection('transactions').where('userId', '==', uid)
      .where('transactionDate', '>=', admin.firestore.Timestamp.fromMillis(startMs))
      .where('transactionDate', '<=', admin.firestore.Timestamp.fromMillis(endMs)).get();
    const rows = [];
    t.docs.forEach((doc) => {
      const d = doc.data();
      if (d.isActive === false) return;
      const dateMs = ms(d.transactionDate); const pend = d.isPending === true; const xfer = d.type === 'transfer';
      (d.splits || []).forEach((s) => rows.push({
        stored_budget: s.monthlyBudgetId !== undefined ? s.monthlyBudgetId : s.budgetId,
        amount: s.amount || 0, txn_date_ms: dateMs, is_pending: pend, is_transfer: xfer, spend_status: spendStatus(s),
        outflow_id: s.outflowId ?? null, inflow_id: s.inflowId ?? null,
        internal_match_category: s.internalDetailedCategory ?? null, plaid_match_category: s.plaidDetailedCategory || 'OTHER_EXPENSE',
        overall_category_id: s.overallCategoryId ?? null, first_category_id: s.firstCategoryId ?? null,
        manual_pin_budget_id: s.budgetAssignmentSource === 'manual' ? (s.budgetId ?? null) : null,
      }));
    });
    txnCache[uid] = rows; return rows;
  }

  for (const tg of targets) {
    const { real, monthlyEE, anyEE } = userCtx[tg.uid];
    const splits = await loadSplits(tg.uid);
    // STORED: splits whose stored monthly assignment == target
    const storedOwned = splits.filter((s) => s.stored_budget === tg.id).map((s) => ({ budget_id: tg.id, ...s }));
    const storedSpent = compute_budget_spent(tg.id, startMs, endMs, storedOwned).spent;
    // ON-READ: resolve owner via the shipped matcher
    const eeId = tg.isEE ? tg.id : (monthlyEE || anyEE);
    const onReadOwned = owned_splits_for_budget(tg.id, real, eeId, splits);
    const onReadSpent = compute_budget_spent(tg.id, startMs, endMs, onReadOwned).spent;
    const diffCents = Math.round(Math.abs(storedSpent - onReadSpent) * 100);

    if (tg.isEE) {
      stats.ee++; if (diffCents > args.tolerance) stats.eeDiff++;
    } else {
      stats.real++;
      if (diffCents <= args.tolerance) stats.realMatch++;
      else { stats.realDiff++; worst.push({ ...tg, storedSpent, onReadSpent, diffCents }); }
    }
  }

  console.log('════════════ A/B SPEND MATCH ════════════');
  console.log(`REAL budgets:            ${stats.real}`);
  console.log(`  on-read == stored:     ${stats.realMatch}`);
  console.log(`  DIVERGED:              ${stats.realDiff}`);
  console.log(`EVERYTHING-ELSE budgets: ${stats.ee}  (divergence EXPECTED — on-read fixes the undercount)`);
  console.log(`  diverged:              ${stats.eeDiff}`);
  if (worst.length) {
    console.log('\n── Real-budget divergences (investigate — manual pins / category drift / stale assignment) ──');
    worst.sort((a, b) => b.diffCents - a.diffCents).slice(0, 15).forEach((w) =>
      console.log(`  ${w.name}: stored $${w.storedSpent} vs on-read $${w.onReadSpent} (Δ ${w.diffCents}¢)`));
  }
  const pass = stats.realDiff === 0;
  console.log(`\n${pass ? '✅ PASS — on-read reproduces stored for every real budget.' : '⚠️  Real-budget divergences found (see above).'}`);
  process.exit(0);
}
main().catch((e) => { console.error('ab error:', e); process.exit(2); });
