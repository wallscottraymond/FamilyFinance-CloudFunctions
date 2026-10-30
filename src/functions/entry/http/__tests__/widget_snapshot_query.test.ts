import { parse_widget_query } from "../widget_snapshot.entry";

// The exact queries the iOS widgets send (ios/BudgWidgets WidgetRequest + WidgetFetcher). If a
// widget's request changes, add it here: a rejected query is a widget that silently never loads.
const WIDGET_QUERIES: Record<string, Record<string, string>> = {
  "Left to spend / Budgets": { kind: "left", cadence: "monthly", lookahead: "14" },
  "Budget transactions": { kind: "budget_txns", cadence: "monthly", lookahead: "14", budget: "b1" },
  "Period summary": { kind: "summary", cadence: "weekly", lookahead: "14" },
  "Bills due soon (7)": { kind: "bills", cadence: "monthly", lookahead: "7" },
  "Bills due soon (30)": { kind: "bills", cadence: "monthly", lookahead: "30" },
  "Recent transactions": { kind: "recent", cadence: "monthly", lookahead: "0" },
  "Recent transactions (group, cached)": {
    kind: "recent", cadence: "monthly", lookahead: "0", group: "g1", have: "1241332776779778",
  },
};

describe("widget_snapshot accepts every query the iOS widgets send", () => {
  for (const [name, query] of Object.entries(WIDGET_QUERIES)) {
    it(name, () => {
      expect(parse_widget_query(query)).not.toBeNull();
    });
  }

  it("look-ahead is checked only for Bills due soon", () => {
    expect(parse_widget_query({ kind: "bills", lookahead: "0" })).toBeNull();
    expect(parse_widget_query({ kind: "bills" })?.lookahead).toBe(14);
    expect(parse_widget_query({ kind: "recent", lookahead: "0" })?.lookahead).toBe(14);
    expect(parse_widget_query({ kind: "recent" })).not.toBeNull();
  });

  it("still rejects bad queries", () => {
    expect(parse_widget_query({ kind: "nope" })).toBeNull();
    expect(parse_widget_query({ kind: "budget_txns" })).toBeNull();
    expect(parse_widget_query({ kind: "recent", have: "-1" })).toBeNull();
  });
});
