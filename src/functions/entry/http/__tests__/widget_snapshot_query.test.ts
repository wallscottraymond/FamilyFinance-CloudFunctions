import { parse_widget_query } from "../widget_snapshot.entry";

// The exact queries the iOS widgets send (ios/BudgWidgets WidgetRequest + WidgetFetcher). If a
// widget's request changes, add it here: a rejected query is a widget that silently never loads.
const WIDGET_QUERIES: Record<string, Record<string, string>> = {
  "Left to spend / Budgets": { kind: "left", cadence: "monthly", lookahead: "14", day: "2026-10-31" },
  "Budget transactions": { kind: "budget_txns", cadence: "monthly", lookahead: "14", budget: "b1", day: "2026-10-31" },
  "Period summary": { kind: "summary", cadence: "weekly", lookahead: "14", day: "2026-10-31" },
  "Bills due soon (7)": { kind: "bills", cadence: "monthly", lookahead: "7", day: "2026-10-31" },
  "Bills due soon (30)": { kind: "bills", cadence: "monthly", lookahead: "30", day: "2026-10-31" },
  "Recent transactions": { kind: "recent", cadence: "monthly", lookahead: "0", day: "2026-10-31" },
  "Recent transactions (group, cached)": {
    kind: "recent", cadence: "monthly", lookahead: "0", group: "g1", have: "1241332776779778", day: "2026-10-31",
  },
};

describe("widget_snapshot accepts every query the iOS widgets send", () => {
  for (const [name, query] of Object.entries(WIDGET_QUERIES)) {
    it(name, () => {
      expect(parse_widget_query(query)).not.toBeNull();
    });
  }

  it("look-ahead is checked only for Bills due soon", () => {
    expect(parse_widget_query({ kind: "bills", lookahead: "0", day: "2026-10-31" })).toBeNull();
    expect(parse_widget_query({ kind: "bills" })?.lookahead).toBe(14);
    expect(parse_widget_query({ kind: "recent", lookahead: "0", day: "2026-10-31" })?.lookahead).toBe(14);
    expect(parse_widget_query({ kind: "recent" })).not.toBeNull();
  });

  it("still rejects bad queries", () => {
    expect(parse_widget_query({ kind: "nope" })).toBeNull();
    expect(parse_widget_query({ kind: "budget_txns" })).toBeNull();
    expect(parse_widget_query({ kind: "recent", have: "-1" })).toBeNull();
  });
});

// Batch 6 verify #3 (Medium 2): the widget sends its LOCAL day; the period is picked from it.
import { widget_day_ms } from "../widget_snapshot.entry";

describe("widget_day_ms — the instant the widget's period is chosen at", () => {
  // Sat Oct 31 2026, 8 pm in New York = Sun Nov 1, 00:00 UTC.
  const NY_SAT_EVENING = Date.UTC(2026, 10, 1, 0, 0);
  it("a US evening: the widget's local Saturday wins over the server's UTC Sunday", () => {
    const ms = widget_day_ms("2026-10-31", NY_SAT_EVENING);
    expect(ms).toBe(Date.UTC(2026, 9, 31, 12));
    expect(Math.floor(ms / 86_400_000)).toBe(Math.floor(Date.UTC(2026, 9, 31) / 86_400_000));
  });
  it("a day ahead of UTC (Asia morning) is accepted too", () => {
    expect(widget_day_ms("2026-11-02", NY_SAT_EVENING)).toBe(Date.UTC(2026, 10, 2, 12));
  });
  it("absent, malformed, impossible or more than a day away → the server clock (old builds)", () => {
    for (const d of [undefined, "2026-02-30", "2026-13-01", "2026-10-29", "2026-11-03"]) {
      expect(widget_day_ms(d, NY_SAT_EVENING)).toBe(NY_SAT_EVENING);
    }
  });
  it("the query accepts YYYY-MM-DD and rejects anything else", () => {
    expect(parse_widget_query({ kind: "left", day: "2026-10-31" })?.day).toBe("2026-10-31");
    expect(parse_widget_query({ kind: "left", day: "10/31/2026" })).toBeNull();
  });
});
