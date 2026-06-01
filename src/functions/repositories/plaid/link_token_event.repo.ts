/**
 * Link Token Event Repository
 *
 * Handles persistence for link token creation events.
 * Used for audit logging and token caching.
 *
 * @module repositories/plaid/link_token_event
 */

import { getFirestore, Timestamp, FieldValue } from "firebase-admin/firestore";
import {
  TraceContext,
  LinkTokenEvent,
  LinkTokenEventInput,
  GetValidTokenOptions,
} from "../../types";

/**
 * Firestore collection name.
 */
const COLLECTION = "link_token_events";

/**
 * Gets the Firestore instance.
 */
function get_db() {
  return getFirestore();
}

/**
 * Link Token Event Repository
 *
 * Provides methods for:
 * - Logging link token creation events (audit trail)
 * - Retrieving valid cached tokens (caching)
 */
export const link_token_event_repo = {
  /**
   * Logs a link token creation event.
   *
   * Used for:
   * - Audit trail (who created tokens, when)
   * - Token caching (store token for later retrieval)
   *
   * @param event - Event data to log
   * @returns Promise that resolves when the event is logged
   */
  async log_creation(event: LinkTokenEventInput): Promise<void> {
    const db = get_db();
    const doc_ref = db.collection(COLLECTION).doc();

    await doc_ref.set({
      id: doc_ref.id,
      user_id: event.user_id,
      request_id: event.request_id,
      is_update_mode: event.is_update_mode,
      trace_id: event.trace_id,
      link_token: event.link_token,
      expiration: event.expiration,
      created_at: FieldValue.serverTimestamp(),
    });
  },

  /**
   * Retrieves a valid cached token for a user.
   *
   * A token is considered valid if:
   * - It belongs to the specified user
   * - It matches the update mode
   * - It was created within the max_age_hours
   *
   * @param ctx - Trace context for logging
   * @param user_id - User to get cached token for
   * @param is_update_mode - Whether to get update mode or normal mode token
   * @param options - Cache TTL options
   * @returns The cached event if found, null otherwise
   */
  async get_valid_token(
    ctx: TraceContext,
    user_id: string,
    is_update_mode: boolean,
    options: GetValidTokenOptions
  ): Promise<LinkTokenEvent | null> {
    const db = get_db();

    // Calculate cutoff time
    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - options.max_age_hours);

    try {
      // Query for valid cached token
      const snapshot = await db
        .collection(COLLECTION)
        .where("user_id", "==", user_id)
        .where("is_update_mode", "==", is_update_mode)
        .where("created_at", ">", Timestamp.fromDate(cutoff))
        .orderBy("created_at", "desc")
        .limit(1)
        .get();

      if (snapshot.empty) {
        return null;
      }

      const doc = snapshot.docs[0];
      const data = doc.data();

      return {
        id: data.id,
        user_id: data.user_id,
        request_id: data.request_id,
        is_update_mode: data.is_update_mode,
        trace_id: data.trace_id,
        link_token: data.link_token,
        expiration: data.expiration,
        created_at: data.created_at,
      };
    } catch (error) {
      // If cache query fails (e.g., missing index), continue without cache
      console.warn("[link_token_event_repo] Cache query failed, continuing without cache:", error);
      return null;
    }
  },

  /**
   * Gets all link token events for a user (for debugging/admin).
   *
   * @param ctx - Trace context for logging
   * @param user_id - User to get events for
   * @param limit - Maximum number of events to return
   * @returns Array of link token events
   */
  async get_by_user_id(
    ctx: TraceContext,
    user_id: string,
    limit: number = 10
  ): Promise<LinkTokenEvent[]> {
    const db = get_db();

    const snapshot = await db
      .collection(COLLECTION)
      .where("user_id", "==", user_id)
      .orderBy("created_at", "desc")
      .limit(limit)
      .get();

    return snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: data.id,
        user_id: data.user_id,
        request_id: data.request_id,
        is_update_mode: data.is_update_mode,
        trace_id: data.trace_id,
        link_token: data.link_token,
        expiration: data.expiration,
        created_at: data.created_at,
      };
    });
  },
};
