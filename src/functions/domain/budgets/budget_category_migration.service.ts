/**
 * Budget category migration (canon A2, Transaction-Integrity-Review 3c) — PURE.
 *
 * Every budget's `categoryIds` becomes `firstCategoryId` slugs:
 *   - Everything Else → [] (it stores no list — it's the structural fallback);
 *   - a slug stays;
 *   - Plaid detailed codes that cover ALL of a first's codes → that first's slug;
 *   - codes covering only PART of a first → FLAGGED and left as they are (A2: flagged, never
 *     silently widened to the whole first) — the user fixes it in Edit categories;
 *   - an overall slug or an unknown id → flagged, left as is.
 * A real budget whose result is empty is flagged (canon A3b) and not changed.
 */

import { CategoryCatalog } from "../transactions/split_category.service";

export interface BudgetForMigration {
  id: string;
  owner_key: string;
  name: string;
  category_ids: string[];
  is_everything_else: boolean;
}

export interface BudgetMigrationChange {
  budget_id: string;
  owner_key: string;
  name: string;
  before: string[];
  after: string[];
}

export interface BudgetMigrationFlag {
  budget_id: string;
  owner_key: string;
  name: string;
  reason: "partial_first" | "overall_slug" | "unknown_id" | "no_categories";
  ids: string[];
}

export function plan_budget_category_migration(
  budgets: BudgetForMigration[],
  catalog: CategoryCatalog
): { changes: BudgetMigrationChange[]; flags: BudgetMigrationFlag[] } {
  // first slug → every Plaid code under it
  const codes_by_first = new Map<string, Set<string>>();
  for (const [code, slugs] of Object.entries(catalog.slugs_by_plaid)) {
    if (!slugs.first_category_id) continue;
    const set = codes_by_first.get(slugs.first_category_id) ?? new Set<string>();
    set.add(code);
    codes_by_first.set(slugs.first_category_id, set);
  }
  const overalls = new Set(
    Object.values(catalog.slugs_by_plaid)
      .map((s) => s.overall_category_id)
      .filter((x): x is string => !!x)
  );

  const changes: BudgetMigrationChange[] = [];
  const flags: BudgetMigrationFlag[] = [];
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

  for (const b of budgets) {
    const before = b.category_ids ?? [];
    if (b.is_everything_else) {
      if (before.length) changes.push({ ...ids_of(b), before, after: [] });
      continue;
    }
    const after: string[] = [];
    const add = (id: string) => { if (!after.includes(id)) after.push(id); };
    const codes_by_its_first = new Map<string, string[]>();
    for (const id of before) {
      if (id in catalog.plaid_by_first) {
        add(id);
      } else if (catalog.slugs_by_plaid[id]?.first_category_id) {
        const f = catalog.slugs_by_plaid[id].first_category_id as string;
        codes_by_its_first.set(f, [...(codes_by_its_first.get(f) ?? []), id]);
      } else if (overalls.has(id)) {
        flags.push({ ...ids_of(b), reason: "overall_slug", ids: [id] });
        add(id);
      } else {
        flags.push({ ...ids_of(b), reason: "unknown_id", ids: [id] });
        add(id);
      }
    }
    for (const [first, codes] of codes_by_its_first) {
      const all = codes_by_first.get(first) ?? new Set<string>();
      if (after.includes(first) || [...all].every((c) => codes.includes(c))) {
        add(first);
      } else {
        flags.push({ ...ids_of(b), reason: "partial_first", ids: codes });
        codes.forEach(add);
      }
    }
    if (after.length === 0) {
      flags.push({ ...ids_of(b), reason: "no_categories", ids: [] });
      continue;
    }
    if (!same(before, after)) changes.push({ ...ids_of(b), before, after });
  }
  return { changes, flags };
}

function ids_of(b: BudgetForMigration) {
  return { budget_id: b.id, owner_key: b.owner_key, name: b.name };
}
