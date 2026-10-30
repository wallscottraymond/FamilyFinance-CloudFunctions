/**
 * Connection Repository (D24, D27)
 *
 * `connections/{pairId}` where pairId = the two uids sorted, joined by "__".
 * Functions-only. Queried by `userIds array-contains`.
 *
 * @module repositories/sharing/connection
 */
import { TraceContext } from "../../types";
import { Connection } from "../../types/sharing.types";
export declare const connection_repo: {
    get(_ctx: TraceContext, pair_id: string): Promise<Connection | null>;
    /** All of a user's connection docs (connected and blocked). Max ~10 + blocks. */
    get_for_user(_ctx: TraceContext, user_id: string): Promise<Connection[]>;
    /** Number of active (not blocked) connections for a user. */
    count_connected(_ctx: TraceContext, user_id: string): Promise<number>;
    save(_ctx: TraceContext, entity: Connection, now_ms: number): Promise<void>;
    /** Creates the connection unless the pair's doc already exists (two sides connecting at once). */
    create_if_absent(_ctx: TraceContext, entity: Connection, now_ms: number): Promise<void>;
    delete(_ctx: TraceContext, pair_id: string): Promise<void>;
};
//# sourceMappingURL=connection.repo.d.ts.map