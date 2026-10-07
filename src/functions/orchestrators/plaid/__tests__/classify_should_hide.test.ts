/**
 * Classifier hide rule (G7 / D11): card-payment bills to LINKED cards are internal.
 */
jest.mock("../../../repositories/outflow.repo", () => ({ outflow_repo: {} }));
jest.mock("../../../repositories/inflow.repo", () => ({ inflow_repo: {} }));
jest.mock("../../../repositories/transaction.repo", () => ({ transaction_repo: {} }));
jest.mock("../../../repositories/transfer_classification_state.repo", () => ({}));

import { should_hide } from "../classify_internal_transfers.orchestrator";

const internal = new Set(["p_paired"]);

describe("should_hide (classifier v2)", () => {
  it("card payment whose payments pair with a linked card → hidden (no double plan)", () => {
    expect(should_hide("LOAN_PAYMENTS_CREDIT_CARD_PAYMENT", ["p_paired", "p_x"], internal)).toBe(true);
  });
  it("card payment to an UNLINKED card (never pairs) → stays a bill", () => {
    expect(should_hide("LOAN_PAYMENTS_CREDIT_CARD_PAYMENT", ["p_x"], internal)).toBe(false);
  });
  it("internal transfer stream → hidden; external ACH (unpaired) → kept", () => {
    expect(should_hide("TRANSFER_OUT_ACCOUNT_TRANSFER", ["p_paired"], internal)).toBe(true);
    expect(should_hide("TRANSFER_OUT_ACCOUNT_TRANSFER", ["p_x"], internal)).toBe(false);
  });
  it("ordinary bills are never hidden, even if a txn id collides", () => {
    expect(should_hide("RENT_AND_UTILITIES_RENT", ["p_paired"], internal)).toBe(false);
    expect(should_hide("LOAN_PAYMENTS_MORTGAGE_PAYMENT", ["p_paired"], internal)).toBe(false);
  });
});
