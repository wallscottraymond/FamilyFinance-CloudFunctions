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
const SIM_GROUP_ARG = arg("simulate-group");
if (SIM_SHARED || SIM_GROUP_ARG) {
  // The simulated user is in the simulated group (Me scope reads users/{uid}.groupIds).
  const userRepo = L("repositories/user.repo").user_repo;
  const origUser = userRepo.get_by_id.bind(userRepo);
  userRepo.get_by_id = async (ctx, uid) => {
    const u = await origUser(ctx, uid);
    if (uid !== USER || !u) return u;
    return { ...u, data: { ...u.data, groupIds: [SIM_SHARED ? "sim" : "simg"] } };
  };
}
if (SIM_SHARED) {
  const simGroupRepo = L("repositories/sharing").group_repo;
  const simGroup = {
    id: "sim", name: "Sim", owner_id: USER, members: { [USER]: { role: "owner", joined_at_ms: 0 } },
    member_ids: [USER], created_at_ms: 0, deleted_at_ms: null,
  };
  simGroupRepo.get = async (_ctx, gid) => (gid === "sim" ? simGroup : null);
  simGroupRepo.get_many = async (_ctx, ids) => (ids.includes("sim") ? [simGroup] : []);
  const accountRepo = L("repositories/account.repo").account_repo;
  const orig = accountRepo.get_by_user_id.bind(accountRepo);
  accountRepo.get_by_user_id = async (...a) =>
    (await orig(...a)).map((acc) =>
      acc.id === SIM_SHARED
        ? { ...acc, placement: { group_id: "sim", shared_from_ms: null, shared_by: USER, shared_at_ms: NOW } }
        : acc
    );
}

// --simulate-group <docId[,docId]>: IN MEMORY ONLY, pretend those accounts are shared with a
// one-person group "simg" whose budgets are the user's own definitions (same ids), so every
// transaction matches the same budget in whichever view it lands in. Use with --scope me (the
// accounts leave Me) or --scope group:simg (only those accounts count). Conservation test:
// Me + group must equal today's totals, plus the transfers that now cross the boundary.
const SIM_GROUP = arg("simulate-group");
if (SIM_GROUP) {
  const ids = new Set(SIM_GROUP.split(","));
  const placement = { group_id: "simg", shared_from_ms: null, shared_by: USER, shared_at_ms: NOW };
  const accountRepo = L("repositories/account.repo").account_repo;
  const origByUser = accountRepo.get_by_user_id.bind(accountRepo);
  accountRepo.get_by_user_id = async (...a) =>
    (await origByUser(...a)).map((acc) => (ids.has(acc.id) ? { ...acc, placement } : acc));
  accountRepo.get_shared_with_group = async (ctx, gid) =>
    gid !== "simg" ? [] : (await origByUser(ctx, USER)).filter((acc) => ids.has(acc.id))
      .map((acc) => ({ ...acc, placement }));
  const groupRepo = L("repositories/sharing").group_repo;
  groupRepo.get = async (_ctx, gid) => gid !== "simg" ? null : {
    id: "simg", name: "Sim", owner_id: USER, members: { [USER]: { role: "owner", joined_at_ms: 0 } },
    member_ids: [USER], created_at_ms: 0, deleted_at_ms: null,
  };
  groupRepo.get_many = async (ctx, ids) =>
    (await Promise.all(ids.map((id) => groupRepo.get(ctx, id)))).filter(Boolean);
  const budgetRepo = L("repositories/budget.repo").budget_repo;
  const origBudgets = budgetRepo.get_by_user_id.bind(budgetRepo);
  budgetRepo.get_by_user_id = async (ctx, key) => origBudgets(ctx, key === "group:simg" ? USER : key);
  const periodRepo = L("repositories/budget_period.repo").budget_period_repo;
  const origPeriods = periodRepo.get_by_user_and_type_starting_between.bind(periodRepo);
  periodRepo.get_by_user_and_type_starting_between = async (ctx, key, ...rest) =>
    origPeriods(ctx, key === "group:simg" ? USER : key, ...rest);
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

// --edge: also report each window's crossing transfers (Account-Rooted-Sharing D12) so the
// conservation check can account for every dollar. Only present when the lib has the edge rule.
const EDGE = process.argv.includes("--edge");
function crossing_amounts(raw, span_start_ms, span_end_ms) {
  const { detect_internal_transfers_from_txns } = L("resolvers/shared/on_read_matching");
  const { find_crossing_transfers } = L("domain/periods/edge_transfers.service");
  const inSpan = (t) => {
    const ms = t.data.transactionDate.toMillis();
    return ms >= span_start_ms && ms <= span_end_ms;
  };
  const view = raw.txns.filter(inSpan);
  const all = raw.all_member_txns.filter(inSpan);
  const view_internal = detect_internal_transfers_from_txns(view).internal_ids;
  const c = find_crossing_transfers(
    detect_internal_transfers_from_txns(all.filter((t) => !view_internal.has(t.id))),
    view_internal,
    view
  );
  const amt = (id) => {
    const t = view.find((x) => x.id === id);
    return (t.data.splits || []).reduce((s, sp) => s + Math.abs(sp.amount || 0), 0);
  };
  const sum = (set) => Math.round([...set].reduce((s, id) => s + amt(id), 0) * 100) / 100;
  // Payments whose bill / income link was released because that item lives in another view.
  const oov = raw.out_of_view_recurring.ids;
  let released = 0;
  const released_ids = [];
  for (const t of view) {
    if (c.ids.has(t.id)) continue;
    for (const sp of t.data.splits || []) {
      const cat = sp.internalDetailedCategory || sp.plaidDetailedCategory || "";
      const countable = !cat.startsWith("TRANSFER") && !cat.startsWith("INCOME") &&
        sp.spendStatus !== "ignored" && sp.isIgnored !== true && t.data.type !== "income";
      if (countable &&
        ((sp.outflowId && oov.has(sp.outflowId)) || (sp.inflowId && oov.has(sp.inflowId)))) {
        released += Math.abs(sp.amount || 0);
        released_ids.push(t.id);
      }
    }
  }
  return {
    in: sum(c.in_ids), out: sum(c.out_ids), in_ids: [...c.in_ids].sort(), out_ids: [...c.out_ids].sort(),
    released: Math.round(released * 100) / 100, released_ids: released_ids.sort(),
  };
}

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
      const row = {
        period_id: w.period_id,
        derive: compute_period_view(deps, cadence),
        goals: v ? build_goals_view(w.period_id, v) : null,
      };
      if (EDGE) row.crossing = crossing_amounts(raw, deps.span_start_ms, deps.span_end_ms);
      return row;
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
        ctx, USER, b.id, p.start_date.toMillis(), p.end_date.toMillis(), true, scope
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
