/**
 * The source periods a recurring record's periods are generated in.
 *
 * Normally: the periods that START in [start, end]. A record made in the app (`source: "manual"`,
 * from a convert or Add Bill) starts on a payment's date, i.e. mid-period, so the periods that
 * CONTAIN its first date are taken too. Without them the first payment's month / week / half-month
 * had no period doc, and its bill tile opened "Bill not found". Plaid records keep the old window
 * (byte-identical), and an explicit start is never widened.
 *
 * @module resolvers/periods/generation_source_periods
 */
import { TraceContext } from "../../types";
import { SourcePeriodEntity } from "../../repositories";
export declare function get_generation_source_periods(ctx: TraceContext, start: Date, end: Date, opts: {
    source: string;
    explicit_start: boolean;
}): Promise<SourcePeriodEntity[]>;
//# sourceMappingURL=generation_source_periods.resolver.d.ts.map