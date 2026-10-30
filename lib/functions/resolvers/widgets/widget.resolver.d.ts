/**
 * Widget Resolver ([[iOS-Home-Screen-Widgets]] Phase 2) — READ-ONLY lookups for the widget
 * endpoint and token callable.
 *
 * @module resolvers/widgets/widget
 */
import { TraceContext } from "../../types";
import { StoredWidgetToken } from "../../repositories/widget_token.repo";
import { SourcePeriodEntity } from "../../repositories/source_period.repo";
import { DeriveScopeRequest } from "../../domain/periods/derive_scope.service";
/** Owner of a widget token hash (null = unknown/revoked). The view version is resolved by the
 *  caller (`resolve_view_version`), which knows whether this is a Me or a group widget. */
export declare function resolve_widget_request(token_hash: string): Promise<{
    user_id: string;
} | null>;
/**
 * The `cadence` source periods from the one containing `now_ms` onward, soonest first
 * (`count` of them: 1 = current; 2 = current + next, for "bills due soon").
 */
export declare function resolve_source_periods_from_now(ctx: TraceContext, cadence: string, now_ms: number, count: number): Promise<SourcePeriodEntity[]>;
/**
 * The view's newest transactions, newest first. Raw docs; which rows show is the domain's call
 * (`select_recent_transactions`). READ-ONLY.
 * - Me: every transaction on your own accounts, shared into a group or not: the app's Home
 *   "Recent transactions" card (ownerId only). NOT the period page's Me view, which leaves shared
 *   accounts to the group: with most accounts shared, that left Me nearly empty.
 * - A group: each member's latest RECENT_READ_LIMIT, kept when on the group's shared accounts
 *   (`transaction_in_scope`).
 */
export declare function resolve_recent_view_transactions(ctx: TraceContext, user_id: string, scope_request: DeriveScopeRequest | undefined): Promise<Array<{
    id: string;
    data: Record<string, unknown>;
}>>;
/** The bills (outflows) the shown rows paid, by id (names): ONE batched read. READ-ONLY. */
export declare function resolve_bill_names(ctx: TraceContext, outflow_ids: string[]): Promise<Map<string, Record<string, unknown>>>;
/** The account's stored widget token (encrypted), or null. */
export declare function resolve_stored_widget_token(user_id: string): Promise<StoredWidgetToken | null>;
//# sourceMappingURL=widget.resolver.d.ts.map