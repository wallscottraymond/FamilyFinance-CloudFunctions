/** AF-03: a paused period lists the bill; a removed one doesn't. */
import { paused_until_for_due, paused_until_in_period } from "../recurring_suppression.service";

const D = (m: number, d: number) => Date.UTC(2026, m, d);
const paused = { from_ms: D(10, 1), to_ms: D(11, 15), mode: "paused" as const };

describe("paused_until_for_due", () => {
  it("judges the due date's month, however far past the resume date its week runs", () => {
    const short = { from_ms: D(8, 1), to_ms: D(9, 2), mode: "paused" as const };
    expect(paused_until_for_due([short], D(8, 29))).toBe(D(9, 2));
    expect(paused_until_for_due([short], D(9, 1))).toBeNull(); // October isn't dropped: it stays due
    expect(paused_until_for_due([short], D(7, 29))).toBeNull();
  });
});

describe("paused_until_in_period", () => {
  it("from the pause until its resume date", () => {
    expect(paused_until_in_period([paused], D(10, 30))).toBe(D(11, 15));
    expect(paused_until_in_period([paused], D(11, 15))).toBe(D(11, 15));
  });
  it("earlier and later periods keep their real history", () => {
    expect(paused_until_in_period([paused], D(9, 31))).toBeNull();
    expect(paused_until_in_period([paused], D(11, 31))).toBeNull();
  });
  it("removed after the pause: hidden, not listed as paused", () => {
    const cut = { ...paused, to_ms: D(11, 10) };
    expect(paused_until_in_period([cut, { from_ms: 0, to_ms: null, mode: "all" }], D(10, 30))).toBeNull();
    expect(paused_until_in_period([cut, { from_ms: D(10, 1), to_ms: null, mode: "going_forward" }], D(10, 30))).toBeNull();
  });
  it("an end set during the pause: paused until it starts, then hidden", () => {
    const end = { from_ms: D(11, 1), to_ms: null, mode: "going_forward" as const };
    expect(paused_until_in_period([paused, end], D(10, 30))).toBe(D(11, 15));
    expect(paused_until_in_period([paused, end], D(11, 15))).toBeNull();
  });
  it("a removal since restored, or an end set for after the pause, leaves it paused", () => {
    expect(paused_until_in_period([{ from_ms: D(1, 1), to_ms: D(2, 1), mode: "going_forward" }, paused], D(10, 30))).toBe(D(11, 15));
    expect(paused_until_in_period([paused, { from_ms: D(11, 20), to_ms: null, mode: "going_forward" }], D(10, 30))).toBe(D(11, 15));
  });
  it("a removed span isn't a pause", () => {
    expect(paused_until_in_period([{ from_ms: D(10, 1), to_ms: null, mode: "going_forward" }], D(10, 30))).toBeNull();
    expect(paused_until_in_period([{ from_ms: 0, to_ms: null, mode: "all" }], D(10, 30))).toBeNull();
    expect(paused_until_in_period(undefined, D(10, 30))).toBeNull();
  });
});
