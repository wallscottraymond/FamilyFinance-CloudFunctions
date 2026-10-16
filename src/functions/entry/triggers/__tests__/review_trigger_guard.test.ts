/**
 * R7 — trigger loop guard (Convert-To-Recurring): a review-item / review-state write fires 0
 * functions, and a v2 record saved by a sync fires exactly what an old record's sync save fires.
 */
import * as fs from "fs";
import * as path from "path";

const bump = jest.fn(async () => undefined);
const reconcile = jest.fn(async () => undefined);
jest.mock("../../../repositories/derive_version.repo", () => ({ bump_derive_version: bump }));
jest.mock("../../../infrastructure/coalesced_jobs", () => ({ enqueue_reconcile_recurring: reconcile }));

import { handle_recurring_write } from "../on_recurring_updated.trigger";

const TRIGGERS = path.join(__dirname, "..");

describe("R7 trigger guard", () => {
  it("no trigger listens to recurring_review_items / _recurring_review_state (or a wildcard collection)", () => {
    const docs: string[] = [];
    for (const f of fs.readdirSync(TRIGGERS).filter((x) => x.endsWith(".ts"))) {
      const src = fs.readFileSync(path.join(TRIGGERS, f), "utf8");
      for (const m of src.matchAll(/document:\s*"([^"]+)"/g)) docs.push(m[1]);
    }
    expect(docs.length).toBeGreaterThan(5);
    for (const d of docs) {
      expect(d).not.toMatch(/recurring_review|_recurring_detector_state/);
      expect(d.split("/")[0]).not.toMatch(/^\{/); // never a wildcard collection segment
    }
  });

  const doc = (o: Record<string, unknown> = {}) => ({
    ownerId: "u", userId: "u", averageAmount: 10, expectedAmountOverride: null, transactionIds: ["a"], ...o,
  });

  it("a v2 record's SYNC save fires the same as an old record's (no bump, no reconcile, no recompute)", async () => {
    for (const extra of [{}, { captureRulesVersion: 2, plaidIsActive: false }]) {
      bump.mockClear();
      reconcile.mockClear();
      const before = doc({ ...extra, syncRunId: "run1" });
      const after = doc({ ...extra, syncRunId: "run2", transactionIds: ["a", "b"] });
      const did = await handle_recurring_write("outflow", "x", before, after, "e1");
      expect([did, bump.mock.calls.length, reconcile.mock.calls.length]).toEqual([false, 0, 0]);
    }
  });

  it("an answer's record write (not sync-stamped) bumps like any user edit, for old and v2 alike", async () => {
    for (const extra of [{}, { captureRulesVersion: 2 }]) {
      bump.mockClear();
      await handle_recurring_write("outflow", "x", doc(extra), doc({ ...extra, plaidInactiveAckAt: 1 }), "e2");
      expect(bump).toHaveBeenCalledTimes(1);
    }
  });
});
