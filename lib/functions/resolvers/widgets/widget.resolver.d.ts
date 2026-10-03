/**
 * Widget Resolver ([[iOS-Home-Screen-Widgets]] Phase 2) — READ-ONLY lookups for the widget
 * endpoint and token callable.
 *
 * @module resolvers/widgets/widget
 */
import { TraceContext } from "../../types";
import { StoredWidgetToken } from "../../repositories/widget_token.repo";
import { SourcePeriodEntity } from "../../repositories/source_period.repo";
/** Owner of a widget token hash (null = unknown/revoked) + their current data version. */
export declare function resolve_widget_request(token_hash: string): Promise<{
    user_id: string;
    data_version: number;
} | null>;
/**
 * The `cadence` source periods from the one containing `now_ms` onward, soonest first
 * (`count` of them: 1 = current; 2 = current + next, for "bills due soon").
 */
export declare function resolve_source_periods_from_now(ctx: TraceContext, cadence: string, now_ms: number, count: number): Promise<SourcePeriodEntity[]>;
/** The account's stored widget token (encrypted), or null. */
export declare function resolve_stored_widget_token(user_id: string): Promise<StoredWidgetToken | null>;
//# sourceMappingURL=widget.resolver.d.ts.map