/**
 * Review round 5 (Convert-To-Recurring Phase 1) — planner ownership fixes, PURE:
 *   defect 1 — a tile its owner leaves open (its stream still in the response but no longer a
 *              suggest candidate: tombstoned / invalid / first seen inactive) is let go
 *              (`stream_gone`), and the owners list is built from the FINAL view (never dropped
 *              while a tile is still open) — nothing is stranded; another item's live stream
 *              takes the vendor over;
 *   defect 2 — a merchant rename closes the old tile (`stream_gone`): one open tile per stream.
 * Plus a simulated multi-item sync loop (the resolver's loading rule) proving convergence: no
 * stranded tile, and no write on identical input.
 */
import {
  CapturePlanInput,
  PlannerStream,
  plan_recurring_capture,
  stream_vendor,
} from "../recurring_capture_planner.service";
import {
  RecurringReviewState,
  ReviewItem,
  apply_review_state_change,
  changed_items,
  suggested_subject,
} from "../review_item.service";
import type { OutflowForPersistence } from "../../../integrations/plaid/plaid_recurring_transformer";

const NOW = Date.UTC(2026, 9, 15, 12);
const U = "u1";

const entity = (id: string, o: Partial<OutflowForPersistence> = {}): OutflowForPersistence => ({
  id, owner_id: U, created_by: U, updated_by: U, group_ids: [], plaid_item_id: "item", plaid_stream_id: id,
  account_id: "chk", last_amount: 10, average_amount: 10, currency: "USD", description: id.toUpperCase(),
  merchant_name: `M ${id}`, user_custom_name: null, frequency: "monthly", first_date: new Date(NOW - 9e9),
  last_date: new Date(NOW - 1e9), predicted_next_date: null, plaid_primary_category: "X",
  plaid_detailed_category: "LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT", internal_primary_category: null,
  internal_detailed_category: null, expense_type: "loan", is_essential: true, status: "pending_review",
  source: "plaid", plaid_status: "MATURE", plaid_confidence_level: null, is_active: true, is_hidden: false,
  is_user_modified: false, transaction_ids: [`${id}_t1`, `${id}_t2`], tags: [], rules: [], ...o,
});

const stream = (id: string, o: Partial<PlannerStream> = {}): PlannerStream => ({
  direction: "outflow", stream_id: id, entity: entity(id), raw_status: "MATURE", raw_frequency: "MONTHLY",
  raw_is_active: true, account_id: "chk", account_type: "depository", merchant_name: `M ${id}`,
  description: id.toUpperCase(), detailed_category: "LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT",
  transaction_ids: [`${id}_t1`, `${id}_t2`], average_amount: 10, predicted_next_ms: null, first_date_ms: NOW - 20 * 86400000, ...o,
});

const input = (o: Partial<CapturePlanInput>): CapturePlanInput => ({
  user_id: U, plaid_item_doc_id: "item", now_ms: NOW, flag_on: true, streams: [], existing: new Map(),
  stale_candidates: [], review_items: new Map(), state: null, ...o,
});

const plan = (o: Partial<CapturePlanInput>) => plan_recurring_capture(input(o));


const state = (o: Partial<RecurringReviewState> = {}): RecurringReviewState => ({
  user_id: U, suppressed_txn_ids: [], dismissed_vendor_keys: [], detector_last_run_day: null, ...o,
});

const early = (id: string, o: Partial<PlannerStream> = {}) =>
  stream(id, { raw_status: "EARLY_DETECTION", merchant_name: "Sunbit", description: "SUNBIT", ...o });

/** The user's review items + state, synced item by item. */
interface World { items: Map<string, ReviewItem>; state: RecurringReviewState }
const world = (): World => ({ items: new Map(), state: state() });

/**
 * One simulated sync of Plaid item `item`: loads exactly what the resolver loads (the review items
 * at the subjects of the response's streams, plus the tiles the state lists as this item's), plans,
 * writes only the changed items and the state when it changed.
 */
function sync(w: World, item: string, streams: PlannerStream[], o: Partial<CapturePlanInput> = {}) {
  const owned = new Set((w.state.suggested_owners ?? []).filter((x) => x.plaid_item_doc_id === item).map((x) => x.item_id));
  const subjects = new Set(streams.map((s) => suggested_subject(s.direction, stream_vendor(s))));
  const loaded = new Map([...w.items].filter(([id, it]) => owned.has(id) || subjects.has(it.subject_key)));
  const p = plan({ plaid_item_doc_id: item, streams, review_items: loaded, state: w.state, ...o });
  const writes = changed_items(p.review_items, loaded);
  for (const x of writes) w.items.set(x.id, x);
  const r = apply_review_state_change(w.state, U, p.state_change);
  w.state = r.next;
  return { p, writes: writes.length + (r.changed ? 1 : 0) };
}
const open_tiles = (w: World) => [...w.items.values()].filter((i) => i.kind === "suggested" && i.status === "open");
const owners = (w: World) => (w.state.suggested_owners ?? []).map((o) => [o.item_id, o.plaid_item_doc_id]);

describe("round 5 test 1 — a tile whose stream is tombstoned / invalid / inactive, then gone: never stranded", () => {
  for (const [label, mk] of [
    ["TOMBSTONED", () => early("s2", { raw_status: "TOMBSTONED" })],
    ["invalid entity", () => early("s2", { entity: null })],
    ["first seen inactive", () => early("s2", { raw_is_active: false })],
  ] as Array<[string, () => PlannerStream]>) {
    it(`${label}: item1 lets the tile go (stream_gone); item2's live stream takes the vendor over; then 0 writes`, () => {
      const w = world();
      sync(w, "item1", [early("s2")]);
      const [tile] = open_tiles(w);
      expect(owners(w)).toEqual([[tile.id, "item1"]]);
      // The stream is still in item1's response, but no longer a suggest candidate.
      sync(w, "item1", [mk()]);
      expect(w.items.get(tile.id)).toMatchObject({ status: "resolved", answer: "stream_gone" });
      // Its payments are released — except a TOMBSTONED stream's, which stay held out (D17).
      const held = tile.transaction_ids.filter((id) => w.state.suppressed_txn_ids.includes(id));
      expect(held).toEqual(label === "TOMBSTONED" ? tile.transaction_ids : []);
      expect(owners(w)).toEqual([]); // consistent with the final view: nothing open is owned
      // …then gone from item1 entirely; item2 has a live early stream of the vendor → it takes it.
      sync(w, "item1", []);
      sync(w, "item2", [early("s5")]);
      expect(open_tiles(w).map((i) => [i.id, i.plaid_item_doc_id, i.stream_id])).toEqual([[tile.id, "item2", "s5"]]);
      expect(owners(w)).toEqual([[tile.id, "item2"]]);
      // Converged: identical syncs of both items write nothing.
      for (let k = 0; k < 3; k++) {
        expect(sync(w, "item1", []).writes).toBe(0);
        expect(sync(w, "item2", [early("s5")]).writes).toBe(0);
      }
    });
  }

  it("the owners list follows the FINAL view: a tile left open (flag off: kept as is) stays listed — never dropped while open", () => {
    const w = world();
    sync(w, "item1", [early("s2")]);
    const [tile] = open_tiles(w);
    const r = sync(w, "item1", [early("s2", { raw_status: "TOMBSTONED" })], { flag_on: false });
    expect(w.items.get(tile.id)?.status).toBe("open");
    expect(r.p.state_change.set_suggested_owners).toBeUndefined();
    expect(owners(w)).toEqual([[tile.id, "item1"]]);
    // So once its stream is gone the owner still loads it and lets it go.
    sync(w, "item1", []);
    expect(w.items.get(tile.id)).toMatchObject({ status: "resolved", answer: "stream_gone" });
    expect(owners(w)).toEqual([]);
  });
});

describe("round 5 test 2 — a merchant rename closes the old tile: exactly one open tile per stream", () => {
  it("old vendor's tile closed stream_gone, the new vendor's tile opened from the same stream; then 0 writes", () => {
    const w = world();
    sync(w, "item1", [early("s2")]);
    const [old] = open_tiles(w);
    const renamed = early("s2", { merchant_name: "Sunbit Inc New", description: "SUNBIT NEW" });
    expect(stream_vendor(renamed)).not.toBe(stream_vendor(early("s2")));
    sync(w, "item1", [renamed]);
    expect(w.items.get(old.id)).toMatchObject({ status: "resolved", answer: "stream_gone" });
    const open = open_tiles(w);
    expect(open.map((i) => i.stream_id)).toEqual(["s2"]);
    expect(open[0].id).not.toBe(old.id);
    expect(owners(w)).toEqual([[open[0].id, "item1"]]);
    // The stream's payments stay held out throughout (the new tile holds them; never released).
    expect(w.state.suppressed_txn_ids).toEqual(expect.arrayContaining(old.transaction_ids));
    for (let k = 0; k < 3; k++) expect(sync(w, "item1", [renamed]).writes).toBe(0);
  });
});

