/**
 * classify_internal_transfers — skip-if-unchanged (read-cost) behavior.
 *
 * The 180-day transaction scan must be skipped when the recurring inputs are unchanged and
 * the last full run is < 24h old, and must run otherwise.
 */

const outflows: Array<Record<string, unknown>> = [];
const inflows: Array<Record<string, unknown>> = [];
let state: { fingerprint: string; classified_at_ms: number } | null = null;
const scan = jest.fn(async () => [] as unknown[]);

jest.mock("../../../repositories", () => ({
  outflow_repo: {
    get_by_user_id: jest.fn(async () => outflows),
    mark_hidden: jest.fn(async () => []),
  },
  inflow_repo: {
    get_by_user_id: jest.fn(async () => inflows),
    mark_hidden: jest.fn(async () => []),
  },
}));
jest.mock("../../../repositories/transaction.repo", () => ({
  transaction_repo: { get_active_in_date_range: scan },
}));
jest.mock("../../../repositories/outflow_period.repo", () => ({
  outflow_period_repo: { set_hidden_by_outflow_ids: jest.fn(async () => 0) },
}));
jest.mock("../../../repositories/inflow_period.repo", () => ({
  inflow_period_repo: { set_hidden_by_inflow_ids: jest.fn(async () => 0) },
}));
jest.mock("../../../repositories/transfer_classification_state.repo", () => ({
  get_transfer_classification_state: jest.fn(async () => state),
  set_transfer_classification_state: jest.fn(async (_u: string, s: typeof state) => {
    state = s;
  }),
}));

import { classify_internal_transfers_orchestrator } from "../classify_internal_transfers.orchestrator";

const ctx = { trace_id: "t" } as never;
const T0 = Date.UTC(2026, 8, 28);
const HOUR = 60 * 60 * 1000;

beforeEach(() => {
  outflows.length = 0;
  inflows.length = 0;
  outflows.push({
    id: "o1",
    plaid_detailed_category: "TRANSFER_OUT_ACCOUNT_TRANSFER",
    transaction_ids: ["p1", "p2"],
    is_hidden: false,
  });
  state = null;
  scan.mockClear();
});

describe("classify_internal_transfers skip-if-unchanged", () => {
  it("runs the scan on first run, then skips while inputs are unchanged", async () => {
    const first = await classify_internal_transfers_orchestrator(ctx, "u1", T0);
    expect(first.skipped).toBe(false);
    expect(scan).toHaveBeenCalledTimes(1);

    const second = await classify_internal_transfers_orchestrator(ctx, "u1", T0 + HOUR);
    expect(second.skipped).toBe(true);
    expect(scan).toHaveBeenCalledTimes(1);
  });

  it("re-runs when a stream's transaction ids change", async () => {
    await classify_internal_transfers_orchestrator(ctx, "u1", T0);
    (outflows[0].transaction_ids as string[]).push("p3");
    const r = await classify_internal_transfers_orchestrator(ctx, "u1", T0 + HOUR);
    expect(r.skipped).toBe(false);
    expect(scan).toHaveBeenCalledTimes(2);
  });

  it("re-runs when a record's hidden flag was changed elsewhere", async () => {
    await classify_internal_transfers_orchestrator(ctx, "u1", T0);
    outflows[0].is_hidden = true;
    const r = await classify_internal_transfers_orchestrator(ctx, "u1", T0 + HOUR);
    expect(r.skipped).toBe(false);
  });

  it("forces a full re-run after 24h even when unchanged", async () => {
    await classify_internal_transfers_orchestrator(ctx, "u1", T0);
    const r = await classify_internal_transfers_orchestrator(ctx, "u1", T0 + 25 * HOUR);
    expect(r.skipped).toBe(false);
    expect(scan).toHaveBeenCalledTimes(2);
  });
});
