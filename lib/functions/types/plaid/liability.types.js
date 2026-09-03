"use strict";
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
/* eslint-disable @typescript-eslint/naming-convention */
Object.defineProperty(exports, "__esModule", { value: true });
//# sourceMappingURL=liability.types.js.map