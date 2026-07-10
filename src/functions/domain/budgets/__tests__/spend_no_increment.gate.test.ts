/**
 * Architecture gate — the budget-spend pipeline must be INVALIDATION-based
 * (recompute `spent` by re-summing the current splits), never MUTATION-based
 * (`FieldValue.increment` on a running total). Incrementing accumulates drift and
 * breaks idempotency under at-least-once job delivery.
 *
 * This test fails the build if a `.increment(` / `FieldValue.increment` call is
 * introduced into any spend-pipeline source file. (See Budget-Transaction-Spend-Pipeline
 * Testing Strategy → "No-`increment` gate".)
 */
import * as fs from 'fs';
import * as path from 'path';

// Files that compute or persist budget spend. Adding an increment here would
// reintroduce drift — recompute from source instead.
const PIPELINE_FILES = [
  'domain/budgets/budget_spend.service.ts',
  'resolvers/budgets/budget_spend.resolver.ts',
  'resolvers/budgets/budget_rehome.resolver.ts',
  'repositories/budget_period.repo.ts',
  'orchestrators/budgets/recompute_budget_spent.orchestrator.ts',
  'orchestrators/transactions/merge_assignment.ts',
];

// Matches an actual increment CALL (open paren) — so a comment like
// "NOT an increment." does not trip the gate.
const INCREMENT_CALL = /(FieldValue\s*\.\s*increment\s*\()|(\.\s*increment\s*\()/;

const functionsRoot = path.resolve(__dirname, '../../..'); // → src/functions

describe('spend pipeline: no-increment gate', () => {
  it.each(PIPELINE_FILES)('%s does not use FieldValue.increment', (rel) => {
    const abs = path.join(functionsRoot, rel);
    expect(fs.existsSync(abs)).toBe(true);
    const src = fs.readFileSync(abs, 'utf8');
    expect(src).not.toMatch(INCREMENT_CALL);
  });
});
