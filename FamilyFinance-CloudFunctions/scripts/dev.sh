#!/bin/bash

# Family Finance Cloud Functions Development Script
set -e

echo "🛠️  Family Finance Cloud Functions Development"
echo "============================================="

# Check if Firebase CLI is installed
if ! command -v firebase &> /dev/null; then
    echo "❌ Firebase CLI is not installed. Please install it first:"
    echo "   npm install -g firebase-tools"
    exit 1
fi

echo "📦 Installing dependencies..."
npm install

echo "🏗️  Initial build..."
npm run build

echo "🔥 Starting Firebase emulators..."
echo ""
echo "Available endpoints will be:"
echo "  • Functions: http://localhost:5001"
echo "  • Firestore: http://localhost:8080"
echo "  • Emulator UI: http://localhost:4000"
echo ""
echo "Press Ctrl+C to stop the emulators"
echo ""

# Start emulators with functions and firestore
firebase emulators:start --only functions,firestore