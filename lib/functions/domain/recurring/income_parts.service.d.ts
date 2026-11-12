/**
 * Income Parts Domain Service (Income-Detail-Screen, Phase 1)
 *
 * A paycheck is a list of PARTS (base, commission, reimbursement, ...). This module is the one
 * rule for what each part of a check is:
 *   - which parts apply to a check (schedule: every / end_of_month / months),
 *   - a part's history from the deposits received (labelled split, else the default split),
 *   - a part's plan amount (set / avg / typical / careful / none),
 *   - per-check overrides and one-off extras (`occurrence_parts`),
 *   - the breakdown of a RECEIVED check (the bank total is fixed; the parts add up to it).
 *
 * PURE: no IO, no clock. History is "the last 12 months" relative to a reference date derived
 * from the data (the check's own date, capped at the newest deposit), never `Date.now()`.
 *
 * @module domain/recurring/income_parts
 */
import type { DepositForSlot } from "./income_slot_amounts";
export type PartSchedule = "every" | "end_of_month" | "months";
export type PartPlan = "set" | "avg" | "typical" | "careful" | "none";
export interface IncomePart {
    id: string;
    kind: string;
    label?: string;
    schedule: PartSchedule;
    /** 1-12; only for schedule "months". */
    months?: number[];
    plan: PartPlan;
    /** Per check, for plan "set". */
    amount?: number;
    /** At most one part takes whatever the deposit has left after the others. */
    takes_rest?: boolean;
}
export interface ForecastSettings {
    careful_months: 3 | 6 | 12;
    careful_rule: "lowest" | "low_end";
}
export declare const DEFAULT_FORECAST_SETTINGS: ForecastSettings;
/** One entry of a check's `occurrence_parts`. With `part_id`: that part's amount on this check.
 *  Without: a one-off extra part. */
export interface OccurrencePart {
    part_id?: string;
    kind: string;
    label?: string;
    amount: number;
}
export type OccurrencePartsMap = Record<string, OccurrencePart[]>;
/** A part of one check, as the client reads it. */
export interface CheckPart {
    part_id?: string;
    kind: string;
    label?: string;
    amount: number;
    sure: boolean;
}
export interface PartStat {
    part_id: string;
    avg: number;
    typical: number;
    careful: number;
}
export declare const MAX_INCOME_PARTS = 8;
/** `occurrence_parts` keys older than this are dropped when carried (months). */
export declare const OCCURRENCE_PARTS_KEEP_MONTHS = 24;
/** Parse `incomeParts`: malformed entries are dropped; max 8; at most one `takesRest`. */
export declare function parse_income_parts(raw: unknown): IncomePart[];
/** Parse `forecastSettings`; anything unusable falls back to the default (6 months, lowest). */
export declare function parse_forecast_settings(raw: unknown): ForecastSettings;
/** Parse `occurrenceParts` (keys must be `YYYY-MM-DD`; malformed entries are dropped). */
export declare function parse_occurrence_parts(raw: unknown): OccurrencePartsMap;
/** True for a raw `occurrenceParts` key older than `keep_months` before `now_ms` (UTC). */
export declare function is_stale_occurrence_parts_key(key: string, now_ms: number, keep_months?: number): boolean;
/** `ms` minus `n` calendar months (UTC), day clamped to the month's length. */
export declare function months_before(ms: number, n: number): number;
/** Builds "is this date the LAST check of its UTC month?" over the known check dates. */
export declare function make_is_last_of_month(dates_ms: number[]): (ms: number) => boolean;
/** Whether `part` applies to a check on `ms`. */
export declare function part_applies(part: IncomePart, ms: number, is_last_of_month: boolean): boolean;
/** The breakdown of a RECEIVED check (every part "sure": the deposit is a fact). */
export declare function received_check_parts(input: {
    parts: IncomePart[];
    occurrence_parts?: OccurrencePartsMap;
    amount: number;
    date_ms: number;
    is_last_of_month: boolean;
}): CheckPart[];
export interface PartsInputs {
    parts: IncomePart[];
    settings?: ForecastSettings;
    /** The stream's received deposits (history). */
    deposits: DepositForSlot[];
    occurrence_parts?: OccurrencePartsMap;
    /**
     * The schedule's check dates in [from, to]. Lets history tell a mid-month deposit from the
     * month's last check when the last check hasn't arrived (yet, or at all).
     */
    check_dates?: (from_ms: number, to_ms: number) => number[];
}
/**
 * "Was this deposit the month's last check?" for history: it's the month's last deposit AND no
 * scheduled check falls later that month (beyond the slack). Without this, the mid-month base
 * check counts as "last" while the month-end check is still to come (or missing), and the
 * end-of-month part (commission) gets a ~$0 history point.
 */
export declare function make_history_is_last(deposit_dates_ms: number[], scheduled_dates_ms: number[]): (ms: number) => boolean;
/** Avg / typical / careful dollar amount for every part (so the plan screen can show each choice). */
export declare function compute_part_stats(inp: PartsInputs): PartStat[];
/**
 * Builds a calculator for the EXPECTED parts of an outstanding check on `due_ms`. Stats are
 * memoised per reference date. A part override (`occurrence_parts` entry with the part's id)
 * replaces its planned amount (and is "sure"); entries without an id are one-off extras (sure).
 */
export declare function make_expected_parts_calculator(inp: PartsInputs, is_last_of_month: (ms: number) => boolean): (due_ms: number) => CheckPart[];
/** Sum of a check's part amounts. */
export declare function sum_parts(parts: CheckPart[]): number;
/** Sum of the parts you can count on. */
export declare function sum_sure_parts(parts: CheckPart[]): number;
//# sourceMappingURL=income_parts.service.d.ts.map