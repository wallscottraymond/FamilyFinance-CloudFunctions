#!/usr/bin/env node
/**
 * Heal stranded removed-pendings (one-off recovery for the pre-2026-08-22 bug window).
 *
 * BACKGROUND: Before the pending→posted split-inheritance fix (deployed 2026-08-22), a Plaid
 * /transactions/sync that removed a pending (because it cleared) could DROP the posted
 * replacement. Result: a soft-deleted pending (isActive=false, deletionReason "Removed by
 * Plaid sync", isPending=true) with NO active posted txn. The payment really happened, so the
 * recurring bill shows overdue and the txn lingers as a phantom pending.
 *
 * This script finds those stranded pendings for a user and REACTIVATES each as an active,
 * POSTED transaction (preserving its splits + any outflow pin). It only touches docs that are
 * (a) removed-by-Plaid, (b) still isPending, and (c) have NO active posted replacement
 * (checked via pendingTransactionId AND merchant+amount+near-date), so it never creates a dup.
 *
 * SAFETY: dev == prod. Runs DRY-RUN by default (reads only). Pass --commit to write.
 *
 *   node scripts/heal-stranded-pendings.js --user <uid>            # dry-run
 *   node scripts/heal-stranded-pendings.js --user <uid> --commit   # live write
 *   node scripts/heal-stranded-pendings.js --user <uid> --only <plaidTxnId,...> [--commit]
 */
const admin = require("firebase-admin");
const path = require("path");

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}
const COMMIT = process.argv.includes("--commit");
const USER = arg("--user");
const ONLY = (arg("--only", "") || "").split(",").filter(Boolean); // by plaid transactionId
const DOCS = (arg("--doc", "") || "").split(",").filter(Boolean); // by Firestore doc id (precise)
if (!USER) {
  console.error("Missing --user <uid>");
  process.exit(1);
}

if (!admin.apps.length) {
  const keyPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    path.join(require("os").homedir(), "google-service-account-key.json");
  admin.initializeApp({ credential: admin.credential.cert(require(keyPath)) });
}
const db = admin.firestore();

const NEAR_DAYS = 6;
const DAY = 24 * 60 * 60 * 1000;
const toMs = (v) => (v && v.toDate ? v.toDate().getTime() : v ? new Date(v).getTime() : 0);

(async () => {
  const snap = await db.collection("transactions").where("ownerId", "==", USER).get();
  const docs = snap.docs.map((d) => ({ ref: d.ref, id: d.id, ...d.data() }));
  const active = docs.filter((d) => d.isActive !== false);
  const activeByPendingId = new Set(active.map((d) => d.pendingTransactionId).filter(Boolean));

  const stranded = docs.filter(
    (d) =>
      d.isActive === false &&
      d.isPending === true &&
      /removed by plaid/i.test(d.deletionReason || "")
  );

  // When --doc is given, heal EXACTLY those doc ids (precise; safe for sandbox's recycled
  // plaid ids). Skips all the plaid-id/twin heuristics since the caller picked the docs.
  if (DOCS.length) {
    const picked = stranded.filter((d) => DOCS.includes(d.id));
    console.log(`\nUser ${USER} — targeted heal of ${picked.length}/${DOCS.length} doc(s):\n`);
    for (const d of picked) {
      console.log(`[REACTIVATE] $${d.amount} ${(d.name || "").slice(0, 40)} (doc ${d.id})`);
    }
    if (!COMMIT) {
      console.log(`\nDRY-RUN (pass --commit to write).`);
      return;
    }
    const now0 = admin.firestore.Timestamp.now();
    for (const d of picked) {
      const update = {
        isActive: true, isDeleted: false, deletionReason: null,
        isPending: false, transactionStatus: "approved",
        updatedAt: now0, healedBy: "heal-stranded-pendings", healedAt: now0,
      };
      if (d.initialPlaidData) update.initialPlaidData = { ...d.initialPlaidData, plaidPending: false };
      await d.ref.update(update);
      console.log(`  reactivated ${d.id}`);
    }
    console.log(`\nDone. Reactivated ${picked.length}. Reconcile fires via on_transaction_written.`);
    return;
  }

  const seenPlaid = new Set();
  const plan = [];
  for (const d of stranded) {
    if (ONLY.length && !ONLY.includes(d.transactionId)) continue;
    // Dedup docs that share a plaid transaction_id (pre-deterministic-id dup bug):
    // heal the first, leave the rest soft-deleted.
    if (d.transactionId && seenPlaid.has(d.transactionId)) {
      plan.push({ d, action: "skip-dup" });
      continue;
    }
    if (d.transactionId) seenPlaid.add(d.transactionId);

    // Guard: linked posted replacement?
    if (d.transactionId && activeByPendingId.has(d.transactionId)) {
      plan.push({ d, action: "skip-superseded" });
      continue;
    }
    // Guard: unlinked posted twin (same merchant + amount within NEAR_DAYS)?
    const twin = active.find(
      (a) =>
        Math.abs((a.amount || 0) - (d.amount || 0)) < 0.01 &&
        (a.merchantName || a.name) &&
        (d.merchantName || d.name) &&
        (a.merchantName || a.name) === (d.merchantName || d.name) &&
        Math.abs(toMs(a.transactionDate) - toMs(d.transactionDate)) <= NEAR_DAYS * DAY
    );
    if (twin) {
      plan.push({ d, action: "skip-twin", twin: twin.id });
      continue;
    }
    plan.push({ d, action: "reactivate" });
  }

  console.log(`\nUser ${USER} — stranded removed-pendings: ${stranded.length}\n`);
  for (const p of plan) {
    const { d } = p;
    console.log(
      `[${p.action.toUpperCase()}] ${String(d.transactionDate && d.transactionDate.toDate ? d.transactionDate.toDate().toISOString().slice(0, 10) : "")} $${d.amount} ${(d.name || "").slice(0, 40)} (doc ${d.id}, plaid ${String(d.transactionId).slice(0, 12)})${p.twin ? " twin=" + p.twin : ""}`
    );
  }
  const toHeal = plan.filter((p) => p.action === "reactivate");
  console.log(`\n${toHeal.length} to reactivate. ${COMMIT ? "COMMITTING…" : "DRY-RUN (pass --commit to write)."}`);

  if (!COMMIT || toHeal.length === 0) return;

  const now = admin.firestore.Timestamp.now();
  let n = 0;
  for (const { d } of toHeal) {
    const update = {
      isActive: true,
      isDeleted: false,
      deletionReason: null,
      isPending: false,
      transactionStatus: "approved",
      updatedAt: now,
      healedBy: "heal-stranded-pendings",
      healedAt: now,
    };
    if (d.initialPlaidData) {
      update.initialPlaidData = { ...d.initialPlaidData, plaidPending: false };
    }
    await d.ref.update(update);
    n++;
    console.log(`  reactivated ${d.id} (${(d.name || "").slice(0, 30)})`);
  }
  console.log(`\nDone. Reactivated ${n} transaction(s). Recurring reconcile fires via on_transaction_written.`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
