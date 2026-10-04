/**
 * Read-Cost-Review-Round-3: per-write recompute / reconcile jobs coalesce.
 *  - a burst (the 2026-10-02 sync: 78 txn writes) collapses to one job per key;
 *  - a job already PROCESSING never absorbs a new write (nothing dropped);
 *  - keys separate exactly what each run covers (budgets + UTC day; stream).
 */
type JobDoc = { job_type: string; dedup_key?: string; status: string; payload: Record<string, unknown>; scheduled_for?: { toMillis: () => number } };
const jobs = new Map<string, JobDoc>();

jest.mock("firebase-admin/firestore", () => {
  const ts = (ms: number) => ({ toMillis: () => ms });
  const query = (filters: Array<[string, unknown]>, lim = Infinity) => ({
    where: (f: string, _op: string, v: unknown) => query([...filters, [f, v]], lim),
    limit: (n: number) => query(filters, n),
    get: async () => {
      const docs = [...jobs.values()].filter((j) =>
        filters.every(([f, v]) => (j as unknown as Record<string, unknown>)[f] === v)
      ).slice(0, lim);
      return { empty: docs.length === 0, size: docs.length, docs };
    },
  });
  return {
    Timestamp: { now: () => ts(Date.now()), fromMillis: ts },
    getFirestore: () => ({
      collection: () => ({
        ...query([]),
        doc: (id: string) => ({ set: async (j: JobDoc) => void jobs.set(id, j) }),
      }),
    }),
  };
});

import {
  enqueue_recompute_budget_spent,
  enqueue_reconcile_recurring,
  recompute_coalesce_key,
  COALESCE_DELAY_SECONDS,
} from "../coalesced_jobs";

const OCT1 = Date.UTC(2026, 9, 1);
const byType = (t: string) => [...jobs.values()].filter((j) => j.job_type === t);

beforeEach(() => jobs.clear());

it("the Oct 2 burst: 78 writes on the same budgets + day → ONE delayed recompute (was 78)", async () => {
  for (let i = 0; i < 78; i++) {
    await enqueue_recompute_budget_spent({ user_id: "u", budget_ids: ["ee", "groceries"], transaction_date_ms: OCT1 + i * 60_000 });
  }
  const r = byType("recompute_budget_spent");
  expect(r).toHaveLength(1);
  expect(r[0].scheduled_for).toBeDefined();
  expect(r[0].payload).toMatchObject({ user_id: "u", budget_ids: ["ee", "groceries"], transaction_date_ms: OCT1 });
});

it("78 writes linked to the same bill → ONE delayed reconcile (was 78)", async () => {
  for (let i = 0; i < 78; i++) {
    await enqueue_reconcile_recurring({ user_id: "u", recurring_id: "rent", recurring_type: "outflow" });
  }
  expect(byType("reconcile_recurring_period")).toHaveLength(1);
});

it("different budgets, days or bills stay separate (each run covers exactly its key)", async () => {
  await enqueue_recompute_budget_spent({ user_id: "u", budget_ids: ["a"], transaction_date_ms: OCT1 });
  await enqueue_recompute_budget_spent({ user_id: "u", budget_ids: ["b"], transaction_date_ms: OCT1 });
  await enqueue_recompute_budget_spent({ user_id: "u", budget_ids: ["a"], transaction_date_ms: OCT1 + 86_400_000 });
  await enqueue_reconcile_recurring({ user_id: "u", recurring_id: "rent", recurring_type: "outflow" });
  await enqueue_reconcile_recurring({ user_id: "u", recurring_id: "pay", recurring_type: "inflow" });
  expect(byType("recompute_budget_spent")).toHaveLength(3);
  expect(byType("reconcile_recurring_period")).toHaveLength(2);
});

it("budget id order doesn't matter (same key)", () => {
  expect(recompute_coalesce_key("u", ["b", "a", "a"], OCT1)).toBe(recompute_coalesce_key("u", ["a", "b"], OCT1 + 5_000));
});

it("a job already PROCESSING never absorbs a new write — it gets its own job (nothing dropped)", async () => {
  await enqueue_recompute_budget_spent({ user_id: "u", budget_ids: ["a"], transaction_date_ms: OCT1 });
  byType("recompute_budget_spent")[0].status = "processing";
  await enqueue_recompute_budget_spent({ user_id: "u", budget_ids: ["a"], transaction_date_ms: OCT1 });
  const r = byType("recompute_budget_spent");
  expect(r).toHaveLength(2);
  expect(r.filter((j) => j.status === "pending")).toHaveLength(1);
  // …and a COMPLETED one doesn't either.
  r.forEach((j) => (j.status = "completed"));
  await enqueue_recompute_budget_spent({ user_id: "u", budget_ids: ["a"], transaction_date_ms: OCT1 });
  expect(byType("recompute_budget_spent").filter((j) => j.status === "pending")).toHaveLength(1);
});

it("no budgets → no job", async () => {
  await enqueue_recompute_budget_spent({ user_id: "u", budget_ids: [], transaction_date_ms: OCT1 });
  expect(jobs.size).toBe(0);
});

it("delay is the agreed ~30s debounce", () => {
  expect(COALESCE_DELAY_SECONDS).toBe(30);
});
