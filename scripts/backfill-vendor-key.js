#!/usr/bin/env node
/**
 * Backfill `vendorKey` onto existing transactions (Transaction-Detail-Redesign, Phase 0).
 *
 * New/updated transactions get `vendorKey` from the Plaid transformer + createTransaction.
 * This one-off fills in everything written before that. Uses the COMPILED backend
 * `vendor_key` (lib/), so there's exactly one definition of the cleaning — run
 * `npm run build` first.
 *
 * SAFETY:
 * - dev == prod. DRY-RUN by default (reads only). Pass --commit to write.
 * - Writes ONLY `vendorKey`. Never `updatedAt`: the assignment batch re-assigns every txn whose
 *   updatedAt moved past the user's watermark, so bumping it would re-assign every transaction.
 * - `vendorKey` is in neither the assignment nor the spend field guard, so each write's
 *   `on_transaction_written` exits early (no recompute / reconcile jobs).
 * - Throttled: 400 writes per batch, then a pause.
 * - Emulator: set FIRESTORE_EMULATOR_HOST (and GCLOUD_PROJECT) to run against it.
 *
 *   node scripts/backfill-vendor-key.js [--user <uid>]            # dry-run
 *   node scripts/backfill-vendor-key.js [--user <uid>] --commit   # live write
 */
const admin = require("firebase-admin");
const path = require("path");
const { vendor_key } = require("../lib/functions/domain/transactions/vendor_key.service");

const COMMIT = process.argv.includes("--commit");
const i = process.argv.indexOf("--user");
const USER = i >= 0 ? process.argv[i + 1] : null;
const PAGE = 500;
const BATCH = 400;
const PAUSE_MS = 1500;

if (!admin.apps.length) {
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || "family-budget-app-cb59b" });
  } else {
    const keyPath =
      process.env.GOOGLE_APPLICATION_CREDENTIALS ||
      path.join(require("os").homedir(), "google-service-account-key.json");
    admin.initializeApp({ credential: admin.credential.cert(require(keyPath)) });
  }
}
const db = admin.firestore();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The key a doc should have (same inputs as the transformer). */
function expectedKey(d) {
  return vendor_key({ merchant_name: d.merchantName, name: d.name, description: d.description });
}

async function run() {
  console.log(
    `Scope: ${USER ? "user " + USER : "ALL users"} — ${COMMIT ? "COMMIT" : "DRY-RUN"}` +
      (process.env.FIRESTORE_EMULATOR_HOST ? " (EMULATOR)" : "") +
      "\n"
  );
  let scanned = 0;
  let toWrite = 0;
  let written = 0;
  let noName = 0;
  let pendingWrites = [];
  let last = null;

  const flush = async () => {
    if (!COMMIT || pendingWrites.length === 0) {
      pendingWrites = [];
      return;
    }
    const batch = db.batch();
    pendingWrites.forEach(({ ref, key }) => batch.update(ref, { vendorKey: key }));
    await batch.commit();
    written += pendingWrites.length;
    pendingWrites = [];
    process.stdout.write(`  ✓ ${written} written\r`);
    await sleep(PAUSE_MS);
  };

  for (;;) {
    let q = db.collection("transactions");
    if (USER) q = q.where("ownerId", "==", USER);
    q = q.orderBy(admin.firestore.FieldPath.documentId()).select("merchantName", "name", "description", "vendorKey").limit(PAGE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      scanned++;
      const d = doc.data();
      const key = expectedKey(d);
      if (key === null) noName++;
      if ((d.vendorKey ?? null) === key) continue; // already right (idempotent re-runs)
      toWrite++;
      pendingWrites.push({ ref: doc.ref, key });
      if (pendingWrites.length >= BATCH) await flush();
    }
    last = snap.docs[snap.docs.length - 1];
  }
  await flush();

  console.log(`\nScanned ${scanned} transaction(s); ${toWrite} need vendorKey; ${noName} have no usable name (key = null).`);
  if (COMMIT) console.log(`Wrote ${written}.`);
  else console.log("(dry-run — pass --commit to write)");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
