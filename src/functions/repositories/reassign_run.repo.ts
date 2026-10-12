/**
 * Re-assign runs (Transaction-Integrity-Review 3-R) — the bounded per-user re-assign engine's
 * progress + report, and its kill switch.
 *
 *   `_reassign_runs/{run_id}`  one run: scope, cursor, counters, merged follow-ups, dry-run report
 *   `_reassign_locks/{slot}`   `{ run_id, heartbeat }` — atomic single-flight (one real run per
 *                              user; one dry run per key); a stale heartbeat frees it
 *   `_config/reassign`         `{ enabled: false }` stops every run at its next page (kill switch)
 *
 * Server-only collections (deny-all in Firestore rules — 3-S).
 *
 * @module repositories/reassign_run
 */

import { createHash } from "crypto";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import type { SyncFollowUps } from "../orchestrators/plaid/sync_follow_ups";

const RUNS = "_reassign_runs";
/** One doc per run slot: `{ run_id, heartbeat }` — the atomic single-flight lock. */
const LOCKS = "_reassign_locks";

const is_fresh = (snap: FirebaseFirestore.DocumentSnapshot, stale_ms: number): boolean =>
  Date.now() - ((snap.get("heartbeat") as Timestamp | undefined)?.toMillis() ?? 0) < stale_ms;

/**
 * The slot a run holds while it runs. Real runs: ONE per user, whatever the scope (a run uses the
 * budgets / categories it loaded when its invocation began, so two real runs in parallel could
 * overwrite each other with an older view). Dry runs (write nothing): one per key.
 */
export function reassign_slot_id(user_id: string, dedup_key: string, dry_run: boolean): string {
  return dry_run
    ? `dry_${createHash("sha1").update(dedup_key).digest("hex")}`
    : `user_${user_id}`;
}

export type ReassignReason =
  | "backfill" // the one-time repair (3-0b + re-assign everything)
  | "category_collection" // a Plaid code moved to another first (O1)
  | "budget_categories" // a budget's categories changed (A3b)
  | "view_change" // an account's view changed (share / unshare / leave / restore — H6)
  | "recurring_removal" // a bill / income was removed, paused, restored or deleted (X9)
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
  /** Invocations that threw or timed out (the run is "failed" after a few). */
  failures?: number;
  /** Set when an invocation starts, cleared when it ends (normally or by an error); still set at
   *  the next start = the previous invocation was killed (timeout) → counted as a failure. */
  invocation_open?: boolean;
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
   * Claim (or keep) a run SLOT — atomic single-flight. One slot per user for real runs, one per
   * key for dry runs (`reassign_slot_id`). Succeeds when the slot is free, held by this run, or
   * its holder hasn't heartbeat for `stale_ms` (crashed / timed out); then (re)stamps the
   * heartbeat. Called at the start of every invocation and after every page.
   */
  async claim_slot(slot_id: string, run_id: string, stale_ms: number): Promise<boolean> {
    const ref = getFirestore().collection(LOCKS).doc(slot_id);
    return getFirestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists && snap.get("run_id") !== run_id && is_fresh(snap, stale_ms)) return false;
      tx.set(ref, { run_id, heartbeat: Timestamp.now() });
      return true;
    });
  },

  /** Is the slot held by another run with a fresh heartbeat? (Read-only: the enqueue's delay.) */
  async slot_busy(slot_id: string, except_run_id: string, stale_ms: number): Promise<boolean> {
    const snap = await getFirestore().collection(LOCKS).doc(slot_id).get();
    return snap.exists && snap.get("run_id") !== except_run_id && is_fresh(snap, stale_ms);
  },

  /** Free the slot if this run holds it (the run ended: done / capped / stopped / failed). */
  async release_slot(slot_id: string, run_id: string): Promise<void> {
    const ref = getFirestore().collection(LOCKS).doc(slot_id);
    await getFirestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists && snap.get("run_id") === run_id) tx.delete(ref);
    });
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
