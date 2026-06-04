"use strict";
/**
 * Plaid personal_finance_category taxonomy (DETAILED level).
 *
 * The source of truth for seeding the `categories` collection. Each detailed
 * category becomes one category doc whose **document id IS the detailed enum**
 * (e.g. `FOOD_AND_DRINK_GROCERIES`). Budgets store these enums in `categoryIds`
 * and transaction splits carry the same enum in `plaidDetailedCategory`, so the
 * assignment engine matches them directly. The display `name` is editable —
 * renaming never breaks matching because the stable id is the enum.
 *
 * @module categories/seed/plaid_category_taxonomy
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLAID_SEED_CATEGORIES = void 0;
const GROUPS = [
    {
        primary: "INCOME",
        type: "Income",
        suffixes: [
            "DIVIDENDS", "INTEREST_EARNED", "RETIREMENT_PENSION", "TAX_REFUND",
            "UNEMPLOYMENT", "WAGES", "OTHER_INCOME",
        ],
    },
    {
        primary: "TRANSFER_IN",
        type: "Income",
        suffixes: [
            "CASH_ADVANCES_AND_LOANS", "DEPOSIT", "INVESTMENT_AND_RETIREMENT_FUNDS",
            "SAVINGS", "ACCOUNT_TRANSFER", "OTHER_TRANSFER_IN",
        ],
    },
    {
        primary: "TRANSFER_OUT",
        type: "Outflow",
        suffixes: [
            "INVESTMENT_AND_RETIREMENT_FUNDS", "SAVINGS", "WITHDRAWAL",
            "ACCOUNT_TRANSFER", "OTHER_TRANSFER_OUT",
        ],
    },
    {
        primary: "LOAN_PAYMENTS",
        type: "Outflow",
        suffixes: [
            "CAR_PAYMENT", "CREDIT_CARD_PAYMENT", "PERSONAL_LOAN_PAYMENT",
            "MORTGAGE_PAYMENT", "STUDENT_LOAN_PAYMENT", "OTHER_PAYMENT",
        ],
    },
    {
        primary: "BANK_FEES",
        type: "Outflow",
        suffixes: [
            "ATM_FEES", "FOREIGN_TRANSACTION_FEES", "INSUFFICIENT_FUNDS",
            "INTEREST_CHARGE", "OVERDRAFT_FEES", "OTHER_BANK_FEES",
        ],
    },
    {
        primary: "ENTERTAINMENT",
        type: "Outflow",
        suffixes: [
            "CASINOS_AND_GAMBLING", "MUSIC_AND_AUDIO",
            "SPORTING_EVENTS_AMUSEMENT_PARKS_AND_MUSEUMS", "TV_AND_MOVIES",
            "VIDEO_GAMES", "OTHER_ENTERTAINMENT",
        ],
    },
    {
        primary: "FOOD_AND_DRINK",
        type: "Outflow",
        suffixes: [
            "BEER_WINE_AND_LIQUOR", "COFFEE", "FAST_FOOD", "GROCERIES",
            "RESTAURANT", "VENDING_MACHINES", "OTHER_FOOD_AND_DRINK",
        ],
    },
    {
        primary: "GENERAL_MERCHANDISE",
        type: "Outflow",
        suffixes: [
            "BOOKSTORES_AND_NEWSSTANDS", "CLOTHING_AND_ACCESSORIES",
            "CONVENIENCE_STORES", "DEPARTMENT_STORES", "DISCOUNT_STORES",
            "ELECTRONICS", "GIFTS_AND_NOVELTIES", "OFFICE_SUPPLIES",
            "ONLINE_MARKETPLACES", "PET_SUPPLIES", "SPORTING_GOODS",
            "SUPERSTORES", "TOBACCO_AND_VAPE", "OTHER_GENERAL_MERCHANDISE",
        ],
    },
    {
        primary: "HOME_IMPROVEMENT",
        type: "Outflow",
        suffixes: [
            "FURNITURE", "HARDWARE", "REPAIR_AND_MAINTENANCE", "SECURITY",
            "OTHER_HOME_IMPROVEMENT",
        ],
    },
    {
        primary: "MEDICAL",
        type: "Outflow",
        suffixes: [
            "DENTAL_CARE", "EYE_CARE", "NURSING_CARE",
            "PHARMACIES_AND_SUPPLEMENTS", "PRIMARY_CARE", "VETERINARY_SERVICES",
            "OTHER_MEDICAL",
        ],
    },
    {
        primary: "PERSONAL_CARE",
        type: "Outflow",
        suffixes: [
            "GYMS_AND_FITNESS_CENTERS", "HAIR_AND_BEAUTY",
            "LAUNDRY_AND_DRY_CLEANING", "OTHER_PERSONAL_CARE",
        ],
    },
    {
        primary: "GENERAL_SERVICES",
        type: "Outflow",
        suffixes: [
            "ACCOUNTING_AND_FINANCIAL_PLANNING", "AUTOMOTIVE", "CHILDCARE",
            "CONSULTING_AND_LEGAL", "EDUCATION", "INSURANCE",
            "POSTAGE_AND_SHIPPING", "STORAGE", "OTHER_GENERAL_SERVICES",
        ],
    },
    {
        primary: "GOVERNMENT_AND_NON_PROFIT",
        type: "Outflow",
        suffixes: [
            "DONATIONS", "GOVERNMENT_DEPARTMENTS_AND_AGENCIES", "TAX_PAYMENT",
            "OTHER_GOVERNMENT_AND_NON_PROFIT",
        ],
    },
    {
        primary: "TRANSPORTATION",
        type: "Outflow",
        suffixes: [
            "BIKES_AND_SCOOTERS", "GAS", "PARKING", "PUBLIC_TRANSIT",
            "TAXIS_AND_RIDE_SHARES", "TOLLS", "OTHER_TRANSPORTATION",
        ],
    },
    {
        primary: "TRAVEL",
        type: "Outflow",
        suffixes: ["FLIGHTS", "LODGING", "RENTAL_CARS", "OTHER_TRAVEL"],
    },
    {
        primary: "RENT_AND_UTILITIES",
        type: "Outflow",
        suffixes: [
            "GAS_AND_ELECTRICITY", "INTERNET_AND_CABLE", "RENT",
            "SEWAGE_AND_WASTE_MANAGEMENT", "TELEPHONE", "WATER",
            "OTHER_UTILITIES",
        ],
    },
];
/** Title-case a SNAKE_CASE token for a human-friendly default name. */
function humanize(token) {
    return token
        .split("_")
        .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
        .join(" ");
}
/**
 * The full flat list of seed categories (one per Plaid detailed enum).
 * `name` defaults to "Primary: Suffix" (e.g. "Food And Drink: Groceries").
 */
exports.PLAID_SEED_CATEGORIES = GROUPS.flatMap((g) => g.suffixes.map((suffix) => ({
    detailed: `${g.primary}_${suffix}`,
    primary: g.primary,
    name: `${humanize(g.primary)}: ${humanize(suffix)}`,
    type: g.type,
})));
//# sourceMappingURL=plaid_category_taxonomy.js.map