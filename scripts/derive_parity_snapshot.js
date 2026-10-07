#!/usr/bin/env node
/**
 * Derive parity snapshot — READ-ONLY, against the LIVE project.
 *
 * Runs the period-derive math (the same load → shape → compute the app's
 * derive_period / derive_period_range use), goals, and per-budget transaction
 * lists for one user, with the clock FROZEN, and writes everything to a JSON
 * file. Run it once against a baseline build and once against a new build, then
 * diff the two files: any difference is a behavior change.
 *
 *   node scripts/derive_parity_snapshot.js --lib <path/to/lib> --user <uid> \
 *     --now <epoch-ms> --out <file.json> [--scope me|group:<id>] [--simulate-shared <accountDocId>]
 *
 * Safety: every Firestore write path (set / update / delete / create / batch
 * commit / transactions / BulkWriter) is replaced with a function that THROWS,
 * and the derive caches are stubbed, so this script cannot modify data even if
 * a code path tries. The output contains personal financial data: write it
 * OUTSIDE the repo (e.g. the session scratchpad), never commit it.
 */

const path = require("path");
const fs = require("fs");
const os = require("os");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const LIB = path.resolve(arg("lib", path.join(__dirname, "..", "lib")));
const USER = arg("user");
const NOW = Number(arg("now"));
const OUT = arg("out");
const SCOPE = arg("scope", "me");
if (!USER || !NOW || !OUT) {
  console.error("usage: --lib <lib> --user <uid> --now <ms> --out <file> [--scope me|group:<id>]");
  process.exit(2);
}

// ---- Freeze the clock (Date.now, new Date(), Timestamp.now) -----------------
const RealDate = Date;
class FrozenDate extends RealDate {
  constructor(...a) {
    if (a.length === 0) super(NOW);
    else super(...a);
  }
  static now() {
    return NOW;
  }
}
global.Date = FrozenDate;

// ---- Firebase (same module instance the lib uses) ---------------------------
const admin = require(require.resolve("firebase-admin", { paths: [LIB] }));
const fsMod = require(require.resolve("@google-cloud/firestore", { paths: [LIB] }));
const PROJECT_ID = "family-budget-app-cb59b";
const key = [
  process.env.GOOGLE_APPLICATION_CREDENTIALS,
  path.join(os.homedir(), "google-service-account-key.json"),
].filter(Boolean).find((p) => fs.existsSync(p));
admin.initializeApp({
  projectId: PROJECT_ID,
  credential: key ? admin.credential.cert(require(key)) : admin.credential.applicationDefault(),
});

// ---- Make writes impossible --------------------------------------------------
const blocked = (what) => function () {
  throw new Error(`derive_parity_snapshot: BLOCKED write (${what}) — this script is read-only`);
};
for (const m of ["set", "update", "delete", "create"]) {
  fsMod.DocumentReference.prototype[m] = blocked(`DocumentReference.${m}`);
  fsMod.WriteBatch.prototype[m] = blocked(`WriteBatch.${m}`);
}
fsMod.WriteBatch.prototype.commit = blocked("WriteBatch.commit");
fsMod.CollectionReference.prototype.add = blocked("CollectionReference.add");
fsMod.Firestore.prototype.runTransaction = blocked("runTransaction");
fsMod.Firestore.prototype.bulkWriter = blocked("bulkWriter");

// ---- Stub derive caches (read → miss, write → no-op) ------------------------
const L = (p) => require(path.join(LIB, "functions", p));
const periodCache = L("repositories/derive_period_cache.repo");
periodCache.get_cached_derived_period = async () => null;
periodCache.put_cached_derived_period = async () => undefined;
const resultCache = L("repositories/derived_result_cache.repo");
resultCache.get_cached_result = async () => null;
resultCache.put_cached_result = async () => undefined;

// --simulate-shared <accountDocId>: IN MEMORY ONLY, pretend that account is shared with a
// group (control test: Me must then change by exactly that account's money).
const SIM_SHARED = arg("simulate-shared");
if (SIM_SHARED) {
  const accountRepo = L("repositories/account.repo").account_repo;
  const orig = accountRepo.get_by_user_id.bind(accountRepo);
  accountRepo.get_by_user_id = async (...a) =>
    (await orig(...a)).map((acc) =>
      acc.id === SIM_SHARED
        ? { ...acc, placement: { group_id: "sim", shared_from_ms: null, shared_by: USER, shared_at_ms: NOW } }
        : acc
    );
}

const resolver = L("resolvers/periods/period_derivation.resolver");
const { compute_period_view } = L("domain/periods/period_view.service");
const { resolve_goal_measurements_for_periods } = L("resolvers/goals/goal_measurement.resolver");
const { build_goals_view } = L("domain/goals/goals_view.service");
const { source_period_repo } = L("repositories");
const { budget_repo } = L("repositories/budget.repo");
const { derive_budget_transactions_orchestrator } = L(
  "orchestrators/budgets/derive_budget_transactions.orchestrator"
);
const { Timestamp } = require(require.resolve("firebase-admin/firestore", { paths: [LIB] }));

/** Deterministic JSON: object keys sorted. */
function stable(v) {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === "object") {
    if (typeof v.toMillis === "function") return { __ts: v.toMillis() };
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = stable(v[k]);
    return o;
  }
  return v;
}

(async () => {
  const ctx = { trace_id: "parity", span_id: "parity" };
  const DAY = 86400000;
  const from = NOW - 400 * DAY;
  const to = NOW + 62 * DAY;
  // New code may take a scope; the baseline ignores the extra argument.
  const scope = SCOPE === "me" ? undefined : { kind: "group", group_id: SCOPE.slice(6) };

  const periods = await source_period_repo.get_overlapping(
    ctx, Timestamp.fromMillis(from), Timestamp.fromMillis(to)
  );
  const out = { user: USER, now: NOW, scope: SCOPE, cadences: {}, budget_txns: {} };

  for (const cadence of ["monthly", "weekly", "bi_monthly"]) {
    const windows = periods
      .filter((p) => p.period_type === cadence)
      .filter((p) => p.end_date.toMillis() >= from && p.start_date.toMillis() <= to)
      .map((p) => ({
        period_id: p.period_id,
        start_ms: p.start_date.toMillis(),
        end_ms: p.end_date.toMillis(),
        start: p.start_date,
        end: p.end_date,
      }));
    const raw = await resolver.load_period_derivation_raw(
      ctx, USER, cadence, windows.map((w) => ({ start_ms: w.start_ms, end_ms: w.end_ms })), scope
    );
    const goal_views = await resolve_goal_measurements_for_periods(
      ctx, USER, windows.map((w) => ({ period_id: w.period_id, start: w.start, end: w.end })), scope
    );
    out.cadences[cadence] = windows.map((w) => {
      const deps = resolver.shape_period_derivation_deps(raw, cadence, w.start_ms, w.end_ms);
      const v = goal_views.get(w.period_id);
      return {
        period_id: w.period_id,
        derive: compute_period_view(deps, cadence),
        goals: v ? build_goals_view(w.period_id, v) : null,
      };
    });
    console.error(`${cadence}: ${windows.length} windows, ${raw.txns.length} txns`);
  }

  // Budget detail transaction lists: every budget × the last 6 monthly windows.
  const budgets = await budget_repo.get_by_user_id(ctx, USER);
  const monthly = periods
    .filter((p) => p.period_type === "monthly" && p.start_date.toMillis() <= NOW)
    .sort((a, b) => a.start_date.toMillis() - b.start_date.toMillis())
    .slice(-6);
  for (const b of budgets) {
    out.budget_txns[b.id] = {};
    for (const p of monthly) {
      out.budget_txns[b.id][p.period_id] = await derive_budget_transactions_orchestrator(
        ctx, USER, b.id, p.start_date.toMillis(), p.end_date.toMillis(), true
      );
    }
  }
  console.error(`budgets: ${budgets.length} × ${monthly.length} months`);

  fs.writeFileSync(OUT, JSON.stringify(stable(out), null, 1));
  console.error(`wrote ${OUT}`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
