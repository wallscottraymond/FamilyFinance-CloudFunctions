/**
 * Requests (D25, D26)
 *
 * Every offer (v1: "join this group") reaches the other person as a request they
 * accept or decline. Requests expire after 7 days. A sender can send to at most
 * 5 different people per rolling 24 hours, so nobody can mass-spam offers.
 *
 * PURE: ids and time are passed in.
 *
 * @module domain/sharing/request
 */
import { PersonReport, SharingRequest } from "../../types/sharing.types";
import { DomainResult } from "../../types";
export declare const REQUEST_TTL_MS: number;
export declare const DAILY_RECIPIENT_LIMIT = 5;
export declare const DAY_MS: number;
export declare const MAX_REPORT_REASON_LENGTH = 500;
/**
 * Checks the 5-people-a-day limit. `recent` = requests this sender created in the
 * last 24h. A person already sent to today doesn't count again.
 */
export declare function check_daily_recipient_limit(recent: Pick<SharingRequest, "to_user_id" | "created_at_ms">[], new_recipients: string[], now_ms: number): string[];
/** A pending join request. */
export declare function build_join_request(id: string, from_user_id: string, to_user_id: string, group_id: string, now_ms: number): SharingRequest;
/** True while a request can still be answered. */
export declare function is_open(request: SharingRequest, now_ms: number): boolean;
/**
 * Validates that the caller may answer this request and returns it with the
 * answer applied. Group-side checks (limits, membership) happen separately.
 */
export declare function answer_request(request: SharingRequest | null, caller_id: string, accept: boolean, now_ms: number): DomainResult<SharingRequest>;
/** Marks requests cancelled (e.g. the group was deleted, or the pair got blocked). */
export declare function cancel_requests(requests: SharingRequest[], now_ms: number): SharingRequest[];
/** A report of another person (D27). */
export declare function build_report(id: string, reporter_id: string, reported_id: string, reason: string, now_ms: number): DomainResult<PersonReport>;
//# sourceMappingURL=request.service.d.ts.map