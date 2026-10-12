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
  status: "running" | "done" | "capped" | "stopped";
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
  invocations: number;
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

  /** Kill switch: false only when `_config/reassign.enabled === false`. One read per page. */
  async is_enabled(): Promise<boolean> {
    const snap = await getFirestore().collection("_config").doc("reassign").get();
    return !(snap.exists && snap.data()?.enabled === false);
  },
};
