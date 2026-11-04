/**
 * A budget's checklist (Manual-Budgets, AF-02): what you plan to buy, with an estimate each. A tick
 * means bought; the budget's spent still comes from its transactions, so nothing here affects any
 * number. The total of the estimates only suggests a budget amount.
 *
 * `carry` is the user's choice per budget. On: the items and estimates carry, and each period has
 * its own ticks. Off: an item belongs to the period it was added in.
 *
 * PURE. @module domain/budgets/budget_checklist
 */

export const CHECKLIST_MAX_ITEMS = 100;
/** Older periods' ticks are dropped, so the map stays bounded. */
export const CHECKLIST_MAX_TICK_PERIODS = 24;

export interface ChecklistItem {
  id: string;
  name: string;
  estimate: number;
  /** The period it belongs to when not carrying; null when carrying. */
  period_key: string | null;
}

export interface BudgetChecklist {
  carry: boolean;
  items: ChecklistItem[];
  /** Period key → ticked item ids. Keys sort by date (YYYY-MM, or a period id). */
  ticks: Record<string, string[]>;
}

export const EMPTY_CHECKLIST: BudgetChecklist = { carry: true, items: [], ticks: {} };

/** One edit. Single edits, not the whole list, so two people's changes both survive. */
export type ChecklistOp =
  | { op: "add"; id: string; name: string; estimate: number; period_key: string }
  | { op: "remove"; id: string }
  | { op: "tick"; id: string; period_key: string; ticked: boolean }
  | { op: "carry"; carry: boolean; period_key: string };

/** Apply one edit to the stored list. An edit to an item someone else just removed does nothing. PURE. */
export function apply_checklist_op(
  current: BudgetChecklist,
  op: ChecklistOp
): { checklist?: BudgetChecklist; errors?: string[] } {
  switch (op.op) {
    case "add": {
      const name = op.name.trim();
      if (!name) return { errors: ["Give the item a name"] };
      if (current.items.some((i) => i.id === op.id)) return { checklist: current };
      if (current.items.length >= CHECKLIST_MAX_ITEMS) {
        return { errors: [`A checklist can hold up to ${CHECKLIST_MAX_ITEMS} items`] };
      }
      return {
        checklist: {
          ...current,
          items: [...current.items, {
            id: op.id,
            name,
            estimate: Math.round(op.estimate * 100) / 100,
            period_key: current.carry ? null : op.period_key,
          }],
        },
      };
    }
    case "remove": {
      const ticks: Record<string, string[]> = {};
      for (const [k, ids] of Object.entries(current.ticks)) {
        const kept = ids.filter((x) => x !== op.id);
        if (kept.length) ticks[k] = kept;
      }
      return { checklist: { ...current, items: current.items.filter((i) => i.id !== op.id), ticks } };
    }
    case "tick": {
      if (!current.items.some((i) => i.id === op.id)) return { checklist: current };
      const now = current.ticks[op.period_key] ?? [];
      const next = op.ticked ? [...new Set([...now, op.id])] : now.filter((x) => x !== op.id);
      const ticks = { ...current.ticks };
      if (next.length) ticks[op.period_key] = next;
      else delete ticks[op.period_key];
      // Older periods' ticks drop off, so the map stays bounded.
      const keep = Object.keys(ticks).sort().slice(-CHECKLIST_MAX_TICK_PERIODS);
      return { checklist: { ...current, ticks: Object.fromEntries(keep.map((k) => [k, ticks[k]])) } };
    }
    case "carry":
      return {
        checklist: {
          ...current,
          carry: op.carry,
          // Turning carrying off keeps the items in the period in view.
          items: current.items.map((i) => ({ ...i, period_key: op.carry ? null : i.period_key ?? op.period_key })),
        },
      };
  }
}
