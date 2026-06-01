/**
 * Budget CRUD Operations Index
 *
 * Create/Update/Delete are now handled by the v2 layered-architecture onCall
 * functions (create_budget / update_budget / delete_budget in entry/callable).
 * The legacy createBudget/updateBudget/deleteBudget handlers were removed
 * (2026-06-01) — they wrote budgets WITHOUT the v2 cascade and were a footgun.
 * Only the read (getBudget) remains here.
 */

export { getBudget } from './getBudget';
