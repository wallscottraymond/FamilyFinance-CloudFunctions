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
import { DomainResult } from "../../types";
export type RecurringNoteKind = "outflow" | "inflow";
export declare const NOTE_MAX = 2000;
export declare function pick_definition_fields(kind: RecurringNoteKind, raw: Record<string, unknown>): Record<string, unknown>;
/** The bill / income a period belongs to (null when it has none). */
export declare function period_recurring_id(kind: RecurringNoteKind, period: Record<string, unknown>): string | null;
export declare function period_belongs_to(kind: RecurringNoteKind, period: Record<string, unknown>, recurring_id: string): boolean;
/** Deep copy with every Timestamp as `{ __ts: ms }` (the callable wire can't carry them). */
export declare function to_client(value: unknown): unknown;
export declare function normalize_note(text: string): DomainResult<string>;
//# sourceMappingURL=recurring_note.service.d.ts.map