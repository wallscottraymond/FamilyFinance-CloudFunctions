#!/bin/bash

# Prime/Non-Prime Budget Period System - Verification Script
# Run this after deployment to verify the implementation

set -e

echo "=========================================="
echo "Prime/Non-Prime System - Verification"
echo "=========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo -e "${RED}Error: Must run from FamilyFinance-CloudFunctions directory${NC}"
    exit 1
fi

echo "1. Checking TypeScript compilation..."
if npm run build > /dev/null 2>&1; then
    echo -e "${GREEN}✓ TypeScript compilation successful${NC}"
else
    echo -e "${RED}✗ TypeScript compilation failed${NC}"
    exit 1
fi

echo ""
echo "2. Checking source files exist..."

# Check TypeScript source files
files=(
    "src/functions/budgets/utils/primePeriodGeneration.ts"
    "src/functions/budgets/utils/nonPrimePeriodGeneration.ts"
    "src/functions/budgets/utils/periodGenerationOrchestrator.ts"
)

for file in "${files[@]}"; do
    if [ -f "$file" ]; then
        echo -e "${GREEN}✓ $file${NC}"
    else
        echo -e "${RED}✗ $file NOT FOUND${NC}"
        exit 1
    fi
done

echo ""
echo "3. Checking compiled JavaScript files..."

# Check compiled JavaScript files
js_files=(
    "lib/functions/budgets/utils/primePeriodGeneration.js"
    "lib/functions/budgets/utils/nonPrimePeriodGeneration.js"
    "lib/functions/budgets/utils/periodGenerationOrchestrator.js"
)

for file in "${js_files[@]}"; do
    if [ -f "$file" ]; then
        echo -e "${GREEN}✓ $file${NC}"
    else
        echo -e "${RED}✗ $file NOT FOUND${NC}"
        exit 1
    fi
done

echo ""
echo "4. Checking documentation files..."

doc_files=(
    "PRIME_NON_PRIME_SYSTEM.md"
    "IMPLEMENTATION_SUMMARY.md"
    "src/functions/budgets/utils/README_PRIME_NON_PRIME.md"
)

for file in "${doc_files[@]}"; do
    if [ -f "$file" ]; then
        echo -e "${GREEN}✓ $file${NC}"
    else
        echo -e "${YELLOW}⚠ $file NOT FOUND (documentation)${NC}"
    fi
done

echo ""
echo "5. Checking type definitions..."

# Check for PrimePeriodContribution in types file
if grep -q "interface PrimePeriodContribution" src/types/index.ts; then
    echo -e "${GREEN}✓ PrimePeriodContribution interface found${NC}"
else
    echo -e "${RED}✗ PrimePeriodContribution interface NOT FOUND${NC}"
    exit 1
fi

# Check for Prime/Non-Prime fields in BudgetPeriodDocument
if grep -q "isPrime?" src/types/index.ts; then
    echo -e "${GREEN}✓ isPrime field found in BudgetPeriodDocument${NC}"
else
    echo -e "${RED}✗ isPrime field NOT FOUND in BudgetPeriodDocument${NC}"
    exit 1
fi

if grep -q "dailyRate?" src/types/index.ts; then
    echo -e "${GREEN}✓ dailyRate field found in BudgetPeriodDocument${NC}"
else
    echo -e "${RED}✗ dailyRate field NOT FOUND in BudgetPeriodDocument${NC}"
    exit 1
fi

if grep -q "primePeriodBreakdown?" src/types/index.ts; then
    echo -e "${GREEN}✓ primePeriodBreakdown field found in BudgetPeriodDocument${NC}"
else
    echo -e "${RED}✗ primePeriodBreakdown field NOT FOUND in BudgetPeriodDocument${NC}"
    exit 1
fi

echo ""
echo "6. Checking function exports..."

# Check for orchestrator export in budgetPeriods.ts
if grep -q "generateBudgetPeriodsWithPrimeSystem" src/functions/budgets/utils/budgetPeriods.ts; then
    echo -e "${GREEN}✓ generateBudgetPeriodsWithPrimeSystem exported from budgetPeriods.ts${NC}"
else
    echo -e "${RED}✗ generateBudgetPeriodsWithPrimeSystem export NOT FOUND${NC}"
    exit 1
fi

# Check for deprecation notice
if grep -q "@deprecated" src/functions/budgets/utils/budgetPeriods.ts; then
    echo -e "${GREEN}✓ @deprecated notice found in generateBudgetPeriodsForNewBudget${NC}"
else
    echo -e "${YELLOW}⚠ @deprecated notice NOT FOUND (non-critical)${NC}"
fi

echo ""
echo "=========================================="
echo -e "${GREEN}✓ All verification checks passed!${NC}"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. Deploy to Firebase: npm run deploy"
echo "2. Create a test budget via mobile app or API"
echo "3. Check Firestore for budget_periods with new fields:"
echo "   - isPrime: true/false"
echo "   - dailyRate: number"
echo "   - primePeriodBreakdown: array (for non-prime)"
echo "4. Verify amounts match test cases in PRIME_NON_PRIME_SYSTEM.md"
echo "5. Check function logs: firebase functions:log --only onBudgetCreate"
echo ""
echo "Documentation:"
echo "- Complete guide: PRIME_NON_PRIME_SYSTEM.md"
echo "- Quick reference: src/functions/budgets/utils/README_PRIME_NON_PRIME.md"
echo "- Summary: IMPLEMENTATION_SUMMARY.md"
echo ""
