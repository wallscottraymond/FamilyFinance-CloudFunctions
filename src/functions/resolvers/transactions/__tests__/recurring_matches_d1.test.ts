/**
 * Matching order with converted bills (Convert-To-Recurring Phase 2, D1):
 *   1 Plaid stream membership  2 D1 key (final)  3 X3 hold-out  4 fuzzy — converted ids excluded.
 * The candidates are preloaded, so no IO.
 */
import { resolve_recurring_matches } from "../recurring_matches.resolver";
import { build_converted_index, ConvertedRecordInput } from "../../../domain/recurring/converted_match.service";

const DAY = 86_400_000;
const T0 = Date.UTC(2037, 9, 1);
const ctx = { trace_id: "t", span_id: "s" };

const rec = (o: Partial<ConvertedRecordInput> & { id: string }): ConvertedRecordInput => ({
  direction: "outflow", is_active: true, is_hidden: false, capture_rules_version: 2, source: "manual",
  vendor_key: "netflix", account_id: "acc1", average_amount: 15, first_date_ms: T0 - 60 * DAY, converted_at_ms: T0 - 5 * DAY,
  retro_txn_ids: [], ...o,
});
const cand = (recurring_id: string, merchant: string, amount: number, due: number) => ({
  period_id: `${recurring_id}_p`, recurring_id, merchant_name: merchant, expected_amount: amount, due_date_ms: due, is_settled: false,
});
const preloaded = (outflow_candidates: ReturnType<typeof cand>[]) => ({
  outflow_candidates, inflow_candidates: [], window_start_ms: T0 - 400 * DAY, window_end_ms: T0 + 400 * DAY,
});

const base = (extra: Record<string, unknown> = {}) => ({
  txn_plaid_id: "p1", txn_account_id: "acc1", txn_vendor_key: "netflix",
  converted_index: build_converted_index([rec({ id: "conv" })]),
  preloaded_candidates: preloaded([]),
  ...extra,
});
const one = [{ split_id: "s1", amount: 9.99 }];

describe("D1 in the matching order", () => {
  it("links a same-key single-split payment to the converted bill, any amount", async () => {
    const r = await resolve_recurring_matches(ctx, "u", "expense", "Netflix", T0, one, base());
    expect(r.s1).toEqual({ outflow_id: "conv", inflow_id: null });
    const big = await resolve_recurring_matches(ctx, "u", "expense", "Netflix", T0, [{ split_id: "s1", amount: 900 }], base());
    expect(big.s1.outflow_id).toBe("conv");
  });

  it("a different vendor, account or direction is not linked", async () => {
    expect((await resolve_recurring_matches(ctx, "u", "expense", "Hulu", T0, one, base({ txn_vendor_key: "hulu" }))).s1.outflow_id).toBeNull();
    expect((await resolve_recurring_matches(ctx, "u", "expense", "Netflix", T0, one, base({ txn_account_id: "acc2" }))).s1.outflow_id).toBeNull();
    expect((await resolve_recurring_matches(ctx, "u", "income", "Netflix", T0, one, base())).s1.inflow_id).toBeNull();
  });

  it("only single-split payments link (a multi-split one is the user's own breakdown)", async () => {
    const r = await resolve_recurring_matches(ctx, "u", "expense", "Netflix", T0,
      [{ split_id: "s1", amount: 5 }, { split_id: "s2", amount: 5 }], base());
    expect(r.s1.outflow_id).toBeNull();
    expect(r.s2.outflow_id).toBeNull();
  });

  it("a payment before the bill's floor stays unlinked, unless a convert linked it", async () => {
    const early = T0 - 30 * DAY;
    expect((await resolve_recurring_matches(ctx, "u", "expense", "Netflix", early, one, base())).s1.outflow_id).toBeNull();
    const with_retro = base({ converted_index: build_converted_index([rec({ id: "conv", retro_txn_ids: ["p1"] })]) });
    expect((await resolve_recurring_matches(ctx, "u", "expense", "Netflix", early, one, with_retro)).s1.outflow_id).toBe("conv");
  });

  it("stream membership comes first, and D1 beats the hold-out", async () => {
    const stream = await resolve_recurring_matches(ctx, "u", "expense", "Netflix", T0, one,
      base({ outflow_tx_to_id: new Map([["p1", "plaid_bill"]]) }));
    expect(stream.s1).toMatchObject({ outflow_id: "plaid_bill", d1_alt_id: "conv", d1_alt_kind: "outflow" });
    const held = await resolve_recurring_matches(ctx, "u", "expense", "Netflix", T0, one,
      base({ fuzzy_excluded_plaid_ids: new Set(["p1"]) }));
    expect(held.s1.outflow_id).toBe("conv");
  });

  it("fuzzy matching never links to a converted bill (its merchant text would match)", async () => {
    // The key differs ("netflix.com" vs "netflix"); the fuzzy scorer would score the bill 50+30+20.
    const r = await resolve_recurring_matches(ctx, "u", "expense", "Netflix.com", T0, [{ split_id: "s1", amount: 15 }], {
      ...base({ txn_vendor_key: "netflix.com" }),
      preloaded_candidates: preloaded([cand("conv", "Netflix", 15, T0)]),
    });
    expect(r.s1.outflow_id).toBeNull();
  });

  it("an old bill still fuzzy-matches as before when converted bills exist", async () => {
    const r = await resolve_recurring_matches(ctx, "u", "expense", "Spotify", T0, [{ split_id: "s1", amount: 10 }], {
      ...base({ txn_vendor_key: "spotify" }),
      preloaded_candidates: preloaded([cand("old", "Spotify", 10, T0)]),
    });
    expect(r.s1.outflow_id).toBe("old");
  });

  it("two bills of one key: the scorer decides among exactly those, else closest amount, else id", async () => {
    const two = build_converted_index([rec({ id: "icloud", average_amount: 3 }), rec({ id: "music", average_amount: 11 })]);
    const near_music = await resolve_recurring_matches(ctx, "u", "expense", "Apple", T0, [{ split_id: "s1", amount: 10.9 }], {
      ...base({ converted_index: two }),
      preloaded_candidates: preloaded([cand("icloud", "Apple", 3, T0 + DAY), cand("music", "Apple", 11, T0 + DAY)]),
    });
    expect(near_music.s1.outflow_id).toBe("music");
    // no candidate periods at all: closest amount decides
    const none = await resolve_recurring_matches(ctx, "u", "expense", "x", T0, [{ split_id: "s1", amount: 3.4 }], {
      ...base({ converted_index: two }),
    });
    expect(none.s1.outflow_id).toBe("icloud");
  });

  it("no converted records → exactly the old behavior (nothing D1, nothing excluded)", async () => {
    const r = await resolve_recurring_matches(ctx, "u", "expense", "Spotify", T0, [{ split_id: "s1", amount: 10 }], {
      txn_plaid_id: "p1", txn_account_id: "acc1", txn_vendor_key: "spotify",
      converted_index: build_converted_index([]),
      preloaded_candidates: preloaded([cand("old", "Spotify", 10, T0)]),
    });
    expect(r.s1).toEqual({ outflow_id: "old", inflow_id: null });
  });
});
