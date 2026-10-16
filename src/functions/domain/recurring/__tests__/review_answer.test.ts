import { plan_review_answer } from "../review_answer.service";
import { ReviewItem, make_review_item, suggested_subject } from "../review_item.service";

const NOW = Date.UTC(2026, 9, 15);
const item = (o: Partial<ReviewItem> = {}): ReviewItem => make_review_item({
  user_id: "u", kind: "suggested", direction: "outflow", source: "plaid", status: "open", answer: null,
  subject_key: suggested_subject("outflow", "avant"), vendor_key: "avant", account_id: "chk", plaid_item_doc_id: "item1",
  stream_id: "s", record_id: null, name: "Avant", amount: 98, frequency: "monthly", plaid_status: "MATURE",
  category: null, transaction_ids: ["p1", "p2"], next_due_ms: null, user_frequency: null, resolved_at_ms: null, ...o,
}, NOW);

describe("plan_review_answer", () => {
  it("track a Plaid suggestion → resolved, re-sync the item; ids stay held out until the bill exists", () => {
    const r = plan_review_answer(item(), "track", NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.item).toMatchObject({ status: "resolved", answer: "track" });
    // Remembered as pending until the bill exists (defect 4).
    expect(r.plan.state_change).toEqual({ add_pending_tracks: [{
      item_id: r.plan.item!.id, plaid_item_doc_id: "item1", account_id: "chk", stream_id: "s", since_ms: NOW,
    }] });
    expect(r.plan.resync_item_doc_id).toBe("item1");
  });

  it("track with UNKNOWN frequency needs a picked schedule (D8); the pick is kept", () => {
    expect(plan_review_answer(item({ frequency: null }), "track", NOW)).toEqual({ ok: false, error: "pick a schedule for this bill" });
    const r = plan_review_answer(item({ frequency: null }), "track", NOW, { frequency: "biweekly" });
    expect(r.ok && r.plan.item?.user_frequency).toBe("biweekly");
    expect(plan_review_answer(item({ frequency: null }), "track", NOW, { frequency: "fortnightly" }).ok).toBe(false);
  });

  it("not a bill → dismissed + vendor remembered; ids stay held out", () => {
    const r = plan_review_answer(item(), "not_bill", NOW);
    expect(r.ok && r.plan.item?.status).toBe("dismissed");
    expect(r.ok && r.plan.state_change).toEqual({ add_dismissed_vendor_keys: ["outflow:avant"] });
  });

  it("still a bill / it ended / keep separate", () => {
    const still = item({ kind: "still_a_bill", subject_key: "rec1", record_id: "rec1" });
    const a = plan_review_answer(still, "still_a_bill", NOW);
    expect(a.ok && a.plan.record_action).toBe("ack_still_a_bill");
    const b = plan_review_answer(still, "it_ended", NOW);
    expect(b.ok && b.plan.record_action).toBe("end");
    const same = item({ kind: "same_bill", subject_key: "new_stream", record_id: "old" });
    const c = plan_review_answer(same, "keep_separate", NOW);
    expect(c.ok && [c.plan.state_change.add_pending_tracks?.map((p) => p.item_id), c.plan.resync_item_doc_id])
      .toEqual([[same.id], "item1"]);
  });

  it("Phase 2 answers and wrong answers are refused", () => {
    expect(plan_review_answer(item({ source: "detector" }), "track", NOW).ok).toBe(false);
    expect(plan_review_answer(item({ kind: "same_bill", subject_key: "x" }), "same_bill", NOW).ok).toBe(false);
    expect(plan_review_answer(item(), "it_ended", NOW).ok).toBe(false);
    expect(plan_review_answer(item({ source: "detector" }), "not_bill", NOW).ok).toBe(true);
  });

  it("idempotent: the same answer again is a no-op; a different one is refused (R12)", () => {
    const r = plan_review_answer(item(), "not_bill", NOW);
    const answered = r.ok ? r.plan.item! : item();
    expect(plan_review_answer(answered, "not_bill", NOW + 1)).toEqual({
      ok: true, plan: { no_op: true, item: null, state_change: {}, record_action: null, resync_item_doc_id: null },
    });
    expect(plan_review_answer(answered, "track", NOW + 1).ok).toBe(false);
  });
});
