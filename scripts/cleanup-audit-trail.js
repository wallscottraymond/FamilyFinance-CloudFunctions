#!/usr/bin/env node
/**
 * One-off cleanup of the `_audit` trail (Storage-Cost-Audit, 2026-10-05).
 *
 * The audit trail was ~94% of all stored documents: entries since 2026-05 never expired (only
 * ~5K carried the `expire_at` TTL field) and each stored whole before/after documents. Retention
 * is now 30 days and new entries are slim. This brings existing entries in line:
 *   - older than 30 days            → deleted
 *   - within 30 days, missing expiry → `expire_at` = timestamp + 30 days, and the bulky
 *                                     `before` / `after` fields removed
 *
 * SAFETY:
 * - dev == prod. DRY-RUN by default (reads only). Pass --commit to write.
 * - Touches ONLY the `_audit` collection. No triggers listen to it.
 * - Small batches (25 writes): old entries hold big nested before/after maps, and deleting 400
 *   per batch exceeded Firestore's per-transaction size limit ("Transaction too big").
 *   (BulkWriter was tried and let the process exit silently mid-flush.) Resumable: re-running
 *   skips finished work.
 * - Emulator: set FIRESTORE_EMULATOR_HOST (and GCLOUD_PROJECT).
 *
 *   node scripts/cleanup-audit-trail.js            # dry-run
 *   node scripts/cleanup-audit-trail.js --commit   # live
 */
const admin = require("firebase-admin");
const path = require("path");

const COMMIT = process.argv.includes("--commit");
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // keep in step with AUDIT_RETENTION_MS
const PAGE = 500;
const CHUNK = 25; // writes per batch commit

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
const { Timestamp, FieldValue } = admin.firestore;

async function countWhere(q) {
  return (await q.count().get()).data().count;
}

async function run() {
  const cutoff = Timestamp.fromMillis(Date.now() - RETENTION_MS);
  const col = db.collection("_audit");
  console.log(
    `${COMMIT ? "COMMIT" : "DRY-RUN"}${process.env.FIRESTORE_EMULATOR_HOST ? " (EMULATOR)" : ""} — cutoff ${cutoff
      .toDate()
      .toISOString()}\n`
  );

  const total = await countWhere(col);
  const old = await countWhere(col.where("timestamp", "<", cutoff));
  const recent = total - old;
  console.log(`_audit total: ${total}`);
  console.log(`  older than 30 days (delete): ${old}`);
  console.log(`  last 30 days (keep):         ${recent}`);

  // 1. Delete entries older than the window (oldest first; resumable).
  let deleted = 0;
  if (COMMIT) {
    for (;;) {
      const snap = await col.where("timestamp", "<", cutoff).orderBy("timestamp").limit(PAGE).select().get();
      if (snap.empty) break;
      for (let i = 0; i < snap.docs.length; i += CHUNK) {
        const batch = db.batch();
        snap.docs.slice(i, i + CHUNK).forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
      deleted += snap.size;
      if (deleted % 20000 < PAGE) process.stdout.write(`  ✓ deleted ${deleted}\r`);
    }
    console.log(`\n  deleted ${deleted}`);
  }

  // 2. Recent entries: add expire_at where missing + strip before/after (they're never read).
  let scanned = 0;
  let fixed = 0;
  let last = null;
  for (;;) {
    let q = col.where("timestamp", ">=", cutoff).orderBy("timestamp").limit(PAGE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    const updates = [];
    snap.docs.forEach((d) => {
      scanned++;
      const data = d.data();
      const needsExpiry = !data.expire_at;
      const hasSnapshots = "before" in data || "after" in data;
      if (!needsExpiry && !hasSnapshots) return;
      const ts = data.timestamp;
      const update = { before: FieldValue.delete(), after: FieldValue.delete() };
      if (needsExpiry) update.expire_at = Timestamp.fromMillis(ts.toMillis() + RETENTION_MS);
      updates.push([d.ref, update]);
    });
    fixed += updates.length;
    if (COMMIT) {
      for (let i = 0; i < updates.length; i += CHUNK) {
        const batch = db.batch();
        updates.slice(i, i + CHUNK).forEach(([ref, u]) => batch.update(ref, u));
        await batch.commit();
      }
    }
    last = snap.docs[snap.docs.length - 1];
  }
  console.log(`  recent entries scanned: ${scanned}; ${COMMIT ? "slimmed/expiry set" : "to slim/set expiry"}: ${fixed}`);

  if (COMMIT) {
    console.log(`\nAfter: _audit total ${await countWhere(col)}`);
  } else {
    console.log("\n(dry-run — pass --commit to write)");
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
