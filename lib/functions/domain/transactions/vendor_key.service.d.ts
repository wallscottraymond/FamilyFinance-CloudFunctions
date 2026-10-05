/**
 * Vendor key — the stored, queryable "which vendor is this" for a transaction
 * (Transaction-Detail-Redesign). Two purchases are from the same vendor when their
 * `vendorKey`s are equal.
 *
 * PURE. An exact port of the mobile `cleanVendorName` / `vendorKey`
 * (FamilyFinanceMobile `features/budgets/utils/vendorComparison.ts`), so Budget
 * Detail's vendor chart and the stored key agree; both sides run the same parity
 * table in their tests. Change one, change both.
 *
 * Source name order matches the derived budget rows: merchant name, else the
 * transaction name, else the description.
 */
/** Clean a vendor name for display (Plaid merchant names pass through unchanged). */
export declare function clean_vendor_name(raw: string): string;
/** Case-insensitive key for a raw vendor string. */
export declare function vendor_key_from_name(raw: string): string;
/**
 * The vendor key for a transaction, or null when it has no usable name (then it
 * has no vendor history).
 */
export declare function vendor_key(fields: {
    merchant_name?: string | null;
    name?: string | null;
    description?: string | null;
}): string | null;
//# sourceMappingURL=vendor_key.service.d.ts.map