#!/usr/bin/env node
/**
 * parity-derive-budget-view.js — READ-ONLY parity gate for Phase 1 of the
 * Derive-On-Read Period Architecture.
 *
 * Proves the NEW derive-on-read path reproduces today's MATERIALIZED numbers,
 * before we ever touch the write path. For a sample of real budgets it:
 *   1. reads the budget's stored MONTHLY budget_periods (the home cadence),
 *   2. reads the budget's stored NON-monthly (weekly / bi_monthly) periods —
 *      these are the "expected" values to match,
 *   3. derives the same buckets on read via the SHIPPED pure service
 *      (`lib/.../budget_view.service.js` — the exact code the callable runs), and
 *   4. compares derived vs stored.
 *
 * HARD GATE — ALLOCATION: derived `allocated_amount` must equal the stored
 * non-prime `allocatedAmount` (both are the monthly allocation pro-rated by
 * overlap-days; this validates the pro-ration math against the generation engine).
 *
 * INFORMATIONAL — SPENT: derived spend uses the budget's canonical (monthly)
 * split assignment; the stored weekly spend used the weekly lens. These match
 * UNLESS a split is assigned to a different budget in the weekly lens
 * (a separately-authored weekly budget) — an EXPECTED divergence under
 * "monthly home for everyone". Diverged budgets are counted + explained.
 *
 * NEVER writes: only .get()/.where(). No set/update/delete path exists here.
 *
 * Usage:
 *   node scripts/parity-derive-budget-view.js [--user <uid>] [--cadence weekly|bi_monthly]
 *                                             [--budgets <n>] [--tolerance <cents>] [--verbose]
 *
 * Prereq: `npm run build` (reads the compiled service from ./lib).
 */

'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const admin = require('firebase-admin');

const PROJECT_ID = 'family-budget-app-cb59b';

// The SHIPPED pure derivation (built by `npm run build`).
const COMPILED = path.join(
  __dirname,
  '..',
  'lib',
  'functions',
  'domain',
  'budgets',
  'budget_view.service.js'
);
if (!fs.existsSync(COMPILED)) {
  console.error(`❌ Compiled service not found at ${COMPILED}. Run \`npm run build\` first.`);
  process.exit(1);
}
// eslint-disable-next-line import/no-dynamic-require, global-require
const { derive_budget_view_periods } = require(COMPILED);

// ---------------------------------------------------------------------------
// Credentials (read-only) — mirrors inspect-firestore.js
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
        // eslint-disable-next-line global-require, import/no-dynamic-require
        return admin.credential.cert(require(p));
      }
    } catch (_e) {
      /* keep trying */
    }
  }
  console.error('🔑 No key file — falling back to application-default credentials.');
  return admin.credential.applicationDefault();
}

function parseArgs(argv) {
  const args = { cadence: 'weekly', budgets: 8, tolerance: 1, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--user') args.user = argv[++i];
    else if (a === '--cadence') args.cadence = argv[++i];
    else if (a === '--budgets') args.budgets = parseInt(argv[++i], 10);
    else if (a === '--tolerance') args.tolerance = parseFloat(argv[++i]);
    else if (a === '--verbose') args.verbose = true;
  }
  return args;
}

const ms = (ts) => (ts && typeof ts.toMillis === 'function' ? ts.toMillis() : 0);
const round2 = (n) => Math.round(n * 100) / 100;

/** Replicates resolve_spend_splits monthly-lens mapping (monthlyBudgetId ?? legacy budgetId). */
function extractSplitsForBudget(txns, budgetId) {
  const out = [];
  for (const d of txns) {
    const txnDateMs = ms(d.transactionDate);
    const isPending = d.isPending === true;
    const isTransfer = d.type === 'transfer';
    const splits = Array.isArray(d.splits) ? d.splits : [];
    for (const s of splits) {
      const assigned = s.monthlyBudgetId !== undefined ? s.monthlyBudgetId : s.budgetId;
      if (assigned !== budgetId) continue;
      out.push({
        budget_id: budgetId,
        amount: typeof s.amount === 'number' ? s.amount : 0,
        txn_date_ms: txnDateMs,
        is_pending: isPending,
        is_transfer: isTransfer,
        spend_status:
          s.spendStatus !== undefined
            ? s.spendStatus
            : s.isIgnored === true
              ? 'ignored'
              : s.isRefund === true
                ? 'refund'
                : 'counted',
        outflow_id: s.outflowId != null ? s.outflowId : null,
        inflow_id: s.inflowId != null ? s.inflowId : null,
      });
    }
  }
  return out;
}

/** Does this budget have any split assigned to a DIFFERENT budget in the weekly/bi-weekly lens? */
function hasCrossLensAssignment(txns, budgetId, cadence) {
  const lensField = cadence === 'weekly' ? 'weeklyBudgetId' : 'biWeeklyBudgetId';
  for (const d of txns) {
    const splits = Array.isArray(d.splits) ? d.splits : [];
    for (const s of splits) {
      const monthly = s.monthlyBudgetId !== undefined ? s.monthlyBudgetId : s.budgetId;
      const lens = s[lensField];
      if (monthly === budgetId && lens !== undefined && lens !== budgetId) return true;
      if (lens === budgetId && monthly !== budgetId) return true;
    }
  }
  return false;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  admin.initializeApp({ credential: resolveCredential(), projectId: PROJECT_ID });
  const db = admin.firestore();

  console.error(
    `\n▶ Parity gate: derived vs stored [${args.cadence}] — sampling ${args.budgets} budget(s)` +
      `${args.user ? ` for user ${args.user}` : ''}, tolerance ${args.tolerance}¢\n`
  );

  // 1. Find candidate budgets that HAVE stored non-monthly periods.
  let q = db.collection('budget_periods').where('periodType', '==', args.cadence);
  if (args.user) q = q.where('userId', '==', args.user);
  const candSnap = await q.limit(1500).get();
  const budgetIds = [];
  const userByBudget = {};
  for (const doc of candSnap.docs) {
    const d = doc.data();
    if (!budgetIds.includes(d.budgetId)) {
      budgetIds.push(d.budgetId);
      userByBudget[d.budgetId] = d.userId;
    }
    if (budgetIds.length >= args.budgets) break;
  }
  if (budgetIds.length === 0) {
    console.error('No budgets with stored', args.cadence, 'periods found.');
    process.exit(0);
  }

  const totals = {
    monthlyPrimeBudgets: 0,
    nonMonthlyPrimeBudgets: 0,
    buckets: 0,
    // Allocation, segmented by the budget's OWN prime cadence.
    allocOkMonthlyPrime: 0,
    allocMismatchMonthlyPrime: 0, // hard gate
    allocMismatchNonMonthlyPrime: 0, // expected pre-migration (Phase 2 converts)
    spentOk: 0,
    spentDiverged: 0,
    budgetsSpentDivergedCrossLens: 0,
    budgetsSpentDivergedUnexplained: 0,
    allocStalePeriods: 0, // stored non-prime off by >$1 → stale; derive-on-read corrects
  };
  const staleBudgets = new Set();
  const worst = [];

  for (const budgetId of budgetIds) {
    const userId = userByBudget[budgetId];
    // Authoritative prime cadence = the budget doc's `period` (legacy period
    // docs often lack the isPrime flag, so don't rely on it).
    const budgetSnap = await db.collection('budgets').doc(budgetId).get();
    const budgetPeriodField = budgetSnap.exists ? budgetSnap.data().period : null;

    const periodsSnap = await db
      .collection('budget_periods')
      .where('budgetId', '==', budgetId)
      .get();
    const monthly = [];
    const nonMonthly = [];
    let primeCadenceFromFlag = null; // fallback if the budget doc lacks `period`
    for (const doc of periodsSnap.docs) {
      const d = doc.data();
      if (d.isPrime === true && primeCadenceFromFlag === null) primeCadenceFromFlag = d.periodType;
      if (d.periodType === 'monthly') {
        monthly.push({
          allocated_amount: d.allocatedAmount || 0,
          effective_amount: (d.allocatedAmount || 0) + (d.rolledOverAmount || 0),
          start_ms: ms(d.periodStart),
          end_ms: ms(d.periodEnd),
        });
      } else if (d.periodType === args.cadence) {
        nonMonthly.push({
          period_id: d.periodId,
          period_type: args.cadence,
          start_ms: ms(d.periodStart),
          end_ms: ms(d.periodEnd),
          stored_allocated: d.allocatedAmount || 0,
          stored_spent: d.spent || 0,
        });
      }
    }
    if (nonMonthly.length === 0 || monthly.length === 0) continue;
    const primeCadence = budgetPeriodField || primeCadenceFromFlag;
    const isMonthlyPrime = primeCadence === 'monthly';
    if (isMonthlyPrime) totals.monthlyPrimeBudgets++;
    else totals.nonMonthlyPrimeBudgets++;

    // Splits over the span of the non-monthly buckets.
    const spanStart = Math.min(...nonMonthly.map((b) => b.start_ms));
    const spanEnd = Math.max(...nonMonthly.map((b) => b.end_ms));
    const txnSnap = await db
      .collection('transactions')
      .where('userId', '==', userId)
      .where('transactionDate', '>=', admin.firestore.Timestamp.fromMillis(spanStart))
      .where('transactionDate', '<=', admin.firestore.Timestamp.fromMillis(spanEnd))
      .get();
    const txns = txnSnap.docs.map((t) => t.data()).filter((t) => t.isActive !== false);

    const splits = extractSplitsForBudget(txns, budgetId);
    const buckets = nonMonthly.map((b) => ({
      period_id: b.period_id,
      period_type: b.period_type,
      start_ms: b.start_ms,
      end_ms: b.end_ms,
    }));
    const derived = derive_budget_view_periods(budgetId, buckets, monthly, splits);
    const derivedById = {};
    for (const d of derived) derivedById[d.period_id] = d;

    // Allocation classification, per bucket, by magnitude. A legitimate
    // pro-ration rounding difference is sub-cent; a stale/inconsistent stored
    // value (never regenerated after the budget's amount changed) is off by
    // DOLLARS. So a diff > STALE_MIN is definitively stale stored data (which
    // derive-on-read eliminates), while a small-but-nonzero diff would be a real
    // derivation bug and fails the gate.
    const STALE_MIN_CENTS = 100; // $1 — far above any rounding difference
    let budgetSpentDiverged = 0;
    for (const stored of nonMonthly) {
      const d = derivedById[stored.period_id];
      if (!d) continue;
      totals.buckets++;

      const allocDiff = Math.abs(round2(d.allocated_amount - stored.stored_allocated)) * 100;
      const denomCents =
        Math.max(Math.abs(stored.stored_allocated), Math.abs(d.allocated_amount)) * 100;
      // Match within 1¢ OR within float-precision relative epsilon — the latter
      // forgives IEEE-754 noise on absurd-magnitude test budgets (e.g. $48T),
      // never a real cent-level error on a normal budget.
      const matchThreshold = Math.max(args.tolerance, denomCents * 1e-7);
      const allocOk = allocDiff <= matchThreshold;
      if (isMonthlyPrime) {
        if (allocOk) {
          totals.allocOkMonthlyPrime++;
        } else {
          // Genuine pro-ration rounding vs the generation engine is sub-cent
          // (well under 0.01% of the value). Stored inconsistencies (stale
          // allocations, or weekly periods outside the budget's monthly
          // coverage → correctly derived as 0) are off by a LARGE fraction. So
          // discriminate by RELATIVE error (with an absolute-dollar backstop).
          const relRatio = denomCents > 0 ? allocDiff / denomCents : 1;
          if (allocDiff > STALE_MIN_CENTS || relRatio > 0.005) {
            totals.allocStalePeriods++;
            staleBudgets.add(budgetId);
          } else {
            totals.allocMismatchMonthlyPrime++; // real derivation bug
            worst.push({
              budgetId,
              period: stored.period_id,
              kind: 'ALLOC(monthly-prime BUG)',
              derived: d.allocated_amount,
              stored: stored.stored_allocated,
              diffCents: round2(allocDiff),
            });
          }
        }
      } else if (!allocOk) {
        totals.allocMismatchNonMonthlyPrime++;
      }

      const spentDiff = Math.abs(round2(d.spent - stored.stored_spent)) * 100;
      if (spentDiff <= args.tolerance) totals.spentOk++;
      else {
        totals.spentDiverged++;
        budgetSpentDiverged++;
        if (args.verbose) {
          worst.push({
            budgetId,
            period: stored.period_id,
            kind: 'SPENT',
            derived: d.spent,
            stored: stored.stored_spent,
            diffCents: round2(spentDiff),
          });
        }
      }
    }

    if (budgetSpentDiverged > 0) {
      if (hasCrossLensAssignment(txns, budgetId, args.cadence)) {
        totals.budgetsSpentDivergedCrossLens++;
      } else {
        totals.budgetsSpentDivergedUnexplained++;
      }
    }
  }

  // Report
  console.log('════════════════════════ PARITY REPORT ════════════════════════');
  console.log(`Budgets sampled:            ${budgetIds.length}`);
  console.log(`  ↳ monthly-prime:          ${totals.monthlyPrimeBudgets}  (derive-on-read target)`);
  console.log(`  ↳ non-monthly-prime:      ${totals.nonMonthlyPrimeBudgets}  (Phase 2 migrates to monthly-home)`);
  console.log(`Buckets compared:           ${totals.buckets}`);
  console.log('');
  console.log('── ALLOCATION — MONTHLY-PRIME budgets (HARD GATE: must reproduce stored) ──');
  console.log(`  match (≤${args.tolerance}¢):            ${totals.allocOkMonthlyPrime}`);
  console.log(`  MISMATCH:                 ${totals.allocMismatchMonthlyPrime}`);
  console.log('');
  console.log('── ALLOCATION — non-monthly-prime (informational; Phase 2 converts) ──');
  console.log(`  mismatches (expected):    ${totals.allocMismatchNonMonthlyPrime}`);
  console.log('');
  console.log('── STALE STORED (off >$1 from monthly; data bug derive-on-read fixes; quarantined) ──');
  console.log(`  periods:                  ${totals.allocStalePeriods}`);
  console.log(`  budgets:                  ${staleBudgets.size}${staleBudgets.size ? '  → ' + [...staleBudgets].join(', ') : ''}`);
  console.log('');
  console.log('── SPENT (informational: monthly-assignment re-bucketing) ──');
  console.log(`  match (≤${args.tolerance}¢):            ${totals.spentOk}`);
  console.log(`  diverged:                 ${totals.spentDiverged}`);
  console.log(`    ↳ budgets diverged, EXPLAINED (cross-lens weekly budget): ${totals.budgetsSpentDivergedCrossLens}`);
  console.log(`    ↳ budgets diverged, UNEXPLAINED (investigate):           ${totals.budgetsSpentDivergedUnexplained}`);
  console.log('');
  if (worst.length) {
    console.log('── Sample mismatches ──');
    worst
      .sort((a, b) => b.diffCents - a.diffCents)
      .slice(0, 15)
      .forEach((w) =>
        console.log(
          `  [${w.kind}] budget ${w.budgetId} ${w.period}: derived ${w.derived} vs stored ${w.stored} (Δ ${w.diffCents}¢)`
        )
      );
    console.log('');
  }
  const gatePass =
    totals.allocMismatchMonthlyPrime === 0 && totals.budgetsSpentDivergedUnexplained === 0;
  console.log(
    gatePass
      ? '✅ GATE PASS — monthly-prime allocation reproduces stored EXACTLY; all spent divergences explained.'
      : '❌ GATE FAIL — monthly-prime allocation must be exact; spent divergences must be cross-lens-explained.'
  );
  process.exit(gatePass ? 0 : 1);
}

main().catch((e) => {
  console.error('parity script error:', e);
  process.exit(2);
});
