/**
 * Create Rule - Callable Function
 *
 * Allows users to create new categorization rules with boolean logic conditions.
 *
 * **Purpose:**
 * - Create user-defined rules for automatic transaction categorization
 * - Support complex AND/OR boolean logic
 * - Optionally preview impact before creating
 * - Optionally apply retroactively to existing transactions
 *
 * **Authentication:** User must be authenticated
 * **Authorization:** User creates rules for themselves only
 * **Memory:** 512MiB
 * **Timeout:** 60s
 *
 * **Flow:**
 * 1. User submits rule definition (conditions + actions)
 * 2. Validate rule syntax and structure
 * 3. Check rate limits (max 10 rules/hour)
 * 4. If testFirst=true, preview impact without saving
 * 5. Save rule to Firestore
 * 6. If applyRetroactively=true, apply to existing transactions
 * 7. Update rule statistics (matchCount, lastAppliedAt)
 * 8. Return rule ID and preview results
 *
 * **Example Usage:**
 * ```typescript
 * const createRule = httpsCallable(functions, 'createRule');
 *
 * const result = await createRule({
 *   name: "Gas Stations → Transportation",
 *   description: "Categorize all gas station purchases",
 *   conditions: {
 *     operator: 'OR',
 *     conditionGroups: [
 *       {
 *         operator: 'AND',
 *         conditions: [
 *           {
 *             field: 'merchantName',
 *             condition: {
 *               type: 'string',
 *               contains: 'smiths gas',
 *               caseSensitive: false
 *             }
 *           }
 *         ]
 *       },
 *       {
 *         operator: 'AND',
 *         conditions: [
 *           {
 *             field: 'merchantName',
 *             condition: {
 *               type: 'string',
 *               contains: 'chevron',
 *               caseSensitive: false
 *             }
 *           }
 *         ]
 *       }
 *     ]
 *   },
 *   actions: {
 *     setCategory: 'TRANSPORTATION_GAS',
 *     addTags: ['gas', 'auto']
 *   },
 *   priority: 100,
 *   applyRetroactively: true,
 *   testFirst: false
 * });
 *
 * // Result:
 * // {
 * //   success: true,
 * //   ruleId: "rule_abc123",
 * //   previewResults: {
 * //     matchingTransactions: 47,
 * //     sampleTransactions: ["txn_1", "txn_2", "txn_3"]
 * //   },
 * //   message: "Rule created and applied to 47 transactions"
 * // }
 * ```
 *
 * **Security:**
 * - User must be authenticated
 * - User can only create rules for themselves
 * - Rate limited to 10 creations per hour
 * - Rule validation prevents malicious patterns
 *
 * **Performance:**
 * - Retroactive application processes in batches of 50
 * - Delay of 100ms between batches to avoid rate limiting
 * - Maximum 10,000 transactions processed retroactively
 * - Uses caching for rule evaluation
 *
 * **Error Handling:**
 * - Invalid rule syntax: Returns validation errors
 * - Rate limit exceeded: Returns error with retry time
 * - Permission denied: Returns authentication error
 * - Timeout: Returns partial results if any
 *
 * **Monitoring:**
 * - Log rule creation events
 * - Track rule application performance
 * - Alert on high error rates
 * - Monitor retroactive application progress
 *
 * @see src/functions/rules/CLAUDE.md for comprehensive documentation
 * @see src/functions/rules/types/ruleTypes.ts for type definitions
 */
/**
 * NOTE: This is a PLACEHOLDER file for documentation purposes.
 *
 * This file shows the expected function signature, JSDoc documentation,
 * and implementation notes. The actual implementation is pending.
 *
 * To implement:
 * 1. Uncomment the function export below
 * 2. Implement validation logic (see utils/ruleValidation.ts)
 * 3. Implement preview logic (see api/operations/previewRule.ts)
 * 4. Implement retroactive application (see utils/ruleApplication.ts)
 * 5. Add tests (see __tests__/createRule.test.ts)
 * 6. Update src/index.ts to export this function
 *
 * See CLAUDE.md for full implementation specification.
 */
//# sourceMappingURL=createRule.d.ts.map