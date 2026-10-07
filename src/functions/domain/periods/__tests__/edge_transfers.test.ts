/**
 * Edge transfers unit tests (Account-Rooted-Sharing D12; Tests §6 T-ED-*).
 */

import { find_crossing_transfers } from "../edge_transfers.service";
import { detect_internal_transfers_from_txns } from "../../../resolvers/shared/on_read_matching";
import { Timestamp } from "firebase-admin/firestore";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 1);

function txn(
  id: string,
  account: string,
  amount: number,
  day: number,
  cat: string
): { id: string; data: Record<string, unknown> } {
  return {
    id,
    data: {
      accountId: account,
      transactionId: `p_${id}`,
      transactionDate: Timestamp.fromMillis(T0 + day * DAY),
      type: cat.startsWith("TRANSFER_IN") ? "income" : "expense",
      splits: [{ amount, plaidDetailedCategory: cat }],
    },
  };
}

/** Crossing set for a view = accounts in `view_accounts`, members' txns = `all`. */
function crossing(all: ReturnType<typeof txn>[], view_accounts: string[]) {
  const view = all.filter((t) => view_accounts.includes(t.data.accountId as string));
  const view_internal = detect_internal_transfers_from_txns(view).internal_ids;
  // Two-stage pairing, exactly as the resolver does it.
  return find_crossing_transfers(
    detect_internal_transfers_from_txns(all.filter((t) => !view_internal.has(t.id))),
    view_internal,
    view
  );
}

describe("edge transfers (D12)", () => {
  // Alex: CHK-A (private) → JC (shared with The Walls) $2,400 contribution.
  const contribution = [
    txn("out", "CHK-A", 2400, 0, "TRANSFER_OUT_ACCOUNT_TRANSFER"),
    txn("in", "JC", 2400, 1, "TRANSFER_IN_ACCOUNT_TRANSFER"),
  ];

  it("T-ED-03 private → shared: OUT is edge in Me, IN is edge in the group", () => {
    const me = crossing(contribution, ["CHK-A"]);
    expect([...me.out_ids]).toEqual(["out"]);
    expect(me.in_ids.size).toBe(0);
    const group = crossing(contribution, ["JC"]);
    expect([...group.in_ids]).toEqual(["in"]);
    expect([...group.plaid_ids]).toEqual(["p_in"]);
  });

  it("T-ED-04 both sides in the same view → internal, not edge", () => {
    expect(crossing(contribution, ["CHK-A", "JC"]).ids.size).toBe(0);
  });

  it("parity: nothing shared (view = everything) → no edge money", () => {
    const many = [
      ...contribution,
      txn("o2", "SAV", 50, 3, "TRANSFER_OUT_ACCOUNT_TRANSFER"),
      txn("i2", "CHK-A", 50, 4, "TRANSFER_IN_ACCOUNT_TRANSFER"),
      txn("ext", "CHK-A", 99, 5, "TRANSFER_OUT_ACCOUNT_TRANSFER"), // unpaired (external)
    ];
    expect(crossing(many, ["CHK-A", "JC", "SAV"]).ids.size).toBe(0);
  });

  it("T-ED-06/07 a transfer that never paired is never edge (unknown counterparty)", () => {
    const lonely = [
      txn("x", "JC", 500, 0, "TRANSFER_OUT_ACCOUNT_TRANSFER"),
      txn("y", "CHK-A", 499.99, 0, "TRANSFER_IN_ACCOUNT_TRANSFER"), // amount off by 1¢
      txn("z", "CHK-A", 500, 7, "TRANSFER_IN_ACCOUNT_TRANSFER"), // 7 days apart
    ];
    expect(crossing(lonely, ["JC"]).ids.size).toBe(0);
    expect(crossing(lonely, ["CHK-A"]).ids.size).toBe(0);
  });

  it("T-ED-05 two same-day $500 transfers: one internal to the view, one crossing", () => {
    const two = [
      txn("a_out", "JC", 500, 0, "TRANSFER_OUT_ACCOUNT_TRANSFER"),
      txn("a_in", "SAV-JOINT", 500, 0, "TRANSFER_IN_ACCOUNT_TRANSFER"),
      txn("b_out", "CHK-A", 500, 0, "TRANSFER_OUT_ACCOUNT_TRANSFER"),
      txn("b_in", "JC", 500, 0, "TRANSFER_IN_ACCOUNT_TRANSFER"),
    ];
    // The group's own JC → SAV-JOINT move stays internal (stage 1 wins); the contribution
    // CHK-A → JC is the only crossing, counted IN for the group and OUT for Me.
    const group = crossing(two, ["JC", "SAV-JOINT"]);
    expect([...group.in_ids]).toEqual(["b_in"]);
    expect(group.out_ids.size).toBe(0);
    const me = crossing(two, ["CHK-A"]);
    expect([...me.out_ids]).toEqual(["b_out"]);
  });

  it("direction follows the category (TRANSFER_IN = in, else out)", () => {
    const c = crossing(contribution, ["CHK-A", "X"]);
    expect(c.out_ids.has("out")).toBe(true);
  });
});

describe("card payments pair like transfers (G7 / D11)", () => {
  const card = (id: string, account: string, amount: number, day: number, type: "income" | "expense") => {
    const t = txn(id, account, amount, day, "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT");
    t.data.type = type;
    return t;
  };
  it("checking payment ↔ card's payment received → internal (both accounts linked)", () => {
    const pair = [card("pay", "CHK-A", 789, 0, "expense"), card("recv", "VISA-A", 789, 1, "income")];
    const { internal_ids } = detect_internal_transfers_from_txns(pair);
    expect([...internal_ids].sort()).toEqual(["pay", "recv"]);
  });
  it("payment to an UNLINKED card stays unpaired (a real bill payment)", () => {
    expect(detect_internal_transfers_from_txns([card("pay", "CHK-A", 400, 0, "expense")]).internal_ids.size)
      .toBe(0);
  });
  it("joint pays Alex's private card → edge: out of the group, into Alex's Me", () => {
    const pair = [card("pay", "JC", 300, 0, "expense"), card("recv", "VISA-A", 300, 0, "income")];
    expect([...crossing(pair, ["JC"]).out_ids]).toEqual(["pay"]);
    expect([...crossing(pair, ["VISA-A"]).in_ids]).toEqual(["recv"]);
  });
});
