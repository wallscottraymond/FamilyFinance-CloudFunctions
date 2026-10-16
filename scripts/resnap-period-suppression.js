#!/usr/bin/env node
/**
 * One-off (Convert-To-Recurring D27): re-snap stored outflow / inflow periods of removed, paused or
 * ended bills and income to the month rule the period page uses — a weekly / twice-a-month period
 * is active when any of its occurrences is in a month that isn't suppressed. Fixes the
 * assign-to-bill picker (it reads `isActive == true`) for periods written under the old
 * whole-period rule. Writes ONLY `isActive`, only where it differs. Idempotent.
 *
 * SAFETY: dev == prod. DRY RUN by default (reads only) and prints per-user counts. Run it against
 * production ONLY after the user approves the dry-run numbers.
 *   npm run build
 *   node scripts/resnap-period-suppression.js [--user <uid>]           # dry run
 *   node scripts/resnap-period-suppression.js [--user <uid>] --write   # write
 * With FIRESTORE_EMULATOR_HOST set it talks to the emulator (no credentials needed).
 */
const path = require("path");
const admin = require("firebase-admin");

const WRITE = process.argv.includes("--write");
const i = process.argv.indexOf("--user");
const USER = i >= 0 ? process.argv[i + 1] : undefined;

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

const { resnap_period_suppression_orchestrator } = require(
  path.join(__dirname, "..", "lib", "functions", "orchestrators", "recurring", "resnap_period_suppression.orchestrator.js")
);

(async () => {
  console.log(`Scope: ${USER ? "user " + USER : "ALL users"} — ${WRITE ? "WRITE" : "DRY RUN"}\n`);
  const r = await resnap_period_suppression_orchestrator({ trace_id: "resnap_cli", span_id: "cli" }, { write: WRITE, user_id: USER });
  for (const [uid, c] of Object.entries(r.by_user).sort()) {
    console.log(
      `${uid}: bills ${c.outflows} → ${c.outflow_periods_to_flip} period(s); income ${c.inflows} → ${c.inflow_periods_to_flip} period(s)`
    );
  }
  console.log(`\nRecords checked: ${r.records_checked}; periods ${WRITE ? "flipped" : "to flip"}: ${r.periods_flipped}`);
  if (!WRITE) console.log("(dry run — pass --write to apply)");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
