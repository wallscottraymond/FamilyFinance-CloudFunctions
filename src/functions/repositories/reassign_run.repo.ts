/**
 * Re-assign runs (Transaction-Integrity-Review 3-R) — the bounded per-user re-assign engine's
 * progress + report, and its kill switch.
 *
 *   `_reassign_runs/{run_id}`  one run: scope, cursor, counters, merged follow-ups, dry-run report
 *   `_config/reassign`         `{ enabled: false }` stops every run at its next page (kill switch)
 *
 * Server-only collections (deny-all in Firestore rules — 3-S).
 *
 * @module repositories/reassign_run
 */

import { getFirestore, Timestamp } from "firebase-admin/firestore";
import type { SyncFollowUps } from "../orchestrators/plaid/sync_follow_ups";

const RUNS = "_reassign_runs";

export type ReassignReason =
  | "backfill" // the one-time repair (3-0b + re-assign everything)
  | "category_collection" // a Plaid code moved to another first (O1)
  | "budget_categories" // a budget's categories changed (A3b)
  | "view_change" // an account's view changed (share / unshare / leave / restore — H6)
  | "manual";

export interface ReassignScope {
  /** Only these accounts' transactions (view changes). Omitted = every account. */
  account_ids?: string[];
  /** Only transactions on / after this date. */
  from_ms?: number;
  /** Only transactions on / before this date. */
  to_ms?: number;
}

export interface ReassignSample {
  transaction_id: string;
  merchant: string | null;
  date: string;
  before: string;
  after: string;
}

export interface ReassignRun {
  run_id: string;
  user_id: string;
  reason: ReassignReason;
  dry_run: boolean;
  scope: ReassignScope;
  status: "running" | "done" | "capped" | "stopped" | "failed";
  /** Resume point: the last processed (date, doc id). */
  cursor: { date_ms: number; doc_id: string } | null;
  scanned: number;
  /** Transactions written (or, in a dry run, that WOULD be written). */
  changed: number;
  /** Old overrides carried into user picks (3-0b). */
  picks_carried: number;
  /** Budget moves by `before→after` budget id (dry-run report + audit trail). */
  moves: Record<string, number>;
  samples: ReassignSample[];
  follow_ups: SyncFollowUps | null;
  max_txns: number;
  /** Single-flight key (user + scope + dry-run): only one RUNNING run per key. */
  dedup_key: string;
  /** All pages walked; only the follow-up pass is left (it may get its own job). */
  walk_done: boolean;
  invocations: number;
  /** Invocations that threw (the run is "failed" after a few). */
  failures?: number;
  last_error?: string;
  started_at: Timestamp;
  updated_at: Timestamp;
}

export const reassign_run_repo = {
  async get(run_id: string): Promise<ReassignRun | null> {
    const snap = await getFirestore().collection(RUNS).doc(run_id).get();
    return snap.exists ? (snap.data() as ReassignRun) : null;
  },

  async save(run: ReassignRun): Promise<void> {
    await getFirestore()
      .collection(RUNS)
      .doc(run.run_id)
      .set({ ...run, updated_at: Timestamp.now() });
  },

  /**
   * Is another run with this key RUNNING right now? A run that hasn't saved progress for
   * `stale_ms` is dead (its job crashed past retries) and doesn't block.
   */
  async has_running(dedup_key: string, except_run_id: string, stale_ms: number): Promise<boolean> {
    const snap = await getFirestore()
      .collection(RUNS)
      .where("dedup_key", "==", dedup_key)
      .where("status", "==", "running")
      .limit(5)
      .get();
    const fresh_after = Date.now() - stale_ms;
    return snap.docs.some(
      (d) =>
        d.id !== except_run_id &&
        ((d.get("updated_at") as Timestamp | undefined)?.toMillis() ?? 0) > fresh_after
    );
  },

  /** Is any REAL (not dry-run) run of this user RUNNING right now (fresh, not `except_run_id`)? */
  async has_running_real_for_user(
    user_id: string,
    except_run_id: string,
    stale_ms: number
  ): Promise<boolean> {
    const snap = await getFirestore()
      .collection(RUNS)
      .where("user_id", "==", user_id)
      .where("status", "==", "running")
      .limit(10)
      .get();
    const fresh_after = Date.now() - stale_ms;
    return snap.docs.some(
      (d) =>
        d.id !== except_run_id &&
        d.get("dry_run") !== true &&
        ((d.get("updated_at") as Timestamp | undefined)?.toMillis() ?? 0) > fresh_after
    );
  },

  /**
   * Claim the ONE pending category fan-out (atomic): true for the first caller in a burst of
   * category edits, false while one is already pending. Released by the fan-out job when it runs.
   */
  async claim_category_fanout(): Promise<boolean> {
    const ref = getFirestore().collection("_config").doc("category_reassign");
    return getFirestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      // A claim whose job never ran (30 min) is dead — never let it block category re-assigns.
      const claimed_ms = (snap.get("claimed_at") as Timestamp | undefined)?.toMillis() ?? 0;
      if (snap.exists && snap.get("pending") === true && Date.now() - claimed_ms < 30 * 60_000) {
        return false;
      }
      tx.set(ref, { pending: true, claimed_at: Timestamp.now() }, { merge: true });
      return true;
    });
  },

  async release_category_fanout(): Promise<void> {
    await getFirestore()
      .collection("_config")
      .doc("category_reassign")
      .set({ pending: false, released_at: Timestamp.now() }, { merge: true });
  },

  /** Kill switch: false only when `_config/reassign.enabled === false`. One read per page. */
  async is_enabled(): Promise<boolean> {
    const snap = await getFirestore().collection("_config").doc("reassign").get();
    return !(snap.exists && snap.data()?.enabled === false);
  },
};
