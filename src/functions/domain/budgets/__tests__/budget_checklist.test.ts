import {
  apply_checklist_op as apply, BudgetChecklist, CHECKLIST_MAX_ITEMS, compute_initial_checklist, CHECKLIST_MAX_TICK_PERIODS, EMPTY_CHECKLIST,
} from "../budget_checklist.service";

const DEC = "2026-12";
const add = (c: BudgetChecklist, id: string, estimate = 10) =>
  apply(c, { op: "add", id, name: ` ${id} `, estimate, period_key: DEC }).checklist!;

describe("apply_checklist_op", () => {
  it("adds with a tidy name and a rounded estimate", () => {
    const c = add(EMPTY_CHECKLIST, "a", 10.005);
    expect(c.items[0]).toEqual({ id: "a", name: "a", estimate: 10.01, period_key: null });
  });
  it("not carrying: an item belongs to its period", () => {
    expect(add({ ...EMPTY_CHECKLIST, carry: false }, "a").items[0].period_key).toBe(DEC);
  });
  it("refuses a blank name and too many items; a repeat add does nothing", () => {
    expect(apply(EMPTY_CHECKLIST, { op: "add", id: "a", name: "  ", estimate: 1, period_key: DEC }).errors).toBeDefined();
    let c = EMPTY_CHECKLIST;
    for (let i = 0; i < CHECKLIST_MAX_ITEMS; i++) c = add(c, `i${i}`);
    expect(apply(c, { op: "add", id: "x", name: "x", estimate: 1, period_key: DEC }).errors).toBeDefined();
    expect(add(c, "i0").items).toHaveLength(CHECKLIST_MAX_ITEMS);
  });
  it("two people's edits both survive", () => {
    const base = add(EMPTY_CHECKLIST, "a");
    const one = apply(base, { op: "tick", id: "a", period_key: DEC, ticked: true }).checklist!;
    const two = add(one, "b");
    expect(two.items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(two.ticks[DEC]).toEqual(["a"]);
  });
  it("ticking an item someone removed does nothing", () => {
    expect(apply(EMPTY_CHECKLIST, { op: "tick", id: "gone", period_key: DEC, ticked: true }).checklist?.ticks).toEqual({});
  });
  it("removing an item removes its ticks", () => {
    const t = apply(add(EMPTY_CHECKLIST, "a"), { op: "tick", id: "a", period_key: DEC, ticked: true }).checklist!;
    expect(apply(t, { op: "remove", id: "a" }).checklist).toEqual(EMPTY_CHECKLIST);
  });
  it("turning carrying off keeps items in the period in view", () => {
    const off = apply(add(EMPTY_CHECKLIST, "a"), { op: "carry", carry: false, period_key: DEC }).checklist!;
    expect(off.items[0].period_key).toBe(DEC);
    expect(apply(off, { op: "carry", carry: true, period_key: DEC }).checklist?.items[0].period_key).toBeNull();
  });
  it("older periods' ticks drop off", () => {
    let c = add(EMPTY_CHECKLIST, "a");
    for (let i = 0; i < CHECKLIST_MAX_TICK_PERIODS + 5; i++) {
      c = apply(c, { op: "tick", id: "a", period_key: `20${10 + i}-01`, ticked: true }).checklist!;
    }
    expect(Object.keys(c.ticks)).toHaveLength(CHECKLIST_MAX_TICK_PERIODS);
    expect(c.ticks["2010-01"]).toBeUndefined();
  });
});

describe("compute_initial_checklist", () => {
  it("starts a carrying list, with no ticks", () => {
    const { checklist } = compute_initial_checklist([
      { id: "a", name: " Train set ", estimate: 100 },
      { id: "b", name: "Bike", estimate: 200 },
    ]);
    expect(checklist).toEqual({
      carry: true,
      ticks: {},
      items: [
        { id: "a", name: "Train set", estimate: 100, period_key: null },
        { id: "b", name: "Bike", estimate: 200, period_key: null },
      ],
    });
  });
  it("no items: the empty list", () => {
    expect(compute_initial_checklist([]).checklist).toEqual(EMPTY_CHECKLIST);
  });
  it("a repeated id counts once; a blank name is refused", () => {
    const one = { id: "a", name: "x", estimate: 1 };
    expect(compute_initial_checklist([one, one]).checklist?.items).toHaveLength(1);
    expect(compute_initial_checklist([{ ...one, name: " " }]).errors).toBeDefined();
  });
});
