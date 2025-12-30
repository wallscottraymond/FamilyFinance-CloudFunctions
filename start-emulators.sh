#!/bin/bash

echo "🚀 Starting Firebase Emulators for Dev Function Testing"
echo "========================================================"
echo ""
echo "This will start:"
echo "  - Functions Emulator (port 5001)"
echo "  - Firestore Emulator (port 8080)"
echo "  - Auth Emulator (port 9099)"
echo "  - Emulator UI (port 4000)"
echo ""
echo "⚠️  Note: Emulator testing works WITHOUT billing enabled!"
echo ""

# Build functions first
echo "📦 Building functions..."
npm run build

if [ $? -ne 0 ]; then
  echo ""
  echo "❌ Build failed. Please fix errors and try again."
  exit 1
fi

echo ""
echo "✅ Build successful!"
echo ""
echo "🔥 Starting emulators..."
echo ""
echo "Once started, you can:"
echo "  - View UI at: http://localhost:4000"
echo "  - Test debugOutflowPeriods at: http://localhost:5001/family-budget-app-cb59b/us-central1/debugOutflowPeriods"
echo "  - Call createTestOutflows using the test scripts"
echo ""
echo "Press Ctrl+C to stop the emulators"
echo ""

firebase emulators:start
