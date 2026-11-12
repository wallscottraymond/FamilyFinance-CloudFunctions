/**
 * Plaid re-sync must keep the user's income settings (Income-Detail-Screen):
 * parts, forecast choices, per-check parts, note, and (when user-classified) the type + configs.
 */

import { Timestamp } from "firebase-admin/firestore";
import { map_persistence_to_doc, map_to_entity } from "../inflow.repo";
import { is_unchanged_recurring_doc } from "../recurring_doc_equality";

type Existing = NonNullable<Parameters<typeof map_persistence_to_doc>[2]>;
type Entity = Parameters<typeof map_persistence_to_doc>[0];

const NOW = Timestamp.fromMillis(Date.UTC(2026, 10, 12));
const ts = (y: number, m: number, d: number) => Timestamp.fromMillis(Date.UTC(y, m - 1, d));

function plaid_entity(): Entity {
  return {
    id: "s1", owner_id: "u1", created_by: "u1", updated_by: "u1", group_ids: [],
    plaid_item_id: "i1", plaid_stream_id: "s1", account_id: "a1",
    last_amount: 100, average_amount: 100, currency: "USD",
    description: "ACME", payer_name: "ACME", user_custom_name: null,
    frequency: "SEMI_MONTHLY", first_date: new Date(Date.UTC(2025, 0, 13)), last_date: new Date(Date.UTC(2026, 9, 28)),
    predicted_next_date: null,
    plaid_primary_category: "INCOME", plaid_detailed_category: "INCOME_WAGES",
    internal_primary_category: null, internal_detailed_category: null,
    income_type: "salary", is_regular_salary: true, is_variable: false,
    status: "active", source: "plaid", plaid_status: "MATURE", plaid_confidence_level: null,
    is_active: true, is_hidden: false, is_user_modified: false,
    transaction_ids: [], tags: [], rules: [],
  } as unknown as Entity;
}

function existing_doc(extra: Record<string, unknown> = {}): Existing {
  return {
    id: "s1", ownerId: "u1", createdAt: ts(2026, 1, 1), updatedAt: ts(2026, 1, 1),
    lastAmount: 100, averageAmount: 100, currency: "USD", description: "ACME", merchantName: "ACME", userCustomName: null,
    frequency: "SEMI_MONTHLY", firstDate: ts(2025, 1, 13), lastDate: ts(2026, 10, 28), predictedNextDate: null,
    plaidPrimaryCategory: "INCOME", plaidDetailedCategory: "INCOME_WAGES",
    internalPrimaryCategory: null, internalDetailedCategory: null,
    source: "plaid", isHidden: false, isUserModified: false, transactionIds: [], tags: [], rules: [],
    ...extra,
  } as unknown as Existing;
}

const PARTS = [
  { id: "base", kind: "base", schedule: "every", plan: "set", amount: 3092 },
  { id: "comm", kind: "commission", schedule: "end_of_month", plan: "typical", takesRest: true },
];

describe("inflow save carries the user's income settings through a Plaid re-save", () => {
  it("keeps incomeParts, forecastSettings, occurrenceParts, incomeNote", () => {
    const existing = existing_doc({
      incomeParts: PARTS,
      forecastSettings: { carefulMonths: 12, carefulRule: "low_end" },
      occurrenceParts: { "2026-10-28": [{ kind: "reimbursement", amount: 640 }] },
      incomeNote: "check with HR",
    });
    const doc = map_persistence_to_doc(plaid_entity(), NOW, existing) as unknown as Record<string, unknown>;
    expect(doc.incomeParts).toEqual(PARTS);
    expect(doc.forecastSettings).toEqual({ carefulMonths: 12, carefulRule: "low_end" });
    expect(doc.occurrenceParts).toEqual({ "2026-10-28": [{ kind: "reimbursement", amount: 640 }] });
    expect(doc.incomeNote).toBe("check with HR");
  });

  it("prunes occurrenceParts older than 24 months", () => {
    const existing = existing_doc({
      incomeParts: PARTS,
      occurrenceParts: {
        "2024-01-28": [{ kind: "tips", amount: 1 }], // > 24 months before 2026-11-12
        "2024-12-01": [{ kind: "tips", amount: 2 }],
        "2026-10-28": [{ kind: "tips", amount: 3 }],
      },
    });
    const doc = map_persistence_to_doc(plaid_entity(), NOW, existing) as unknown as { occurrenceParts: Record<string, unknown> };
    expect(Object.keys(doc.occurrenceParts).sort()).toEqual(["2024-12-01", "2026-10-28"]);
  });

  it("a user-classified income keeps its type and configs (isUserClassified)", () => {
    const existing = existing_doc({
      incomeType: "base_plus_commission", isUserClassified: true,
      commissionConfig: { baseAmount: 3092 }, hourlyConfig: { rate: 1 }, incomeVariability: "variable",
    });
    const doc = map_persistence_to_doc(plaid_entity(), NOW, existing) as unknown as Record<string, unknown>;
    expect(doc.incomeType).toBe("base_plus_commission");
    expect(doc.isUserClassified).toBe(true);
    expect(doc.commissionConfig).toEqual({ baseAmount: 3092 });
    expect(doc.hourlyConfig).toEqual({ rate: 1 });
    expect(doc.incomeVariability).toBe("variable");
  });

  it("non-empty incomeParts also counts as user-classified (type kept even without the flag)", () => {
    const existing = existing_doc({ incomeType: "commission", incomeParts: PARTS });
    const doc = map_persistence_to_doc(plaid_entity(), NOW, existing) as unknown as Record<string, unknown>;
    expect(doc.incomeType).toBe("commission");
  });

  it("an unclassified income still takes Plaid's type", () => {
    const doc = map_persistence_to_doc(plaid_entity(), NOW, existing_doc({ incomeType: "other" })) as unknown as Record<string, unknown>;
    expect(doc.incomeType).toBe("salary");
    expect("isUserClassified" in doc).toBe(false);
    expect("incomeParts" in doc).toBe(false);
  });

  it("carried fields do not make a re-sync rewrite (write-skip equality holds)", () => {
    const existing = existing_doc({
      incomeParts: PARTS, incomeNote: "n", isUserClassified: true, incomeType: "salary",
      occurrenceParts: { "2026-10-28": [{ kind: "tips", amount: 3 }] },
    });
    const first = map_persistence_to_doc(plaid_entity(), NOW, existing);
    const again = map_persistence_to_doc(plaid_entity(), Timestamp.fromMillis(NOW.toMillis() + 86_400_000), first);
    expect(is_unchanged_recurring_doc(first, again)).toBe(true);
  });
});

describe("map_to_entity", () => {
  it("parses the new fields defensively; absent for an income without them", () => {
    const plain = map_to_entity(existing_doc());
    expect("income_parts" in plain).toBe(false);
    expect("occurrence_parts" in plain).toBe(false);
    const e = map_to_entity(existing_doc({
      incomeParts: [...PARTS, { id: "bad", kind: "???" }],
      forecastSettings: { carefulMonths: 3, carefulRule: "lowest" },
      occurrenceParts: { "2026-10-28": [{ partId: "comm", kind: "commission", amount: 5 }] },
      incomeNote: "hi",
    }));
    expect(e.income_parts?.map((p) => p.id)).toEqual(["base", "comm"]);
    expect(e.income_parts?.[1].takes_rest).toBe(true);
    expect(e.forecast_settings).toEqual({ careful_months: 3, careful_rule: "lowest" });
    expect(e.occurrence_parts?.["2026-10-28"][0].part_id).toBe("comm");
    expect(e.income_note).toBe("hi");
  });
});
