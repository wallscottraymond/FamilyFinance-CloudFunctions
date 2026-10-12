/**
 * Split edit — what a split edit from the app turns into, before it's written (PURE).
 *
 *   - Each incoming split is MERGED onto the stored split with the same id: the app re-sends the
 *     whole array, and an older build may leave fields out (spendStatus, tags, tax flag, a manual
 *     bill pin, per-lens budgets) — omission must never erase them.
 *   - Fields only the ENGINE sets (per-lens budgets + names + sources, source periods, auto bill /
 *     income links, the legacy budget alias) always come from the STORED split: the app echoes
 *     whatever it last read, which may be older than a re-assign that landed since. From the app
 *     we take only the user's intents — a new budget pin, and status / amount / tags / notes / tax
 *     flag (bill pins go through `assign_split_to_outflow`; a new budget pin takes the split off a
 *     manually pinned bill — canon A4). A new split takes the app's fields
 *     (the engine runs on it).
 *   - Category fields come from the one edit rule (split_category_edit: pick / "use auto" / an old
 *     build's bare categoryId; Plaid codes immutable; `internal*` null).
 *   - Totals + the refund / ignored summaries are recomputed from the final splits.
 *   - `assignment_relevant`: did anything the assignment engine decides on change (split set,
 *     category, amount, budget / bill pins)? A status / note edit doesn't — it only moves spend.
 *   - `category_changed`: a category moved (it can form or break a matched transfer pair).
 *
 * @module domain/transactions/split_edit
 */

import { CategoryCatalog } from "./split_category.service";
import { resolve_split_category_edit } from "./split_category_edit.service";

type Raw = Record<string, unknown>;

export interface SplitEditResult {
  splits: Raw[];
  totals: {
    isSplit: boolean;
    totalAllocated: number;
    returnAmount: number;
    hasRefundSplits: boolean;
    hasIgnoredSplits: boolean;
  };
  assignment_relevant: boolean;
  category_changed: boolean;
}

const id_of = (s: Raw): string => ((s.splitId as string) || (s.id as string) || "");

const category_key = (s: Raw) =>
  `${s.categorySource ?? ""}|${s.firstCategoryId ?? ""}|${s.secondCategoryId ?? ""}`;

/** What the engine decides on, per split (besides the transaction's own date / account). The
 *  amount is in it: the bill / income matcher scores on the split's amount. */
const assignment_key = (s: Raw) =>
  [
    category_key(s),
    Math.abs(Number(s.amount) || 0).toFixed(2),
    s.budgetAssignmentSource ?? "category",
    s.budgetAssignmentSource === "manual" ? s.budgetId ?? "" : "",
    s.outflowAssignmentSource ?? "auto",
    s.outflowAssignmentSource === "manual" ? s.outflowId ?? "" : "",
  ].join("#");

const status_of = (s: Raw): string =>
  (typeof s.spendStatus === "string" && s.spendStatus) ||
  (s.isIgnored === true ? "ignored" : s.isRefund === true ? "refund" : "counted");

/** The engine's per-split outputs — never taken from the app for an existing split. */
const ENGINE_FIELDS = [
  "monthlyBudgetId", "weeklyBudgetId", "biWeeklyBudgetId",
  "monthlyBudgetName", "weeklyBudgetName", "biWeeklyBudgetName",
  "monthlyBudgetSource", "weeklyBudgetSource", "biWeeklyBudgetSource",
  "monthlyPeriodId", "weeklyPeriodId", "biWeeklyPeriodId",
  "budgetName", "inflowId",
] as const;

/* eslint-disable @typescript-eslint/naming-convention */
/** Engine-owned fields from the stored split, except where the app states a user intent. */
function engine_owned_fields(split: Raw, before: Raw): Raw {
  const out: Raw = {};
  for (const f of ENGINE_FIELDS) out[f] = before[f] ?? null;

  // Budget: only a NEW manual pin (or a pin to a different budget) is the user's — the app sends
  // `budgetAssignmentSource: "manual"` + the budget when the user picks one. It never sends an
  // unpin, so anything else is an echo: keep the stored budget + source.
  const pin_now = split.budgetAssignmentSource === "manual";
  const pin_before = before.budgetAssignmentSource === "manual";
  if (pin_now && (!pin_before || split.budgetId !== before.budgetId)) {
    out.budgetId = split.budgetId;
    out.budgetAssignmentSource = "manual";
  } else {
    out.budgetId = before.budgetId ?? null;
    out.budgetAssignmentSource = before.budgetAssignmentSource ?? "category";
  }

  // Bill links: pinned / detached / cleared only through `assign_split_to_outflow`; a split edit
  // never sets them — except that a NEW budget pin takes the split off its bill (canon A4: a
  // budget pin detaches recurring; the app warns "will remove it from bill tracking"). A manual
  // bill pin would otherwise win over the budget pin's detach in the engine.
  const new_budget_pin = out.budgetAssignmentSource === "manual" && !(
    pin_before && before.budgetId === out.budgetId
  );
  if (new_budget_pin && before.outflowAssignmentSource === "manual") {
    out.outflowId = null;
    out.outflowAssignmentSource = "auto";
    out.outflowPinnedPeriodId = null;
  } else {
    out.outflowId = before.outflowId ?? null;
    out.outflowAssignmentSource = before.outflowAssignmentSource ?? "auto";
    out.outflowPinnedPeriodId = before.outflowPinnedPeriodId ?? null;
  }
  return out;
}

export function build_split_edit(
  incoming: Raw[],
  txn: Raw,
  catalog: CategoryCatalog,
  user_id: string,
  now: unknown,
  new_id: (index: number) => string
): SplitEditResult {
  const stored = new Map<string, Raw>();
  for (const s of (txn.splits as Raw[] | undefined) ?? []) {
    if (id_of(s)) stored.set(id_of(s), s);
  }

  const splits = incoming.map((split, index) => {
    const split_id = id_of(split) || new_id(index);
    const before = stored.get(split_id);
    const category = resolve_split_category_edit(split, before, txn, catalog);
    return {
      ...(before ?? {}),
      ...split,
      ...(before ? engine_owned_fields(split, before) : {}),
      splitId: split_id,
      id: split_id,
      ...category,
      createdAt: split.createdAt ?? before?.createdAt ?? now,
      updatedAt: now,
      createdBy: split.createdBy ?? before?.createdBy ?? user_id,
    } as Raw;
  });

  const amount = (s: Raw) => Math.abs(Number(s.amount) || 0);
  const totals = {
    isSplit: splits.length > 1,
    totalAllocated: splits.reduce((sum, s) => sum + amount(s), 0),
    returnAmount: splits.reduce((sum, s) => sum + (status_of(s) === "refund" ? amount(s) : 0), 0),
    hasRefundSplits: splits.some((s) => status_of(s) === "refund"),
    hasIgnoredSplits: splits.some((s) => status_of(s) === "ignored"),
  };

  const before_ids = [...stored.keys()].sort().join(",");
  const after_ids = splits.map(id_of).sort().join(",");
  const assignment_relevant =
    before_ids !== after_ids ||
    splits.some((s) => assignment_key(s) !== assignment_key(stored.get(id_of(s)) ?? {}));
  const category_changed = splits.some(
    (s) => category_key(s) !== category_key(stored.get(id_of(s)) ?? {})
  );
  return { splits, totals, assignment_relevant, category_changed };
}
/* eslint-enable @typescript-eslint/naming-convention */
