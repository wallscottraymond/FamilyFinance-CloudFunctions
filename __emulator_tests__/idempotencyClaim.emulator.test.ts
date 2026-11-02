/**
 * Code-Health-Review batch 9 verify M2: a client retry reuses its idempotency key after a timeout.
 * The server must let that retry run when the first attempt FAILED or was killed mid-call (stale
 * in_progress), and must still refuse a live in-progress claim and never re-run a completed one.
 */
import * as admin from "firebase-admin";

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "localhost:8080";
if (!admin.apps.length) admin.initializeApp({ projectId: "family-budget-app-cb59b" });
const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });
const { Timestamp } = admin.firestore;

import { claim_key, STALE_IN_PROGRESS_MS } from "../src/functions/repositories/infrastructure/idempotency.repository";

const RUN = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const ctx = { trace_id: "t", span_id: "s" };
const TTL = 24 * 3600 * 1000;
const coll = () => db.collection("_idempotency");
const seed = (key: string, status: string, created_ago_ms: number) =>
  coll().doc(key).set({
    key, status, trace_id: "old",
    created_at: Timestamp.fromMillis(Date.now() - created_ago_ms),
    expires_at: Timestamp.fromMillis(Date.now() + TTL),
  });

describe("claim_key (verify M2)", () => {
  it("a new key is claimed; a live in-progress claim is refused", async () => {
    expect(await claim_key(ctx, `a_${RUN}`, TTL)).toBe(true);
    expect(await claim_key(ctx, `a_${RUN}`, TTL)).toBe(false);
  });
  it("a FAILED attempt's key can be retried", async () => {
    await seed(`b_${RUN}`, "failed", 1000);
    expect(await claim_key(ctx, `b_${RUN}`, TTL)).toBe(true);
    expect((await coll().doc(`b_${RUN}`).get()).data()!.status).toBe("in_progress");
  });
  it("an in-progress claim older than any function can run is taken over", async () => {
    await seed(`c_${RUN}`, "in_progress", STALE_IN_PROGRESS_MS + 60_000);
    expect(await claim_key(ctx, `c_${RUN}`, TTL)).toBe(true);
  });
  it("a recent in-progress claim and a COMPLETED key are never taken", async () => {
    await seed(`d_${RUN}`, "in_progress", 30_000);
    expect(await claim_key(ctx, `d_${RUN}`, TTL)).toBe(false);
    await seed(`e_${RUN}`, "completed", 1000);
    expect(await claim_key(ctx, `e_${RUN}`, TTL)).toBe(false);
  });
});

import { create_budget_orchestrator } from "../src/functions/orchestrators/budgets/create_budget.orchestrator";
import { createEverythingElseBudget } from "../src/functions/budgets/utils/createEverythingElseBudget";

describe("a create re-run after a FAILED key writes the SAME budget (verify V2-M1)", () => {
  it("first attempt saved, then its key was marked failed → the retry rewrites it, no duplicate", async () => {
    const U = `idem_u_${RUN}`;
    await db.collection("users").doc(U).set({ email: `${U}@x.com`, preferences: { currency: "USD" } });
    await createEverythingElseBudget(db, U);
    const key = `idem_create_${RUN}`;
    const input = {
      name: "Coffee", amount: 50, category_ids: [`coffee_${RUN}`], period: "monthly" as never,
      budget_type: "recurring" as never, start_date: "2031-01-01T00:00:00.000Z", alert_threshold: 80,
      is_shared: false, is_ongoing: true,
    };
    const first = await create_budget_orchestrator(ctx, U, key, input);
    // As if a follow-up step threw AFTER the save: the key ends "failed".
    await coll().doc(key).update({ status: "failed" });
    const retry = await create_budget_orchestrator(ctx, U, key, input);
    expect(retry.budget_id).toBe(first.budget_id);
    const mine = await db.collection("budgets").where("userId", "==", U).where("name", "==", "Coffee").get();
    expect(mine.size).toBe(1);
  });
});
