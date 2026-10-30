/**
 * Request Repository (D25, D26)
 *
 * `requests/{id}`: offers waiting for the recipient's Accept. Functions-only.
 * `expireAt` is a TTL field (30 days after the request expires).
 *
 * Indexes: (toUserId, status), (fromUserId, createdAt), (groupId, status),
 * (targetId, status).
 *
 * @module repositories/sharing/request
 */
import { Transaction } from "firebase-admin/firestore";
import { TraceContext } from "../../types";
import { SharingRequest } from "../../types/sharing.types";
export declare const request_repo: {
    /** A new doc id (domain builds the entity with it). */
    new_id(): string;
    get(_ctx: TraceContext, id: string): Promise<SharingRequest | null>;
    /** Pending requests addressed to a user. */
    get_pending_for_recipient(_ctx: TraceContext, user_id: string): Promise<SharingRequest[]>;
    /** Requests a sender created since `since_ms` (for the daily limit). */
    get_sent_since(_ctx: TraceContext, user_id: string, since_ms: number): Promise<SharingRequest[]>;
    /** Pending requests for a group (to cancel them when the group goes away). */
    get_pending_for_group(_ctx: TraceContext, group_id: string): Promise<SharingRequest[]>;
    /** Pending requests about one account (share_account). */
    get_pending_for_target(_ctx: TraceContext, target_id: string): Promise<SharingRequest[]>;
    /** Writes requests in one batch. */
    save_many(_ctx: TraceContext, entities: SharingRequest[]): Promise<void>;
    /** Writes a request inside a caller's transaction. */
    set_in_transaction(tx: Transaction, entity: SharingRequest): void;
};
//# sourceMappingURL=request.repo.d.ts.map