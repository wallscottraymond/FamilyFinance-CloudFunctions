/**
 * Who may open, and note, a bill (outflow) or income (inflow) — Account-Rooted-Sharing.
 *
 * A recurring item follows its account: the owner always may; anyone else only when the item's
 * account is shared with a group the caller is a member of AND the owner is still a member (the
 * same rule the group period view uses, `resolve_derive_scope`). The group doc is the membership
 * truth. READ-ONLY.
 *
 * @module resolvers/recurring/recurring_access
 */
import { TraceContext } from "../../types";
import { RecurringNoteKind } from "../../domain/recurring/recurring_note.service";
export interface RecurringAccess {
    owner_id: string;
    /** The group the item is shared through, when the caller isn't the owner. */
    via_group_id: string | null;
}
export declare function resolve_recurring_access(ctx: TraceContext, caller_id: string, kind: RecurringNoteKind, recurring_id: string): Promise<RecurringAccess>;
/** What `get_recurring_detail` needs: the period, its bill / income, and the caller's access. */
export interface RecurringDetailDeps {
    period: Record<string, unknown>;
    recurring_id: string;
    definition: Record<string, unknown>;
    access: RecurringAccess;
}
export declare function resolve_recurring_detail_deps(ctx: TraceContext, caller_id: string, kind: RecurringNoteKind, period_id: string): Promise<RecurringDetailDeps>;
/** What `set_recurring_note` needs: access, plus the period when the note is on one. */
export declare function resolve_recurring_note_deps(ctx: TraceContext, caller_id: string, kind: RecurringNoteKind, recurring_id: string, period_id: string | null): Promise<{
    access: RecurringAccess;
    period: Record<string, unknown> | null;
}>;
//# sourceMappingURL=recurring_access.resolver.d.ts.map