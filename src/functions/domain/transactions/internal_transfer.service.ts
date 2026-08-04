/**
 * Internal-transfer detection (matched-pair).
 *
 * Plaid stamps `TRANSFER_OUT_ACCOUNT_TRANSFER` / `TRANSFER_IN_ACCOUNT_TRANSFER` on
 * BOTH money moving between the user's OWN accounts AND real external ACH payments
 * (mortgage, subscriptions). The category alone can't tell them apart — so we pair
 * them: a TRANSFER_OUT is INTERNAL only when it has a matching TRANSFER_IN of the
 * same amount on a DIFFERENT account within a few days (and vice-versa). Unpaired
 * transfers are EXTERNAL — real spending/bills — and must NOT be excluded.
 *
 * PURE: no IO. Greedy nearest-date pairing, each side consumed once.
 *
 * @module domain/transactions/internal_transfer
 */

export interface TransferForPairing {
  /** Stable id (transaction doc id). */
  id: string;
  /** Plaid transaction id — so callers can also match recurring-stream `transaction_ids`. */
  plaid_id: string | null;
  account_id: string;
  /** Absolute amount. */
  amount: number;
  date_ms: number;
  direction: "in" | "out";
}

export interface InternalTransferResult {
  /** Doc ids of transactions that are internal (own-account) transfers. */
  internal_ids: Set<string>;
  /** Plaid ids of the same (for matching recurring-stream `transaction_ids`). */
  internal_plaid_ids: Set<string>;
}

const DEFAULT_TOLERANCE_DAYS = 5;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const AMOUNT_EPSILON = 0.005;

/**
 * Given the transfer transactions, return the ids of the INTERNAL ones (those with
 * a matching opposite-direction transfer of the same amount on another account).
 */
export function detect_internal_transfers(
  transfers: TransferForPairing[],
  opts: { tolerance_days?: number } = {}
): InternalTransferResult {
  const tolerance_ms = (opts.tolerance_days ?? DEFAULT_TOLERANCE_DAYS) * MS_PER_DAY;
  const internal_ids = new Set<string>();
  const internal_plaid_ids = new Set<string>();

  const outs = transfers.filter((t) => t.direction === "out").sort((a, b) => a.date_ms - b.date_ms);
  const ins = transfers.filter((t) => t.direction === "in").sort((a, b) => a.date_ms - b.date_ms);
  const used_in = new Set<number>();

  const mark = (t: TransferForPairing): void => {
    internal_ids.add(t.id);
    if (t.plaid_id) internal_plaid_ids.add(t.plaid_id);
  };

  for (const out of outs) {
    let best = -1;
    let best_diff = Infinity;
    for (let i = 0; i < ins.length; i++) {
      if (used_in.has(i)) continue;
      const inbound = ins[i];
      if (inbound.account_id === out.account_id) continue; // must cross accounts
      if (Math.abs(inbound.amount - out.amount) > AMOUNT_EPSILON) continue; // same amount
      const diff = Math.abs(inbound.date_ms - out.date_ms);
      if (diff > tolerance_ms) continue;
      if (diff < best_diff) {
        best_diff = diff;
        best = i;
      }
    }
    if (best >= 0) {
      used_in.add(best);
      mark(out);
      mark(ins[best]);
    }
  }

  return { internal_ids, internal_plaid_ids };
}
