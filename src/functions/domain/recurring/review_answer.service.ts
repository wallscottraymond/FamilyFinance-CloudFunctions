/**
 * Answering a "Bills to review" item (Convert-To-Recurring D9 / D14 / D15 / D24 / X4 / X8) — PURE.
 *
 * Phase 1 answers:
 *   suggested (Plaid)    → `track` (the next sync creates the v2 bill — with the schedule the user
 *                          picked when Plaid said UNKNOWN, D8) | `not_bill` (vendor remembered)
 *   suggested (detector) → `not_bill` only (tracking a detector suggestion is Phase 2: convert)
 *   still_a_bill         → `still_a_bill` (remembered on the record) | `it_ended` (going-forward end)
 *   same_bill            → `keep_separate` (the next sync creates the new stream's own bill);
 *                          `same_bill` (merge) is Phase 2
 *
 * Idempotent (R12): answering an item again with the SAME answer is a no-op; a different answer on
 * an answered item is refused. Answers that must survive the review item's TTL live on the record
 * (end interval / `plaidInactiveAckAt`) or in the review state ("Not a bill" vendors, held-out ids).
 *
 * @module domain/recurring/review_answer
 */

import {
  ReviewAnswer,
  ReviewItem,
  ReviewStateChange,
  resolve_review_item,
} from "./review_item.service";

export type UserAnswer = "track" | "not_bill" | "still_a_bill" | "it_ended" | "keep_separate" | "same_bill";

const FREQUENCIES = new Set(["weekly", "biweekly", "semimonthly", "monthly", "yearly"]);

export interface ReviewAnswerPlan {
  /** Already answered this way: nothing to write. */
  no_op: boolean;
  /** The item, closed with the answer (null when no_op). */
  item: ReviewItem | null;
  state_change: ReviewStateChange;
  /** What happens to the record the question is about. */
  record_action: "ack_still_a_bill" | "end" | null;
  /** Re-sync the item so the planner creates the bill now ("track" / "keep separate"). */
  resync_item_doc_id: string | null;
}

export type ReviewAnswerResult = { ok: true; plan: ReviewAnswerPlan } | { ok: false; error: string };

const ALLOWED: Record<string, UserAnswer[]> = {
  "suggested:plaid": ["track", "not_bill"],
  "suggested:detector": ["not_bill"],
  "still_a_bill:plaid": ["still_a_bill", "it_ended"],
  "same_bill:plaid": ["keep_separate"],
};

/** Plan an answer. PURE. */
export function plan_review_answer(
  item: ReviewItem,
  answer: UserAnswer,
  now_ms: number,
  opts: { frequency?: string | null } = {}
): ReviewAnswerResult {
  const allowed = ALLOWED[`${item.kind}:${item.source}`] ?? [];
  if (!allowed.includes(answer)) {
    const later =
      (item.kind === "suggested" && item.source === "detector" && answer === "track") ||
      (item.kind === "same_bill" && answer === "same_bill");
    return {
      ok: false,
      error: later
        ? "not available yet — this answer comes with Convert to recurring"
        : `"${answer}" isn't an answer to this question`,
    };
  }
  if (item.status !== "open") {
    if (item.answer === answer) {
      return {
        ok: true,
        plan: { no_op: true, item: null, state_change: {}, record_action: null, resync_item_doc_id: null },
      };
    }
    return { ok: false, error: "this question was already answered" };
  }

  let user_frequency: string | null = null;
  if (answer === "track") {
    const picked = opts.frequency ?? item.frequency;
    if (!picked || !FREQUENCIES.has(picked)) {
      return { ok: false, error: "pick a schedule for this bill" };
    }
    user_frequency = opts.frequency && FREQUENCIES.has(opts.frequency) ? opts.frequency : null;
  }

  const closed = resolve_review_item(item, answer as ReviewAnswer, now_ms, { user_frequency });
  const plan: ReviewAnswerPlan = {
    no_op: false,
    item: closed,
    state_change: {},
    record_action: null,
    resync_item_doc_id: null,
  };
  switch (answer) {
    case "track":
    case "keep_separate":
      // The item's payments stay held out of fuzzy matching until the bill actually EXISTS: the
      // capture planner releases them when it creates the v2 record (create_v2), not here — in
      // between, a merchant guess could still link them to an old bill.
      plan.resync_item_doc_id = item.plaid_item_doc_id;
      break;
    case "not_bill":
      // Remembered per user + vendor (D11 / D15); its payments stay normal transactions — still
      // held out of fuzzy bill matching.
      plan.state_change = { add_dismissed_vendor_keys: [item.subject_key] };
      break;
    case "still_a_bill":
      plan.record_action = "ack_still_a_bill";
      break;
    case "it_ended":
      plan.record_action = "end";
      break;
    default:
      break;
  }
  return { ok: true, plan };
}
