/**
 * Record every existing hand-pinned bill period in `outflow_pinned_periods`
 * (doc `${ownerId}__${outflowId}` → `{ ownerId, outflowId, periodIds[] }`).
 *
 * The period page (derive) loads only the payments dated in the period it shows, so a payment the
 * user pinned to ANOTHER period with the bill picker (a late payment of an overdue month, or one paid
 * ahead) was never counted there — the overdue period stayed Overdue. From this release
 * `pin_split_to_outflow` records the pinned period and derive reads such bills' payments whatever
 * their date; this backfills the pins made before it.
 *
 * Source: every ACTIVE transaction split with a MANUAL `outflowPinnedPeriodId`, on its bill
 * (`outflowId`, or `suspendedOutflowPinId` for a pin parked while its bill is removed / paused —
 * Restore brings it back), only when the transaction's owner owns that bill. Additive only
 * (arrayUnion of missing ids); a missing bill is skipped. The collection has no trigger.
 *
 * Read cost: one paged select() scan of `transactions` + one getAll of the pinned bills and docs.
 *
 *   node scripts/backfill-bill-pinned-periods.js            # DRY RUN (read-only)
 *   node scripts/backfill-bill-pinned-periods.js --commit   # write the missing ids
 */
const admin = require('firebase-admin');
const KEY =
  process.env.GOOGLE_APPLICATION_CREDENTIALS ||
  `${process.env.HOME}/google-service-account-key.json`;
const COMMIT = process.argv[2] === '--commit';
const COLLECTION = 'outflow_pinned_periods';

admin.initializeApp({
  credential: admin.credential.cert(require(KEY)),
  projectId: 'family-budget-app-cb59b',
});
const db = admin.firestore();
const { FieldPath, FieldValue } = admin.firestore;

(async () => {
  console.log(COMMIT ? `COMMIT — writing missing ${COLLECTION} ids` : 'DRY RUN (read-only)');
  const want = new Map(); // bill id → { periods: Map(period id → Set(transaction owners)) }
  let scanned = 0;
  let pinned_splits = 0;
  let last = null;
  for (;;) {
    let q = db.collection('transactions').select('splits', 'isActive', 'ownerId', 'userId')
      .orderBy(FieldPath.documentId()).limit(2000);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    for (const d of snap.docs) {
      scanned++;
      if (d.get('isActive') === false) continue;
      for (const s of d.get('splits') || []) {
        if (!s || !s.outflowPinnedPeriodId) continue;
        // A pin parked while its bill is removed / paused (`suspendedOutflowPinId`) belongs to THAT bill
        // (Restore brings it back as manual), whatever automatic link the split holds meanwhile;
        // otherwise only a MANUAL link is a pin (is_manual_period_pin).
        const bill = s.suspendedOutflowPinId || (s.outflowAssignmentSource === 'manual' ? s.outflowId : null);
        if (!bill) continue;
        pinned_splits++;
        if (!want.has(bill)) want.set(bill, { periods: new Map() });
        const w = want.get(bill);
        // period → owners that pinned it (only the bill owner's pins count)
        if (!w.periods.has(s.outflowPinnedPeriodId)) w.periods.set(s.outflowPinnedPeriodId, new Set());
        w.periods.get(s.outflowPinnedPeriodId).add(d.get('ownerId') || d.get('userId'));
      }
    }
    last = snap.docs[snap.docs.length - 1];
  }
  console.log(`scanned ${scanned} transactions; ${pinned_splits} active pinned splits on ${want.size} bills`);

  const ids = [...want.keys()];
  let to_write = 0;
  for (let i = 0; i < ids.length; i += 300) {
    const chunk = ids.slice(i, i + 300);
    const bills = await db.getAll(...chunk.map((id) => db.collection('outflows').doc(id)),
      { fieldMask: ['ownerId', 'userCustomName', 'description'] });
    for (const bill of bills) {
      if (!bill.exists) {
        console.log(`  ${bill.id}  (bill missing — skipped)`);
        continue;
      }
      const owner = bill.get('ownerId');
      if (!owner) {
        console.log(`  ${bill.id}  (bill has no ownerId — skipped)`);
        continue;
      }
      const periods = [...want.get(bill.id).periods].filter(([, owners]) => owners.has(owner)).map(([p]) => p).sort();
      const foreign = [...want.get(bill.id).periods].filter(([, owners]) => !owners.has(owner)).map(([p]) => p);
      const ref = db.collection(COLLECTION).doc(`${owner}__${bill.id}`);
      const doc = await ref.get();
      const have = new Set(doc.exists ? doc.get('periodIds') || [] : []);
      const missing = periods.filter((p) => !have.has(p));
      const name = bill.get('userCustomName') || bill.get('description') || '';
      console.log(`  ${bill.id}  user ${owner}  "${name}"  pinned ${periods.join(',') || '—'}  missing ${missing.join(',') || '—'}` +
        (foreign.length ? `  (ignored, other owner: ${foreign.join(',')})` : ''));
      if (missing.length === 0) continue;
      to_write++;
      if (COMMIT) {
        /* eslint-disable @typescript-eslint/naming-convention */
        await ref.set({
          ownerId: owner,
          outflowId: bill.id,
          periodIds: FieldValue.arrayUnion(...missing),
          updatedAt: admin.firestore.Timestamp.now(),
        }, { merge: true });
        /* eslint-enable @typescript-eslint/naming-convention */
      }
    }
  }
  console.log(`${to_write} bill(s) ${COMMIT ? 'written' : 'would be written'}`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
