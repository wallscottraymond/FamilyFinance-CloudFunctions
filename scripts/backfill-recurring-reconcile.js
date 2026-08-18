/**
 * One-off backfill for Recurring-Pending-Posted-Reconciliation.
 *
 * (1) Stamp the denormalized queryable link `splitOutflowIds`/`splitInflowIds` onto
 *     the user's transactions (derived from their splits' outflowId/inflowId), so
 *     the durable-link reconcile query (`array-contains`) finds existing payments.
 * (2) Re-run recurring reconciliation for every active outflow/inflow via the
 *     compiled orchestrator (uses the NEW durable-link resolver + count-pending +
 *     hasPending). That writes *_period reconciliation, which cascades to summaries
 *     through the (guarded) summary triggers.
 *
 * Writes only transactions (denorm add) + *_period reconciliation. Run AFTER
 * deploying so the triggered summary refresh uses the new code.
 *
 * Usage: node scripts/backfill-recurring-reconcile.js <uid> [--stamp-only] [--dry]
 */
const path = require('path');
const os = require('os');
const admin = require('firebase-admin');

const PROJECT = 'family-budget-app-cb59b';
const OWNER = process.argv[2];
const DRY = process.argv.includes('--dry');
const STAMP_ONLY = process.argv.includes('--stamp-only');
if (!OWNER) {
  console.error('Usage: node scripts/backfill-recurring-reconcile.js <uid> [--stamp-only] [--dry]');
  process.exit(1);
}

let seq = 0;
const ctx = () => ({ trace_id: `backfill-${Date.now()}-${seq++}`, span_id: `s${seq}` });

async function main() {
  admin.initializeApp({
    credential: admin.credential.cert(require(path.join(os.homedir(), 'google-service-account-key.json'))),
    projectId: PROJECT,
  });
  const db = admin.firestore();
  db.settings({ ignoreUndefinedProperties: true });

  const { reconcile_recurring_periods_orchestrator } = require(
    path.resolve(__dirname, '../lib/functions/orchestrators/recurring/reconcile_recurring_periods.orchestrator.js')
  );

  // ---- (1) Stamp splitOutflowIds / splitInflowIds ----
  const txnSnap = await db.collection('transactions').where('ownerId', '==', OWNER).get();
  let stamped = 0, examined = 0;
  let batch = db.batch(), inBatch = 0;
  for (const d of txnSnap.docs) {
    examined++;
    const t = d.data();
    const splits = t.splits || [];
    const outIds = [...new Set(splits.map((s) => s.outflowId).filter(Boolean))];
    const inIds = [...new Set(splits.map((s) => s.inflowId).filter(Boolean))];
    const curOut = t.splitOutflowIds || [];
    const curIn = t.splitInflowIds || [];
    const same = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
    if (same(outIds, curOut) && same(inIds, curIn)) continue; // already correct
    if (!DRY) {
      batch.update(d.ref, { splitOutflowIds: outIds, splitInflowIds: inIds });
      inBatch++;
      if (inBatch >= 400) { await batch.commit(); batch = db.batch(); inBatch = 0; }
    }
    stamped++;
  }
  if (!DRY && inBatch > 0) await batch.commit();
  console.log(`[backfill] transactions: examined=${examined}, stamped splitOutflow/InflowIds=${stamped}${DRY ? ' (dry)' : ''}`);

  if (STAMP_ONLY) { console.log('[backfill] --stamp-only: skipping reconcile.'); return; }

  // ---- (2) Reconcile every active recurring outflow + inflow ----
  const [outSnap, inSnap] = await Promise.all([
    db.collection('outflows').where('ownerId', '==', OWNER).where('isActive', '==', true).get(),
    db.collection('inflows').where('ownerId', '==', OWNER).where('isActive', '==', true).get(),
  ]);
  const items = [
    ...outSnap.docs.map((d) => ({ id: d.id, type: 'outflow' })),
    ...inSnap.docs.map((d) => ({ id: d.id, type: 'inflow' })),
  ];
  console.log(`[backfill] reconciling ${items.length} recurring items (${outSnap.size} outflows, ${inSnap.size} inflows)...`);
  let ok = 0, err = 0;
  for (const it of items) {
    if (DRY) { ok++; continue; }
    try {
      await reconcile_recurring_periods_orchestrator(ctx(), {
        recurring_id: it.id,
        recurring_type: it.type,
        user_id: OWNER,
      });
      ok++;
      if (ok % 25 === 0) console.log(`[backfill]   reconciled ${ok}/${items.length}`);
    } catch (e) {
      err++;
      console.error(`[backfill]   FAIL ${it.type} ${it.id}: ${e.message}`);
    }
  }
  console.log(`[backfill] DONE. reconciled=${ok} errors=${err}. Summaries refresh via the (deployed) summary triggers.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
