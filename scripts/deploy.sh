#!/bin/bash

# Family Finance Cloud Functions Deployment Script
set -e

echo "🚀 Family Finance Cloud Functions Deployment"
echo "============================================="

# Check if Firebase CLI is installed
if ! command -v firebase &> /dev/null; then
    echo "❌ Firebase CLI is not installed. Please install it first:"
    echo "   npm install -g firebase-tools"
    exit 1
fi

# Check if user is logged in to Firebase
if ! firebase login:list &> /dev/null; then
    echo "🔐 Please login to Firebase first:"
    firebase login
fi

echo "📦 Installing dependencies..."
npm install

echo "🔍 Running linter..."
npm run lint

echo "🏗️  Building TypeScript..."
npm run build

echo "🔍 Checking build output..."
if [ ! -d "lib" ]; then
    echo "❌ Build failed - lib directory not found"
    exit 1
fi

echo "📋 Current Firebase project:"
firebase use

echo "🚀 Deploying to Firebase..."
firebase deploy --only functions

echo "✅ Deployment completed successfully!"
echo ""
echo "📚 View your functions in the Firebase Console:"
echo "   https://console.firebase.google.com/project/$(firebase use | grep 'Now using' | cut -d' ' -f5 | tr -d '()')/functions"
echo ""
echo "📊 Monitor function logs:"
echo "   firebase functions:log"