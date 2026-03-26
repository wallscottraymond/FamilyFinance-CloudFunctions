/**
 * Period Generation Orchestrator
 *
 * Orchestrates the Prime/Non-Prime budget period generation system.
 * This is the entry point for generating all budget periods using the new system.
 *
 * Process:
 * 1. Determine prime period type from budget.period
 * 2. Generate prime periods with calculated dailyRate
 * 3. Persist prime periods to Firestore (CRITICAL: must complete before step 4)
 * 4. In parallel: Generate non-prime periods for each non-prime type
 * 5. Persist non-prime periods to Firestore
 * 6. Return combined result
 */
import * as admin from 'firebase-admin';
import { Budget } from '../../../types';
import { CreateBudgetPeriodsResult } from './budgetPeriods';
/**
 * Generate all budget periods using the Prime/Non-Prime system
 *
 * This orchestrator function coordinates:
 * - Prime period generation (matches budget's period type)
 * - Non-prime period generation (derived from prime periods)
 * - Firestore persistence (primes first, then non-primes)
 * - Budget metadata updates
 *
 * @param db - Firestore instance
 * @param budgetId - Budget document ID
 * @param budget - Budget document data
 * @returns Result of period generation including count and period range
 */
export declare function generateBudgetPeriodsWithPrimeSystem(db: admin.firestore.Firestore, budgetId: string, budget: Budget): Promise<CreateBudgetPeriodsResult>;
//# sourceMappingURL=periodGenerationOrchestrator.d.ts.map