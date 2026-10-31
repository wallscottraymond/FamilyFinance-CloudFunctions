#!/usr/bin/env node
/**
 * repair-duplicate-boundary-weeks.js — remove the duplicate New-Year weeks (Code-Health-Review M1-M2).
 *
 * The weekly source-period generator gave the week spanning New Year to BOTH years ({Y}W53 and
 * {Y+1}W01, same days), and every budget / bill / income then got a period for each, so weekly
 * totals counted that week twice. The generator now gives the week to the year it ends in
 * ({Y+1}W01). This keeps {Y+1}W01 and removes the other copy plus the budget_periods,
 * outflow_periods and inflow_periods generated for it (they duplicate the kept week's docs).
 *
 * Before deleting anything it reports, per removed doc, whether it holds something a user set
 * that its kept twin lacks (notes, checklist, amount edits, manual paid marks, pins). A week with
 * any such doc is SKIPPED WHOLE (nothing of it deleted, so it's never half-removed) unless
 * --force-user-data is passed. After deleting, it bumps each affected owner's derive version
 * (derive caches live 24h). Run `npm run build` first (the bump comes from lib/).
 *
 * DRY-RUN by default (reads only); pass --commit to delete.
 *   node scripts/repair-duplicate-boundary-weeks.js [--commit] [--force-user-data]
 */
'use strict';
const path = require('path'), fs = require('fs'), os = require('os');
const admin = require('firebase-admin');
const PROJECT_ID = 'family-budget-app-cb59b';
const COMMIT = process.argv.includes('--commit');
const FORCE_USER_DATA = process.argv.includes('--force-user-data');

function cred() {
  const c = [process.env.GOOGLE_APPLICATION_CREDENTIALS, path.join(os.homedir(), 'google-service-account-key.json')].filter(Boolean);
  for (const p of c) { try { if (fs.existsSync(p)) { console.error(`🔑 ${p}`); return admin.credential.cert(require(p)); } } catch (_e) {} }
  return admin.credential.applicationDefault();
}

const ms = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : new Date(t).getTime());
const DEPENDENTS = ['budget_periods', 'outflow_periods', 'inflow_periods'];

/** Fields a user sets on a period (vs. machine-computed ones). Non-empty = user data. */
const USER_FIELDS = {
  budget_periods: ['note', 'notes', 'userNotes', 'checklistItems', 'modifiedAmount', 'isModified', 'periodAdjustments', 'hasPeriodAdjustment', 'tags', 'tagIds'],
  outflow_periods: ['note', 'notes', 'userNotes', 'userCustomName', 'manualPayments', 'markedPaidAt', 'markedPaidBy', 'manualSettlement', 'expectedAmountOverride', 'tags', 'tagIds'],
  inflow_periods: ['note', 'notes', 'userNotes', 'userCustomName', 'manualPayments', 'markedReceivedAt', 'markedReceivedBy', 'manualSettlement', 'expectedAmountOverride', 'tags', 'tagIds'],
};
const has_value = (v) => v !== undefined && v !== null && v !== false && !(Array.isArray(v) && v.length === 0) && v !== '';
const user_data = (coll, d) => USER_FIELDS[coll].filter((f) => has_value(d[f]));

/** The kept twin of a dependent doc: same owner doc (budgetId / outflowId / inflowId), kept week. */
const owner_key = (coll, d) =>
  coll === 'budget_periods' ? d.budgetId : coll === 'outflow_periods' ? (d.outflowId ?? d.outflow_id) : (d.inflowId ?? d.inflow_id);

async function main() {
  admin.initializeApp({ credential: cred(), projectId: PROJECT_ID });
  const db = admin.firestore();
  console.error(`${COMMIT ? '✍️  COMMIT' : '📖 DRY RUN'} · duplicate New-Year weeks · ${PROJECT_ID}\n`);

  const weeks = (await db.collection('source_periods').where('type', '==', 'weekly').get()).docs;
  const by_start = new Map();
  for (const d of weeks) {
    const k = ms(d.get('startDate'));
    by_start.set(k, [...(by_start.get(k) ?? []), d]);
  }
  const pairs = [];
  for (const docs of by_start.values()) {
    if (docs.length < 2) continue;
    const end_year = new Date(ms(docs[0].get('endDate'))).getUTCFullYear();
    const keep = docs.find((d) => d.id.startsWith(`${end_year}W`));
    if (!keep) { console.log(`⚠️  no ${end_year}W.. copy among ${docs.map((d) => d.id)} — skipped`); continue; }
    for (const drop of docs.filter((d) => d !== keep)) pairs.push({ keep: keep.id, drop: drop.id, ref: drop.ref });
  }
  console.log(`${weeks.length} weekly source periods · ${pairs.length} duplicates to remove\n`);

  const pinned = (await db.collection('outflow_pinned_periods').select('periodIds').get()).docs;
  const totals = { source: 0, dependents: 0, skipped_user_data: 0, pinned_refs: 0 };
  const deletes = [];
  const owners = new Set();
  for (const { keep, drop, ref } of pairs) {
    const week_deletes = [];
    const week_owners = new Set();
    const line = [`${drop} (keep ${keep}):`];
    const pin_hits = pinned.filter((p) => (p.get('periodIds') ?? []).some((id) => String(id).includes(drop)));
    if (pin_hits.length) { totals.pinned_refs += pin_hits.length; line.push(`⚠️ ${pin_hits.length} pin doc(s) reference it`); }
    let blocked = pin_hits.length > 0 && !FORCE_USER_DATA;
    for (const coll of DEPENDENTS) {
      const [dropped, kept] = await Promise.all([
        db.collection(coll).where('sourcePeriodId', '==', drop).get(),
        db.collection(coll).where('sourcePeriodId', '==', keep).get(),
      ]);
      const kept_by_owner = new Map(kept.docs.map((d) => [owner_key(coll, d.data()), d.data()]));
      let n = 0;
      for (const d of dropped.docs) {
        const data = d.data();
        const twin = kept_by_owner.get(owner_key(coll, data));
        const only_here = user_data(coll, data).filter((f) => !twin || !has_value(twin[f]));
        if ((only_here.length || !twin) && !FORCE_USER_DATA) {
          totals.skipped_user_data++;
          blocked = true;
          console.log(`   ⏸  ${coll}/${d.id}: ${!twin ? 'no kept twin' : `user data only here: ${only_here.join(', ')}`} — left in place`);
          continue;
        }
        week_deletes.push(d.ref);
        const owner = data.userId ?? data.ownerId;
        if (owner) week_owners.add(owner);
        n++;
      }
      totals.dependents += n;
      line.push(`${coll} ${n}/${dropped.size}`);
    }
    if (!blocked) {
      deletes.push(...week_deletes, ref);
      week_owners.forEach((o) => owners.add(o));
      totals.source++;
    } else {
      totals.dependents -= week_deletes.length;
      line.push('⏸  whole week kept (something above was skipped)');
    }
    console.log(line.join(' · '));
  }

  console.log(`\nWould delete: ${totals.source} source periods + ${totals.dependents} period docs` +
    ` · skipped (user data / no twin): ${totals.skipped_user_data} · pin refs: ${totals.pinned_refs}`);
  if (!COMMIT) { console.log('\nDry run only. Re-run with --commit to delete.'); return; }

  const writer = db.bulkWriter();
  for (const r of deletes) writer.delete(r);
  await writer.close();
  console.log(`\n✅ Deleted ${deletes.length} docs.`);
  const { bump_derive_version } = require('../lib/functions/repositories/derive_version.repo');
  for (const o of owners) await bump_derive_version(o);
  console.log(`✅ Bumped the derive version for ${owners.size} owner(s).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
