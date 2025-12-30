#!/bin/bash

# Test script for dev functions
# Run this from the FamilyFinance-CloudFunctions directory

echo "🧪 Testing Outflows Dev Functions"
echo "=================================="
echo ""

# Get the project ID
PROJECT_ID="family-budget-app-cb59b"
REGION="us-central1"

echo "📋 Configuration:"
echo "  Project: $PROJECT_ID"
echo "  Region: $REGION"
echo ""

# Function 1: debugOutflowPeriods (HTTP request - no auth needed)
echo "1️⃣  Testing debugOutflowPeriods (HTTP)..."
echo "-------------------------------------------"
URL="https://$REGION-$PROJECT_ID.cloudfunctions.net/debugOutflowPeriods"
echo "  URL: $URL"
echo ""
echo "  Response:"
curl -s "$URL" | jq '.'
echo ""
echo ""

# Function 2: createTestOutflows (Callable - requires Firebase Auth)
echo "2️⃣  Testing createTestOutflows (Callable)..."
echo "-------------------------------------------"
echo "  ⚠️  This function requires Firebase Authentication"
echo "  To test from mobile app or web:"
echo ""
echo "  import { getFunctions, httpsCallable } from '@react-native-firebase/functions';"
echo "  const functions = getFunctions();"
echo "  const createTest = httpsCallable(functions, 'createTestOutflows');"
echo "  const result = await createTest({});"
echo "  console.log(result.data);"
echo ""
echo "  Or use Firebase CLI to call:"
echo "  firebase functions:call createTestOutflows"
echo ""

# Summary
echo "=================================="
echo "✅ Test script complete!"
echo ""
echo "📝 Notes:"
echo "  - debugOutflowPeriods: HTTP endpoint (can call directly)"
echo "  - createTestOutflows: Callable function (requires auth)"
echo ""
echo "🔧 If functions aren't responding:"
echo "  1. Check deployment: firebase functions:list"
echo "  2. Check logs: firebase functions:log"
echo "  3. Enable billing for Secret Manager API if deploying"
echo ""
