/**
 * Code-Health-Review P1-M5: Plaid's UNKNOWN frequency became "monthly" in the transformer — the
 * fan-out bug domain/recurring/frequency forbids (an expected payment every month). Now:
 *   - the transformer never maps UNKNOWN / unrecognized to monthly ("unknown")
 *   - the sync keeps an existing record's cadence; a new one stays "unknown" (stepped yearly)
 */
import { map_plaid_frequency_to_app } from "../../../integrations/plaid/plaid_recurring_transformer";
import { keep_known_frequency, normalize_frequency } from "../frequency";

describe("map_plaid_frequency_to_app", () => {
  it("UNKNOWN and unrecognized values are never monthly", () => {
    for (const raw of ["UNKNOWN", "unknown", "QUARTERLY_ISH", ""]) {
      expect(map_plaid_frequency_to_app(raw)).toBe("unknown");
      expect(normalize_frequency(map_plaid_frequency_to_app(raw))).toBe("UNKNOWN");
    }
  });
  it("known cadences are unchanged", () => {
    expect(["WEEKLY", "BIWEEKLY", "SEMI_MONTHLY", "MONTHLY", "ANNUALLY"].map(map_plaid_frequency_to_app))
      .toEqual(["weekly", "biweekly", "semimonthly", "monthly", "yearly"]);
  });
});

describe("keep_known_frequency", () => {
  const stored = new Map([["yearly_bill", "yearly"], ["odd", "unknown"]]);
  const get = (id: string) => stored.get(id);
  it("an existing record keeps its cadence when Plaid says UNKNOWN", () => {
    const [e] = keep_known_frequency([{ id: "yearly_bill", frequency: "unknown" }], get);
    expect(e.frequency).toBe("yearly");
  });
  it("a new stream (or one stored unknown) stays unknown — never monthly", () => {
    const out = keep_known_frequency([{ id: "new", frequency: "unknown" }, { id: "odd", frequency: "unknown" }], get);
    expect(out.map((e) => e.frequency)).toEqual(["unknown", "unknown"]);
  });
  it("a KNOWN Plaid cadence always wins (same object)", () => {
    const e = { id: "yearly_bill", frequency: "monthly" };
    expect(keep_known_frequency([e], get)[0]).toBe(e);
  });
});
