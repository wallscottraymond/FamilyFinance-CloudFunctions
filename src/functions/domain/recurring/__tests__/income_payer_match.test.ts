import {
  DepositForPayerMatch,
  IncomeLineForPayerMatch,
  match_deposits_to_income_lines as match,
} from "../income_payer_match.service";

const NAME = "EGNYTE INC PAYROLL PPD ID: 9111111101";
const line: IncomeLineForPayerMatch = {
  id: "paycheck", description: NAME, account_id: "chk", first_date_ms: 1000,
  is_active: true, is_hidden: false, transaction_ids: ["old"],
};
const deposit: DepositForPayerMatch = {
  plaid_id: "new", name: NAME, account_id: "chk", date_ms: 5000, is_pending: false, is_other_income: true,
};

describe("match_deposits_to_income_lines", () => {
  it("October's paycheck: the exact payer on the same account links, whatever the amount", () => {
    expect(match([deposit], [line])).toEqual(new Map([["paycheck", ["new"]]]));
  });
  it("ignores case and outer spaces only", () => {
    expect(match([{ ...deposit, name: ` ${NAME.toLowerCase()} ` }], [line]).size).toBe(1);
    expect(match([{ ...deposit, name: "EGNYTE INC COUPA PAY" }], [line]).size).toBe(0);
  });
  it("never: another account, pending, already on a stream, before the line began", () => {
    expect(match([{ ...deposit, account_id: "sav" }], [line]).size).toBe(0);
    expect(match([{ ...deposit, is_pending: true }], [line]).size).toBe(0);
    expect(match([{ ...deposit, plaid_id: "old" }], [line]).size).toBe(0);
    expect(match([{ ...deposit, date_ms: 500 }], [line]).size).toBe(0);
  });
  it("never: a credit that isn't Other Income (ignored, pinned, re-categorized, already linked)", () => {
    expect(match([{ ...deposit, is_other_income: false }], [line]).size).toBe(0);
  });
  it("never: a stopped or hidden line, or a line with no description", () => {
    expect(match([deposit], [{ ...line, is_active: false }]).size).toBe(0);
    expect(match([deposit], [{ ...line, is_hidden: true }]).size).toBe(0);
    expect(match([{ ...deposit, name: "" }], [{ ...line, description: "" }]).size).toBe(0);
  });
  it("never: during a span the line was removed for", () => {
    expect(match([deposit], [{ ...line, removal_intervals: [{ from_ms: 2000, to_ms: null }] }]).size).toBe(0);
    expect(match([deposit], [{ ...line, removal_intervals: [{ from_ms: 2000, to_ms: 3000 }] }]).size).toBe(1);
  });
  it("two lines sharing a description: no guess", () => {
    expect(match([deposit], [line, { ...line, id: "other", transaction_ids: [] }]).size).toBe(0);
  });
  it("a deposit on another line's stream stays there", () => {
    expect(match([deposit], [line, { ...line, id: "b", description: "X", transaction_ids: ["new"] }]).size).toBe(0);
  });
});
