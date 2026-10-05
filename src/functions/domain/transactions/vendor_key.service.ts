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
export function clean_vendor_name(raw: string): string {
  let s = (raw || "").trim();
  s = s.replace(/^(POS DEBIT|POS PURCHASE|DEBIT CARD PURCHASE|PURCHASE AUTHORIZED ON \d{2}\/\d{2})\s+/i, "");
  s = s.replace(/\s+\d{2}\/\d{2}(\/\d{2,4})?$/, ""); // trailing date
  s = s.replace(/\s+[A-Z]{2}\d{6,}.*$/, ""); // "UT685612 …" auth codes
  s = s.replace(/\s+#\s*\d+.*$/, ""); // store numbers "#947 …"
  s = s.replace(/\s+\+?\d[\d-]{6,}$/, ""); // trailing phone / card digits
  s = s.replace(/\s{2,}/g, " ").trim();
  return s || (raw || "").trim() || "Unknown";
}

/** Case-insensitive key for a raw vendor string. */
export function vendor_key_from_name(raw: string): string {
  return clean_vendor_name(raw).toLowerCase();
}

/**
 * The vendor key for a transaction, or null when it has no usable name (then it
 * has no vendor history).
 */
export function vendor_key(fields: {
  merchant_name?: string | null;
  name?: string | null;
  description?: string | null;
}): string | null {
  const source = [fields.merchant_name, fields.name, fields.description]
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .find((v) => v.length > 0);
  return source ? vendor_key_from_name(source) : null;
}
