/**
 * Code-Health-Review A1-M1: the per-user assignment watermark.
 *  (a) a write committing just after the read (older updatedAt than the newest row read) must be
 *      seen next run → the final page's watermark stops COMMIT_SKEW_MS before the read
 *  (b) rows unchanged since the assignment wrote them (updatedAt === assignedAt) are skipped
 *  paging: a full page advances to its last row (always forward, never loops)
 */
import { plan_assignment_page, COMMIT_SKEW_MS } from "../assignment_watermark.service";

const NOW = Date.UTC(2026, 10, 2, 12);
const row = (id: string, updated_ms: number, assigned_ms: number | null = null) => ({ id, updated_ms, assigned_ms });

describe("plan_assignment_page", () => {
  it("nothing changed → no work, watermark untouched", () => {
    expect(plan_assignment_page([], NOW, 10)).toEqual({ assign_ids: [], next_watermark_ms: null, more: false });
  });

  it("(a) last page: the watermark stops before the read, so a late-committing write is read next run", () => {
    const rows = [row("old", NOW - 10 * 60_000), row("recent", NOW - 5_000)];
    const p = plan_assignment_page(rows, NOW, 10);
    expect(p.assign_ids).toEqual(["old", "recent"]);
    expect(p.next_watermark_ms).toBe(NOW - COMMIT_SKEW_MS);
    // A write stamped NOW-30s that committed after the read is > the watermark → picked up.
    expect(NOW - 30_000).toBeGreaterThan(p.next_watermark_ms!);
    expect(p.more).toBe(false);
  });

  it("(a) rows all older than the skew: the watermark goes to the last row", () => {
    const rows = [row("a", NOW - 60 * 60_000), row("b", NOW - 30 * 60_000)];
    expect(plan_assignment_page(rows, NOW, 10).next_watermark_ms).toBe(NOW - 30 * 60_000);
  });

  it("(b) a row unchanged since the assignment wrote it is skipped (but still passed)", () => {
    const t = NOW - 60 * 60_000;
    const rows = [row("mine", t, t), row("edited_after", t + 1000, t), row("never", t + 2000)];
    const p = plan_assignment_page(rows, NOW, 10);
    expect(p.assign_ids).toEqual(["edited_after", "never"]);
    expect(p.next_watermark_ms).toBe(t + 2000);
  });

  it("a full page advances to its last row even inside the skew window (paging can't loop)", () => {
    const rows = [row("a", NOW - 3000), row("b", NOW - 2000)];
    const p = plan_assignment_page(rows, NOW, 2);
    expect(p.more).toBe(true);
    expect(p.next_watermark_ms).toBe(NOW - 2000);
  });
});
