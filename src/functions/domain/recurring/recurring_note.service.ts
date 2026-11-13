/**
 * Shared bill / income detail + notes (Account-Rooted-Sharing; Budget-And-Bill-Detail-Pages,
 * 2026-11-13). PURE.
 *
 * - `pick_definition_fields`: the definition fields the detail screens show, and nothing else
 *   (a group member sees what the owner's detail page shows, not the whole doc).
 * - `to_client`: Firestore Timestamps → `{ __ts: ms }` so the app can rebuild them.
 * - `normalize_note`: trimmed, at most NOTE_MAX characters ("" = clear).
 * - `period_belongs_to`: a period is only reachable through its own bill / income.
 *
 * @module domain/recurring/recurring_note
 */

/* eslint-disable @typescript-eslint/naming-convention -- Firestore field names + `__ts` tag */
import { DomainResult } from "../../types";

export type RecurringNoteKind = "outflow" | "inflow";

export const NOTE_MAX = 2000;

/** What Bill detail / Income detail read from the definition. */
const DEFINITION_FIELDS: Record<RecurringNoteKind, string[]> = {
  outflow: [
    "description", "merchantName", "expenseType", "frequency", "userCustomName",
    "expectedAmountOverride", "averageAmount",
    "internalDetailedCategory", "plaidDetailedCategory",
  ],
  inflow: [
    "description", "payerName", "frequency", "userCustomName",
    "expectedAmountOverride", "averageAmount", "incomeType",
    "hourlyConfig", "commissionConfig", "bonusConfig", "variableConfig",
    "incomeParts", "forecastSettings", "occurrenceParts", "incomeNote", "asItComes",
  ],
};

const LINK_FIELD: Record<RecurringNoteKind, string> = { outflow: "outflowId", inflow: "inflowId" };

export function pick_definition_fields(
  kind: RecurringNoteKind,
  raw: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of DEFINITION_FIELDS[kind]) if (raw[f] !== undefined) out[f] = raw[f];
  return out;
}

/** The bill / income a period belongs to (null when it has none). */
export function period_recurring_id(
  kind: RecurringNoteKind,
  period: Record<string, unknown>
): string | null {
  const v = period[LINK_FIELD[kind]];
  return typeof v === "string" && v ? v : null;
}

export function period_belongs_to(
  kind: RecurringNoteKind,
  period: Record<string, unknown>,
  recurring_id: string
): boolean {
  return period_recurring_id(kind, period) === recurring_id;
}

function is_timestamp(v: unknown): v is { toMillis: () => number } {
  return !!v && typeof v === "object" &&
    typeof (v as { toMillis?: unknown }).toMillis === "function";
}

/** Deep copy with every Timestamp as `{ __ts: ms }` (the callable wire can't carry them). */
export function to_client(value: unknown): unknown {
  if (is_timestamp(value)) return { __ts: value.toMillis() };
  if (Array.isArray(value)) return value.map(to_client);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = to_client(v);
    return out;
  }
  return value;
}

export function normalize_note(text: string): DomainResult<string> {
  const note = text.trim();
  if (note.length > NOTE_MAX) {
    return { validation_errors: [`A note can be up to ${NOTE_MAX} characters`] };
  }
  return { entity: note };
}
