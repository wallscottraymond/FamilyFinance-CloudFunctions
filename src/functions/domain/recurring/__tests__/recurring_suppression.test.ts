/**
 * Unit tests for the recurring-suppression domain service.
 * Time is in ms; period ends are the EXCLUSIVE end (start of the next period).
 */

import {
  RemovalInterval,
  is_suppressed_in_period,
  is_currently_suppressed,
  current_removal_state,
  apply_remove,
  apply_pause,
  apply_restore,
  EPOCH_MS,
} from "../recurring_suppression.service";

// Fixed calendar anchors (UTC) for readable scenarios.
const JAN1 = Date.UTC(2026, 0, 1);
const FEB1 = Date.UTC(2026, 1, 1);
const MAR1 = Date.UTC(2026, 2, 1);
const APR1 = Date.UTC(2026, 3, 1);
const MAY1 = Date.UTC(2026, 4, 1);
const JUN1 = Date.UTC(2026, 5, 1);
const JUN15 = Date.UTC(2026, 5, 15);
const JUL1 = Date.UTC(2026, 6, 1);
const AUG1 = Date.UTC(2026, 7, 1);

// Weekly anchors for the "resume snaps to the whole period" case.
const JAN5 = Date.UTC(2026, 0, 5);
const JAN7 = Date.UTC(2026, 0, 7);
const JAN12 = Date.UTC(2026, 0, 12);

describe("is_suppressed_in_period (period-boundary snap)", () => {
  it("no intervals → never suppressed", () => {
    expect(is_suppressed_in_period([], MAR1)).toBe(false);
  });

  it("'all' removal suppresses every period", () => {
    const iv: RemovalInterval[] = [{ from_ms: EPOCH_MS, to_ms: null, mode: "all" }];
    expect(is_suppressed_in_period(iv, JAN1)).toBe(true);
    expect(is_suppressed_in_period(iv, AUG1)).toBe(true);
  });

  it("'going_forward' keeps periods before the start, suppresses from the start on", () => {
    const iv: RemovalInterval[] = [{ from_ms: MAR1, to_ms: null, mode: "going_forward" }];
    expect(is_suppressed_in_period(iv, MAR1)).toBe(false); // Feb period (ends exactly at Mar 1) shows
    expect(is_suppressed_in_period(iv, APR1)).toBe(true); // March period (ends Apr 1) suppressed
    expect(is_suppressed_in_period(iv, MAY1)).toBe(true);
  });

  it("'paused' suppresses the span but shows the period CONTAINING the resume date in full", () => {
    const iv: RemovalInterval[] = [{ from_ms: MAR1, to_ms: JUN15, mode: "paused" }];
    expect(is_suppressed_in_period(iv, MAR1)).toBe(false); // Feb (before pause) shows
    expect(is_suppressed_in_period(iv, APR1)).toBe(true); // March suppressed
    expect(is_suppressed_in_period(iv, JUN1)).toBe(true); // May suppressed
    expect(is_suppressed_in_period(iv, JUL1)).toBe(false); // June contains Jun 15 → shows in FULL
    expect(is_suppressed_in_period(iv, AUG1)).toBe(false); // July+ show
  });

  it("weekly: resume mid-week includes the whole containing week", () => {
    // pause from month start, resume on the 7th; weekly periods 29–4 (end Jan5) and 5–11 (end Jan12)
    const iv: RemovalInterval[] = [{ from_ms: JAN1, to_ms: JAN7, mode: "paused" }];
    expect(is_suppressed_in_period(iv, JAN5)).toBe(true); // week ending Jan 5 (before resume) suppressed
    expect(is_suppressed_in_period(iv, JAN12)).toBe(false); // week 5–11 contains the 7th → shows in full
  });

  it("multiple intervals: suppress if ANY matches (a closed gap + an open removal)", () => {
    const iv: RemovalInterval[] = [
      { from_ms: JAN1, to_ms: FEB1, mode: "going_forward" }, // closed gap [Jan, Feb)
      { from_ms: APR1, to_ms: null, mode: "going_forward" }, // open removal from Apr
    ];
    expect(is_suppressed_in_period(iv, FEB1)).toBe(true); // Jan period → first interval
    expect(is_suppressed_in_period(iv, MAR1)).toBe(false); // Feb period → neither
    expect(is_suppressed_in_period(iv, APR1)).toBe(false); // Mar period → neither
    expect(is_suppressed_in_period(iv, MAY1)).toBe(true); // Apr period → second interval
  });
});

describe("is_currently_suppressed / current_removal_state", () => {
  it("no intervals → active", () => {
    expect(is_currently_suppressed([], MAR1)).toBe(false);
    expect(current_removal_state([], MAR1)).toEqual({ status: "active", resume_ms: null });
  });

  it("open removal covering now → removed", () => {
    const iv: RemovalInterval[] = [{ from_ms: MAR1, to_ms: null, mode: "going_forward" }];
    expect(is_currently_suppressed(iv, APR1)).toBe(true);
    expect(current_removal_state(iv, APR1)).toEqual({ status: "removed", resume_ms: null });
  });

  it("pause before its resume → paused (+ resume_ms); after resume → active again", () => {
    const iv: RemovalInterval[] = [{ from_ms: MAR1, to_ms: JUN15, mode: "paused" }];
    expect(is_currently_suppressed(iv, MAY1)).toBe(true);
    expect(current_removal_state(iv, MAY1)).toEqual({ status: "paused", resume_ms: JUN15 });
    // once now passes the resume date, auto-resumed — no write needed
    expect(is_currently_suppressed(iv, JUL1)).toBe(false);
    expect(current_removal_state(iv, JUL1)).toEqual({ status: "active", resume_ms: null });
  });

  it("a closed gap that doesn't cover now → active", () => {
    const iv: RemovalInterval[] = [{ from_ms: JAN1, to_ms: FEB1, mode: "going_forward" }];
    expect(is_currently_suppressed(iv, MAR1)).toBe(false);
  });
});

describe("apply_remove", () => {
  it("from active: appends an open interval (all → epoch, going_forward → month start)", () => {
    expect(apply_remove([], "all", APR1, APR1)).toEqual([
      { from_ms: EPOCH_MS, to_ms: null, mode: "all" },
    ]);
    expect(apply_remove([], "going_forward", APR1, APR1)).toEqual([
      { from_ms: APR1, to_ms: null, mode: "going_forward" },
    ]);
  });

  it("supersedes an active pause: closes it at now, then opens the removal", () => {
    const paused: RemovalInterval[] = [{ from_ms: MAR1, to_ms: JUN15, mode: "paused" }];
    const result = apply_remove(paused, "going_forward", MAY1, MAY1);
    expect(result).toEqual([
      { from_ms: MAR1, to_ms: MAY1, mode: "paused" }, // pause closed at now (permanent gap)
      { from_ms: MAY1, to_ms: null, mode: "going_forward" },
    ]);
  });
});

describe("apply_pause", () => {
  it("appends a bounded paused interval from month start to the resume date", () => {
    expect(apply_pause([], AUG1, JUN1, JUN1)).toEqual([
      { from_ms: JUN1, to_ms: AUG1, mode: "paused" },
    ]);
  });

  it("supersedes an active removal: closes it at now, then opens the pause", () => {
    const removed: RemovalInterval[] = [{ from_ms: MAR1, to_ms: null, mode: "going_forward" }];
    const result = apply_pause(removed, AUG1, MAY1, MAY1);
    expect(result).toEqual([
      { from_ms: MAR1, to_ms: MAY1, mode: "going_forward" }, // removal closed at now
      { from_ms: MAY1, to_ms: AUG1, mode: "paused" },
    ]);
  });
});

describe("apply_restore (forward-only)", () => {
  it("closes an open removal at now; the elapsed span stays a permanent gap", () => {
    const removed: RemovalInterval[] = [{ from_ms: MAR1, to_ms: null, mode: "going_forward" }];
    const restored = apply_restore(removed, MAY1);
    expect(restored).toEqual([{ from_ms: MAR1, to_ms: MAY1, mode: "going_forward" }]);
    // gap persists: a period inside [Mar, May) is still suppressed after restore
    expect(is_suppressed_in_period(restored, APR1)).toBe(true);
    // but it's no longer currently suppressed
    expect(is_currently_suppressed(restored, JUN1)).toBe(false);
  });

  it("resumes a pause early (closes it at now)", () => {
    const paused: RemovalInterval[] = [{ from_ms: MAR1, to_ms: AUG1, mode: "paused" }];
    expect(apply_restore(paused, MAY1)).toEqual([
      { from_ms: MAR1, to_ms: MAY1, mode: "paused" },
    ]);
  });

  it("is a no-op when nothing is currently active (idempotent)", () => {
    const closed: RemovalInterval[] = [{ from_ms: JAN1, to_ms: FEB1, mode: "going_forward" }];
    expect(apply_restore(closed, MAY1)).toEqual(closed);
  });
});
