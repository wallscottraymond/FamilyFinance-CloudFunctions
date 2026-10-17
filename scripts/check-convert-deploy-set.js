#!/usr/bin/env node
/**
 * N8 deploy check (Convert-To-Recurring Phase 1, X21). READ-ONLY, no Firebase access.
 *
 * 1. Every function in the Phase 1 DEPLOY SET is reachable from src/index.ts through explicit
 *    exports (a scheduled function re-exported only through a barrel it isn't in silently skips
 *    deploy — see Plaid-Txn-Freeze-And-Deploy-Gotcha).
 * 2. All derive functions + widget_snapshot are in that ONE set (they share the derive cache
 *    shape: deploying some without the others mixes cache versions).
 * 3. Prints the single `firebase deploy --only …` command for the set (indexes + rules go first,
 *    separately). It never deploys anything.
 *
 *   node scripts/check-convert-deploy-set.js          # check + print the command
 * Exit code 1 when something is missing.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

/** X21 — one commit, one deploy. */
const DEPLOY_SET = [
  // derive (one cache shape) + the widget that reads it
  "derive_period", "derive_period_range", "derive_budget_view", "derive_budget_transactions", "derive_recurring_view",
  "widget_snapshot",
  // the capture path
  "sync_transactions", "sync_recurring", "process_job_queue", "on_job_created", "plaid_webhook",
  "sync_all_recurring_scheduled", "sync_all_transactions_scheduled",
  // the new callable + the period extensions changed by this project
  "answer_recurring_review_item", "extendRecurringOutflowPeriods", "extendRecurringInflowPeriods",
  // Phase 2 (convert backend): the callables. The assignment engine is bundled into ~15 functions —
  // an OLD instance would clobber a manual income pin (merge_assignment), so the whole set deploys
  // from one commit.
  "convert_transaction_to_recurring", "preview_convert_transaction", "get_recurring_capabilities",
  "assign_split_to_inflow", "undo_recurring_merge",
];
const DERIVE_FUNCTIONS = DEPLOY_SET.filter((f) => f.startsWith("derive_")).concat("widget_snapshot");

function resolve_module(from_file, spec) {
  const base = path.resolve(path.dirname(from_file), spec);
  for (const c of [`${base}.ts`, path.join(base, "index.ts")]) if (fs.existsSync(c)) return c;
  return null;
}

/** Names exported by `file`, following `export * from` and `export { … } from` chains. */
function collect_exports(file, seen = new Set()) {
  if (seen.has(file)) return new Set();
  seen.add(file);
  const out = new Set();
  const src = fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const m of src.matchAll(/export\s+\*\s+from\s+["']([^"']+)["']/g)) {
    const target = resolve_module(file, m[1]);
    if (target) for (const n of collect_exports(target, seen)) out.add(n);
  }
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) out.add(name);
    }
  }
  for (const m of src.matchAll(/export\s+(?:const|let|async\s+function|function|class)\s+([A-Za-z0-9_]+)/g)) out.add(m[1]);
  return out;
}

function check_deploy_set(root = ROOT) {
  const exported = collect_exports(path.join(root, "src", "index.ts"));
  const missing = DEPLOY_SET.filter((f) => !exported.has(f));
  const derive_not_in_set = DERIVE_FUNCTIONS.filter((f) => !DEPLOY_SET.includes(f));
  // The assignment engine, the derive, the recurring planner and the repos are bundled into most
  // functions: a partial deploy leaves old instances that overwrite new fields (e.g. a manual income
  // pin) or mis-read them. DEPLOY ALL FUNCTIONS from one commit; DEPLOY_SET is only the
  // "is it exported" check.
  const command = "firebase deploy --only functions   # deploy ALL functions (one commit); then: firebase functions:delete createManualOutflow";
  return { ok: missing.length === 0 && derive_not_in_set.length === 0, missing, derive_not_in_set, command, exported_count: exported.size };
}

module.exports = { DEPLOY_SET, DERIVE_FUNCTIONS, collect_exports, check_deploy_set };

if (require.main === module) {
  const r = check_deploy_set();
  console.log(`exports reachable from src/index.ts: ${r.exported_count}`);
  if (r.missing.length) console.log(`MISSING from the exports: ${r.missing.join(", ")}`);
  if (r.derive_not_in_set.length) console.log(`derive functions outside the deploy set: ${r.derive_not_in_set.join(", ")}`);
  console.log(r.ok ? "OK — deploy set complete (indexes + rules first, then):" : "NOT OK");
  console.log(r.command);
  process.exit(r.ok ? 0 : 1);
}
