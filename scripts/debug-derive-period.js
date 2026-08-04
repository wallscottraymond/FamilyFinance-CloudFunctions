#!/usr/bin/env node
/**
 * debug-derive-period.js — reproduce the derive_period pipeline for one user/period
 * against LIVE data (read-only) to surface the INTERNAL error's real cause.
 * Usage: node scripts/debug-derive-period.js <uid> <YYYY-MM> [weekly|monthly|bi_monthly]
 */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const admin = require('firebase-admin');
const PROJECT_ID = 'family-budget-app-cb59b';

function cred() {
  for (const p of [process.env.GOOGLE_APPLICATION_CREDENTIALS, path.join(os.homedir(), 'google-service-account-key.json')].filter(Boolean)) {
    if (fs.existsSync(p)) { console.error('🔑', p); return admin.credential.cert(require(p)); }
  }
  return admin.credential.applicationDefault();
}
const L = (rel) => require(path.join(__dirname, '..', 'lib', 'functions', rel));

async function main() {
  const [uid, month, cadence = 'monthly'] = process.argv.slice(2);
  if (!uid || !month) { console.error('usage: <uid> <YYYY-MM> [cadence]'); process.exit(1); }
  admin.initializeApp({ credential: cred(), projectId: PROJECT_ID });

  const { resolve_period_derivation_deps } = L('resolvers/periods/period_derivation.resolver.js');
  const { owned_splits_for_budget } = L('domain/budgets/budget_spend_match.service.js');
  const { derive_budget_view_periods } = L('domain/budgets/budget_view.service.js');
  const { generate_expected_occurrences_in_window } = L('domain/outflows/outflow_period.service.js');
  const { reconcile_occurrences } = L('domain/recurring/reconcile_occurrences.service.js');
  const { place_occurrences } = L('domain/recurring/occurrence_placement.service.js');

  const [y, m] = month.split('-').map(Number);
  const start = Date.UTC(y, m - 1, 1);
  const end = Date.UTC(y, m, 0, 23, 59, 59);
  const ctx = { trace_id: 'debug', span_id: 'debug' };

  console.error(`\n▶ derive_period(${uid}, ${cadence}, ${month})\n`);
  let deps;
  try {
    deps = await resolve_period_derivation_deps(ctx, uid, cadence, start, end);
  } catch (e) {
    console.error('❌ RESOLVER threw:', e && e.stack ? e.stack : e);
    process.exit(1);
  }
  console.error(`resolver ok: budgets=${deps.budgets.length}, real=${deps.real_budgets.length}, splits=${deps.splits_for_match.length}, recurring=${deps.recurring.length}, buckets=${deps.view_buckets.length}`);

  for (const b of deps.budgets) {
    try {
      const eeId = b.is_ee ? b.id : (deps.monthly_ee_id || deps.any_ee_id);
      const owned = owned_splits_for_budget(b.id, deps.real_budgets, eeId, deps.splits_for_match);
      const periods = derive_budget_view_periods(b.id, deps.view_buckets, b.monthly_periods, owned);
      const p = periods[0];
      console.log(`  ✅ budget "${b.name}" (${b.id})${b.is_ee ? ' [EE]' : ''}: spent ${p ? p.spent : '—'} / alloc ${p ? p.allocated_amount : '—'} (monthlyPeriods=${b.monthly_periods.length}, owned=${owned.length})`);
    } catch (e) {
      console.error(`  ❌ budget "${b.name}" (${b.id}) threw:`, e && e.stack ? e.stack : e);
    }
  }
  for (const r of deps.recurring) {
    try {
      const expected = generate_expected_occurrences_in_window(r.schedule, deps.span_start_ms, deps.span_end_ms)
        .map((g) => ({ occurrence_id: `${r.id}_${g.due_date_ms}`, recurring_id: r.id, due_date_ms: g.due_date_ms, amount_due: g.amount_due }));
      const rec = reconcile_occurrences(expected, r.payments);
      place_occurrences(rec, deps.placement_buckets);
      console.log(`  ✅ ${r.kind} "${r.name}": expected=${expected.length}, payments=${r.payments.length}`);
    } catch (e) {
      console.error(`  ❌ ${r.kind} "${r.name}" threw:`, e && e.stack ? e.stack : e);
    }
  }
  console.error('\n✅ done (no throw = pipeline is clean for this user/period).');
  process.exit(0);
}
main().catch((e) => { console.error('fatal:', e && e.stack ? e.stack : e); process.exit(2); });
