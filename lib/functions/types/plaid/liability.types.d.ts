/**
 * Plaid Liability types (Investments-And-Liabilities-Modeling — v1)
 *
 * A discriminated `LiabilityDetail` stored as an OPTIONAL field on the account
 * record. Populated from Plaid's `/liabilities/get` (`liabilities.{credit,mortgage,
 * student}[]`) for enriched liability accounts; absent on cash + un-enriched loans
 * (auto/HELOC), which render "—".
 *
 * NOTE: fields are camelCase (eslint-disabled) to match the camelCase Firestore
 * `accounts` document + the mobile `ConnectedAccount` shape, so the object round-trips
 * account.repo <-> Firestore <-> mobile with no per-field remapping. All dates are
 * epoch **ms** (UTC); all money is a plain number in the account currency.
 *
 * @module types/plaid/liability
 */
/** Which Plaid Link flow a link token is for (drives products + account_filters). */
export type LinkTokenFlow = "cash" | "liability";
/** A single credit-card APR (Plaid `credit[].aprs[]`). Store + display ALL. */
export interface LiabilityApr {
    /** e.g. "purchase_apr" | "cash_apr" | "balance_transfer_apr" | "special" */
    type: string;
    percentage: number;
    balanceSubjectToApr?: number;
    interestChargeAmount?: number;
}
/** A postal address (mortgage property / student servicer). */
export interface LiabilityAddress {
    street?: string;
    city?: string;
    region?: string;
    postalCode?: string;
    country?: string;
}
/** Credit-card liability — Plaid `liabilities.credit[]`. */
export interface CreditLiabilityDetail {
    kind: "credit";
    aprs: LiabilityApr[];
    lastStatementBalance?: number;
    lastStatementIssueDateMs?: number;
    minimumPaymentAmount?: number;
    nextPaymentDueDateMs?: number;
    lastPaymentAmount?: number;
    lastPaymentDateMs?: number;
    isOverdue?: boolean;
}
/** Mortgage liability — Plaid `liabilities.mortgage[]`. */
export interface MortgageLiabilityDetail {
    kind: "mortgage";
    interestRatePercentage?: number;
    interestRateType?: string;
    originationDateMs?: number;
    originationPrincipalAmount?: number;
    maturityDateMs?: number;
    loanTerm?: string;
    nextMonthlyPayment?: number;
    nextPaymentDueDateMs?: number;
    lastPaymentAmount?: number;
    lastPaymentDateMs?: number;
    escrowBalance?: number;
    currentLateFee?: number;
    pastDueAmount?: number;
    hasPmi?: boolean;
    hasPrepaymentPenalty?: boolean;
    propertyAddress?: LiabilityAddress;
    ytdInterestPaid?: number;
    ytdPrincipalPaid?: number;
    /** Mortgage has no `is_overdue` — derived from `pastDueAmount > 0`. */
    isOverdue?: boolean;
}
/** Student-loan liability — Plaid `liabilities.student[]`. */
export interface StudentLiabilityDetail {
    kind: "student";
    loanName?: string;
    interestRatePercentage?: number;
    minimumPaymentAmount?: number;
    nextPaymentDueDateMs?: number;
    lastPaymentAmount?: number;
    lastPaymentDateMs?: number;
    lastStatementBalance?: number;
    lastStatementIssueDateMs?: number;
    originationDateMs?: number;
    originationPrincipalAmount?: number;
    outstandingInterestAmount?: number;
    expectedPayoffDateMs?: number;
    loanStatusType?: string;
    repaymentPlanType?: string;
    repaymentPlanDescription?: string;
    pslfEstimatedEligibilityDateMs?: number;
    servicerAddress?: LiabilityAddress;
    ytdInterestPaid?: number;
    ytdPrincipalPaid?: number;
    isOverdue?: boolean;
}
/** Discriminated liability detail attached to an account (`account.liability`). */
export type LiabilityDetail = CreditLiabilityDetail | MortgageLiabilityDetail | StudentLiabilityDetail;
/** Liability details keyed by Plaid `account_id` (transformer output → sync merge). */
export type LiabilityByAccountId = Record<string, LiabilityDetail>;
//# sourceMappingURL=liability.types.d.ts.map