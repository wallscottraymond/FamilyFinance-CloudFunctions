#!/usr/bin/env node
/**
 * repair-recurring-received.js — restore paid / received totals the retired legacy matchers
 * overwrote (Code-Health-Review F1 income, F3 bills).
 *
 * The legacy income alignment (F1) and bill matcher (F3) were second writers of what was paid /
 * received. They changed the period's totals but not its `reconciliation` fingerprint, so the
 * reconcile job (which skips periods whose fingerprint is unchanged, F2) never put them back.
 *
 * For every active income and bill this runs reconcile's own read + compute
 * (compute_recurring_reconciliation, from the built lib/) and compares the result to the stored
 * totals. A period is repaired when any of these differ:
 *   totalAmountPaid (to the cent), isFullyPaid, isPartiallyPaid, numberOfOccurrencesPaid
 * Repair = the reconcile job's own write (update_reconciliation) for those periods only.
 *
 * DRY-RUN by default (reads only); pass --commit to write. Run `npm run build` first.
 *   node scripts/repair-recurring-received.js [--type inflow|outflow] [--user <uid>] [--commit]
 */
'use strict';
const path = require('path'), fs = require('fs'), os = require('os');
const admin = require('firebase-admin');
const PROJECT_ID = 'family-budget-app-cb59b';
const COMMIT = process.argv.includes('--commit');
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const ONLY_TYPE = arg('--type');
const ONLY_USER = arg('--user');

function cred() {
  const c = [process.env.GOOGLE_APPLICATION_CREDENTIALS, path.join(os.homedir(), 'google-service-account-key.json')].filter(Boolean);
  for (const p of c) { try { if (fs.existsSync(p)) { console.error(`🔑 ${p}`); return admin.credential.cert(require(p)); } } catch (_e) {} }
  return admin.credential.applicationDefault();
}

const cents = (n) => Math.round((n || 0) * 100);

/** The denormalized fields reconcile writes, from its result (as update_reconciliation). */
function expected_fields(r) {
  const is_complete = r.status === 'complete' || r.status === 'over';
  return {
    totalAmountPaid: r.matched_amount + r.pending_amount + r.manual_amount,
    isFullyPaid: is_complete,
    isPartiallyPaid: r.status === 'partial',
    numberOfOccurrencesPaid: r.occurrences_paid,
  };
}

function differences(stored, want) {
  const out = [];
  if (cents(stored.totalAmountPaid) !== cents(want.totalAmountPaid)) out.push(`totalAmountPaid ${(stored.totalAmountPaid ?? 0).toFixed(2)} → ${want.totalAmountPaid.toFixed(2)}`);
  if (Boolean(stored.isFullyPaid) !== want.isFullyPaid) out.push(`isFullyPaid ${Boolean(stored.isFullyPaid)} → ${want.isFullyPaid}`);
  if (Boolean(stored.isPartiallyPaid) !== want.isPartiallyPaid) out.push(`isPartiallyPaid ${Boolean(stored.isPartiallyPaid)} → ${want.isPartiallyPaid}`);
  if ((stored.numberOfOccurrencesPaid ?? 0) !== want.numberOfOccurrencesPaid) out.push(`numberOfOccurrencesPaid ${stored.numberOfOccurrencesPaid ?? 0} → ${want.numberOfOccurrencesPaid}`);
  return out;
}

async function main() {
  admin.initializeApp({ credential: cred(), projectId: PROJECT_ID });
  const db = admin.firestore();
  db.settings({ ignoreUndefinedProperties: true }); // as in src/index.ts
  const { compute_recurring_reconciliation } = require('../lib/functions/orchestrators/recurring/reconcile_recurring_periods.orchestrator');
  const { inflow_period_repo } = require('../lib/functions/repositories/inflow_period.repo');
  const { outflow_period_repo } = require('../lib/functions/repositories/outflow_period.repo');
  console.error(`${COMMIT ? '✍️  COMMIT' : '📖 DRY RUN'} · repair paid / received totals · ${PROJECT_ID}\n`);

  const types = ONLY_TYPE ? [ONLY_TYPE] : ['inflow', 'outflow'];
  const totals = { recurring: 0, periods: 0, repair: 0, users: new Set(), errors: 0 };
  for (const type of types) {
    let q = db.collection(`${type}s`).where('isActive', '==', true);
    if (ONLY_USER) q = q.where('ownerId', '==', ONLY_USER);
    const snap = await q.get();
    for (const doc of snap.docs) {
      totals.recurring++;
      const ctx = { trace_id: `repair_${type}_${doc.id}`, span_id: 'repair' };
      try {
        const computed = await compute_recurring_reconciliation(ctx, { recurring_id: doc.id, recurring_type: type });
        if (!computed) continue;
        const ids = computed.results.map((r) => r.period_id);
        const stored = new Map();
        for (let i = 0; i < ids.length; i += 300) {
          const refs = ids.slice(i, i + 300).map((id) => db.collection(`${type}_periods`).doc(id));
          for (const s of await db.getAll(...refs)) if (s.exists) stored.set(s.id, s.data());
        }
        const repair = [];
        for (const r of computed.results) {
          totals.periods++;
          const s = stored.get(r.period_id);
          if (!s) continue;
          const diff = differences(s, expected_fields(r));
          if (diff.length === 0) continue;
          repair.push(r);
          totals.users.add(s.ownerId || s.userId);
          console.log(`${type} ${r.period_id} (${s.ownerId || s.userId}): ${diff.join('; ')}`);
        }
        totals.repair += repair.length;
        if (COMMIT && repair.length > 0) {
          await (type === 'outflow' ? outflow_period_repo : inflow_period_repo).update_reconciliation(ctx, repair);
        }
      } catch (e) {
        totals.errors++;
        console.error(`⚠️  ${type} ${doc.id}: ${e.message}`);
      }
    }
  }
  console.error(`\nScanned ${totals.recurring} recurring, ${totals.periods} periods. ` +
    `${COMMIT ? '✅ repaired' : 'would repair'} ${totals.repair} periods for ${totals.users.size} users. Errors: ${totals.errors}.`);
  if (!COMMIT) console.error('Re-run with --commit to apply.');
}
main().then(() => process.exit(0)).catch((e) => { console.error('❌', e.message); process.exit(1); });
