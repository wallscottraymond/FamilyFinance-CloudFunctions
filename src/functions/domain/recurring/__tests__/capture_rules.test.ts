import {
  CAPTURE_RULES_VERSION,
  is_card_payment_inflow,
  is_credit_or_loan_account,
  is_low_confidence_stream,
  is_tombstoned_stream,
  is_transfer_detailed,
  is_v2_record,
  may_suggest_stream,
} from "../capture_rules";

describe("capture_rules", () => {
  it("v2 = the creation stamp only (doc or entity shape)", () => {
    expect(CAPTURE_RULES_VERSION).toBe(2);
    expect(is_v2_record({ captureRulesVersion: 2 })).toBe(true);
    expect(is_v2_record({ capture_rules_version: 2 })).toBe(true);
    expect(is_v2_record({})).toBe(false);
    expect(is_v2_record({ captureRulesVersion: 1 })).toBe(false);
    expect(is_v2_record(null)).toBe(false);
  });

  it("low confidence = EARLY_DETECTION / UNKNOWN status or UNKNOWN raw frequency (D6, D8)", () => {
    expect(is_low_confidence_stream("MATURE", "MONTHLY")).toBe(false);
    expect(is_low_confidence_stream("EARLY_DETECTION", "MONTHLY")).toBe(true);
    expect(is_low_confidence_stream("UNKNOWN", "MONTHLY")).toBe(true);
    expect(is_low_confidence_stream("MATURE", "UNKNOWN")).toBe(true);
    expect(is_low_confidence_stream(undefined, undefined)).toBe(true);
    expect(is_low_confidence_stream("TOMBSTONED", "MONTHLY")).toBe(false); // handled separately
    expect(is_tombstoned_stream("TOMBSTONED")).toBe(true);
    expect(is_tombstoned_stream("MATURE")).toBe(false);
  });

  it("transfer / card payment / account type predicates", () => {
    expect(is_transfer_detailed("TRANSFER_OUT_ACCOUNT_TRANSFER")).toBe(true);
    expect(is_transfer_detailed("TRANSFER_IN_DEPOSIT")).toBe(true);
    expect(is_transfer_detailed("LOAN_PAYMENTS_CREDIT_CARD_PAYMENT")).toBe(false);
    expect(is_card_payment_inflow("LOAN_PAYMENTS_CREDIT_CARD_PAYMENT")).toBe(true);
    expect(is_card_payment_inflow("INCOME_WAGES")).toBe(false);
    expect(is_credit_or_loan_account("credit")).toBe(true);
    expect(is_credit_or_loan_account("loan")).toBe(true);
    expect(is_credit_or_loan_account("depository")).toBe(false);
  });

  it("suggestion gates: no transfers (EARLY transfer → no tile); income only INCOME_* off card/loan (X17)", () => {
    expect(may_suggest_stream("outflow", "TRANSFER_OUT_ACCOUNT_TRANSFER", "depository")).toBe(false);
    expect(may_suggest_stream("outflow", "LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT", "depository")).toBe(true);
    expect(may_suggest_stream("outflow", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT", "depository")).toBe(true);
    expect(may_suggest_stream("inflow", "INCOME_WAGES", "depository")).toBe(true);
    expect(may_suggest_stream("inflow", "INCOME_WAGES", "credit")).toBe(false);
    expect(may_suggest_stream("inflow", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT", "credit")).toBe(false);
    expect(may_suggest_stream("inflow", "TRANSFER_IN_ACCOUNT_TRANSFER", "depository")).toBe(false);
  });
});
