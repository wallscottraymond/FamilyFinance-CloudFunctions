/**
 * Audit entries are SLIM (Storage-Cost-Audit, 2026-10-05): changed field names + hashes are
 * kept, the whole before/after documents are not; retention is 30 days.
 */
jest.mock("firebase-admin/firestore", () => ({
  getFirestore: jest.fn(),
  Timestamp: { fromMillis: (ms: number) => ({ toMillis: () => ms }) },
}));
import { AUDIT_RETENTION_MS, create_audit_entry } from "../audit_writer";

const NOW = Date.UTC(2026, 9, 5);
const input = {
  user_id: "u1",
  action: "update" as const,
  entity_type: "transaction" as const,
  entity_id: "t1",
  trace_id: "trace-1",
  before: { amount: 40, name: "A", splits: [{ amount: 40 }] },
  after: { amount: 46, name: "A", splits: [{ amount: 46 }] },
  metadata: { source: "api" as const, context: { plaid_sync: true } },
};

describe("create_audit_entry", () => {
  it("does not store the whole before/after documents", () => {
    const e = create_audit_entry(input, NOW);
    expect("before" in e).toBe(false);
    expect("after" in e).toBe(false);
  });

  it("keeps what's useful for debugging: changed fields, hashes, trace, metadata", () => {
    const e = create_audit_entry(input, NOW);
    expect(e.changed_fields).toEqual(["amount", "splits"]);
    expect(e.before_hash).not.toBe(e.after_hash);
    expect(e.trace_id).toBe("trace-1");
    expect(e.metadata?.context).toEqual({ plaid_sync: true });
  });

  it("expires 30 days after it's written", () => {
    expect(AUDIT_RETENTION_MS).toBe(30 * 24 * 60 * 60 * 1000);
    const e = create_audit_entry(input, NOW);
    expect(e.expire_at.toMillis() - e.timestamp.toMillis()).toBe(AUDIT_RETENTION_MS);
  });

  it("is small: well under the old ~3.4 KB per entry", () => {
    const big = { ...input, before: { blob: "x".repeat(5000) }, after: { blob: "y".repeat(5000) } };
    expect(JSON.stringify(create_audit_entry(big, NOW)).length).toBeLessThan(600);
  });
});
