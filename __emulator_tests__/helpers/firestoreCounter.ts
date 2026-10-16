/**
 * firestoreCounter — counts billed Firestore reads / writes made by the code under test.
 *
 * Patches the shared `@google-cloud/firestore` prototypes (firebase-admin re-exports the same
 * classes) once, and attributes every operation to every active counter:
 *   reads:  DocumentReference.get = 1, getAll = refs.length, Query.get = max(1, docs returned)
 *           (an empty query is billed 1 read), Transaction.get likewise;
 *   writes: every set / update / delete / create queued on a WriteBatch (DocumentReference writes,
 *           transactions and BulkWriter all go through WriteBatch).
 * Per-collection breakdowns help explain a count. Emulator suites only.
 */
import {
  DocumentReference,
  Firestore,
  Query,
  Transaction,
  WriteBatch,
} from '@google-cloud/firestore';

export interface Counts {
  reads: number;
  writes: number;
  reads_by: Record<string, number>;
  writes_by: Record<string, number>;
}

const active = new Set<Counts>();
let patched = false;

const coll_of_ref = (ref: unknown): string => {
  const p = (ref as { path?: string })?.path ?? '';
  const parts = p.split('/');
  return parts.length >= 2 ? parts[parts.length - 2] : parts[0] || '?';
};
const coll_of_query = (q: unknown): string => {
  const o = (q as { _queryOptions?: { collectionId?: string } })?._queryOptions;
  return o?.collectionId ?? '?';
};

function add(kind: 'reads' | 'writes', coll: string, n: number): void {
  for (const c of active) {
    c[kind] += n;
    const by = kind === 'reads' ? c.reads_by : c.writes_by;
    by[coll] = (by[coll] ?? 0) + n;
  }
}

function patch(): void {
  if (patched) return;
  patched = true;
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const dr = DocumentReference.prototype as any;
  const orig_dr_get = dr.get;
  dr.get = function (...a: unknown[]) {
    add('reads', coll_of_ref(this), 1);
    return orig_dr_get.apply(this, a);
  };
  const fs = Firestore.prototype as any;
  const orig_get_all = fs.getAll;
  fs.getAll = function (...refs: unknown[]) {
    const docs = refs.filter((r) => r instanceof DocumentReference);
    for (const r of docs) add('reads', coll_of_ref(r), 1);
    return orig_get_all.apply(this, refs);
  };
  const q = Query.prototype as any;
  const orig_q_get = q.get;
  q.get = async function (...a: unknown[]) {
    const snap = await orig_q_get.apply(this, a);
    add('reads', coll_of_query(this), Math.max(1, snap.size));
    return snap;
  };
  const tx = Transaction.prototype as any;
  const orig_tx_get = tx.get;
  tx.get = async function (target: unknown, ...a: unknown[]) {
    const res = await orig_tx_get.call(this, target, ...a);
    if (target instanceof DocumentReference) add('reads', coll_of_ref(target), 1);
    else add('reads', coll_of_query(target), Math.max(1, (res as { size?: number })?.size ?? 1));
    return res;
  };
  const wb = WriteBatch.prototype as any;
  for (const m of ['set', 'update', 'delete', 'create']) {
    const orig = wb[m];
    wb[m] = function (ref: unknown, ...a: unknown[]) {
      add('writes', coll_of_ref(ref), 1);
      return orig.call(this, ref, ...a);
    };
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/** Start counting; `stop()` ends it and returns the totals. Counters may nest. */
export function startCounting(): { stop: () => Counts; peek: () => Counts } {
  patch();
  const c: Counts = { reads: 0, writes: 0, reads_by: {}, writes_by: {} };
  active.add(c);
  return {
    stop: () => {
      active.delete(c);
      return c;
    },
    peek: () => ({ ...c, reads_by: { ...c.reads_by }, writes_by: { ...c.writes_by } }),
  };
}
