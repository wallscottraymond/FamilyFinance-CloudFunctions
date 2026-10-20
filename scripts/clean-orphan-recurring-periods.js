/**
 * Delete outflow_periods / inflow_periods whose bill / income no longer exists.
 *
 * Before Convert-To-Recurring round 9, "Delete permanently" removed only the bill doc and left its
 * periods. A left-behind period is still a fuzzy-match candidate (it has no isActive / parent check),
 * so payments near its due dates stay linked to the deleted id and count in no budget.
 *
 * Read cost: one select() scan of each period collection + one batched getAll of the distinct
 * parent ids + one count() per orphan id. After --commit, run a re-assign for each listed user so
 * the payments re-link (or fall back to budgets).
 *
 *   node scripts/clean-orphan-recurring-periods.js            # DRY RUN (read-only)
 *   node scripts/clean-orphan-recurring-periods.js --commit   # delete the orphan periods
 */
const admin = require('firebase-admin');
const KEY =
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  `${process.env.HOME}/google-service-account-key.json`;
const COMMIT = process.argv[2] === '--commit';

admin.initializeApp({
  credential: admin.credential.cert(require(KEY)),
  projectId: 'family-budget-app-cb59b',
});
const db = admin.firestore();

const KINDS = [
  { periods: 'outflow_periods', parent: 'outflows', field: 'outflowId', link: 'splitOutflowIds' },
  { periods: 'inflow_periods', parent: 'inflows', field: 'inflowId', link: 'splitInflowIds' },
];

(async () => {
  const users = new Set();
  for (const k of KINDS) {
    const snap = await db.collection(k.periods).select(k.field, 'userId').get();
    const by_parent = new Map();
    for (const d of snap.docs) {
      const id = d.get(k.field);
      if (!id) continue;
      if (!by_parent.has(id)) by_parent.set(id, []);
      by_parent.get(id).push(d);
    }
    const ids = [...by_parent.keys()];
    const missing = [];
    for (let i = 0; i < ids.length; i += 300) {
      const chunk = ids.slice(i, i + 300);
      const docs = await db.getAll(...chunk.map((id) => db.collection(k.parent).doc(id)), { fieldMask: ['ownerId'] });
      docs.forEach((doc, j) => { if (!doc.exists) missing.push(chunk[j]); });
    }
    let orphan_periods = 0;
    console.log(`\n${k.periods}: ${snap.size} periods, ${ids.length} parents, ${missing.length} missing`);
    for (const id of missing) {
      const periods = by_parent.get(id);
      const uid = periods[0].get('userId');
      users.add(uid);
      orphan_periods += periods.length;
      const linked = (await db.collection('transactions').where('userId', '==', uid)
        .where(k.link, 'array-contains', id).count().get()).data().count;
      console.log(`  ${id}  user ${uid}  ${periods.length} periods  ${linked} txns still linked`);
      if (COMMIT) {
        for (let i = 0; i < periods.length; i += 450) {
          const batch = db.batch();
          for (const p of periods.slice(i, i + 450)) batch.delete(p.ref);
          await batch.commit();
        }
      }
    }
    console.log(`  ${COMMIT ? 'deleted' : 'would delete'} ${orphan_periods} orphan periods`);
  }
  console.log(`\nUsers to re-assign after --commit: ${[...users].join(', ') || '(none)'}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
