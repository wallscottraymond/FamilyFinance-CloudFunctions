#!/usr/bin/env node
/**
 * Backfill `isHidden` from hidden recurring records onto their period docs.
 *
 * The matched-pair classifier (`classify_internal_transfers`) sets `isHidden` on the
 * outflow/inflow RECORD, and period generation copies it — but periods materialized BEFORE
 * a record was hidden stayed `isHidden:false`, so period-doc readers (the assign-to-bill
 * picker) still showed internal transfers. Going forward the orchestrator propagates on
 * classify; this one-off syncs the already-materialized periods.
 *
 * SAFETY: dev == prod. DRY-RUN by default (reads only). Pass --commit to write.
 *   node scripts/backfill-period-hidden.js [--user <uid>]            # dry-run
 *   node scripts/backfill-period-hidden.js [--user <uid>] --commit   # live write
 */
const admin = require("firebase-admin");
const path = require("path");

const COMMIT = process.argv.includes("--commit");
const i = process.argv.indexOf("--user");
const USER = i >= 0 ? process.argv[i + 1] : null;

if (!admin.apps.length) {
  const keyPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    path.join(require("os").homedir(), "google-service-account-key.json");
  admin.initializeApp({ credential: admin.credential.cert(require(keyPath)) });
}
const db = admin.firestore();

async function backfill(recordCol, periodCol, fkField) {
  let q = db.collection(recordCol).where("isHidden", "==", true);
  if (USER) q = q.where("ownerId", "==", USER);
  const records = await q.get();
  const recordIds = records.docs.map((d) => d.id);

  const toUpdate = [];
  for (const rid of recordIds) {
    const periods = await db.collection(periodCol).where(fkField, "==", rid).select("isHidden").get();
    periods.docs.forEach((p) => {
      if (p.get("isHidden") !== true) toUpdate.push(p.ref);
    });
  }
  console.log(
    `${recordCol}: ${recordIds.length} hidden record(s) → ${toUpdate.length} ${periodCol} doc(s) need isHidden=true`
  );

  if (COMMIT && toUpdate.length) {
    const now = admin.firestore.Timestamp.now();
    for (let j = 0; j < toUpdate.length; j += 400) {
      const batch = db.batch();
      toUpdate.slice(j, j + 400).forEach((ref) => batch.update(ref, { isHidden: true, updatedAt: now }));
      await batch.commit();
    }
    console.log(`  ✓ updated ${toUpdate.length} ${periodCol} doc(s)`);
  }
  return toUpdate.length;
}

(async () => {
  console.log(`Scope: ${USER ? "user " + USER : "ALL users"} — ${COMMIT ? "COMMIT" : "DRY-RUN"}\n`);
  const a = await backfill("outflows", "outflow_periods", "outflowId");
  const b = await backfill("inflows", "inflow_periods", "inflowId");
  console.log(`\nTotal period docs ${COMMIT ? "updated" : "to update"}: ${a + b}`);
  if (!COMMIT) console.log("(dry-run — pass --commit to write)");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
