#!/usr/bin/env node

/**
 * Test the uploadCategoriesData Cloud Function
 */

const admin = require('firebase-admin');
const { getFunctions, connectFunctionsEmulator } = require('firebase/functions');
const { initializeApp } = require('firebase/app');
const { httpsCallable } = require('firebase/functions');
const path = require('path');

// Initialize Firebase Admin
const serviceAccount = require(path.join(process.env.HOME, 'google-service-account-key.json'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// Firebase client config for calling cloud functions
const firebaseConfig = {
  projectId: 'family-budget-app-cb59b',
};

const app = initializeApp(firebaseConfig);
const functions = getFunctions(app, 'us-central1');

const db = admin.firestore();

async function checkExistingCategories() {
  try {
    console.log('🔍 Checking existing categories in database...');
    
    const categoriesSnapshot = await db.collection('categories').get();
    console.log(`Found ${categoriesSnapshot.size} existing categories`);
    
    if (categoriesSnapshot.size > 0) {
      console.log('Sample categories:');
      categoriesSnapshot.docs.slice(0, 5).forEach(doc => {
        const data = doc.data();
        console.log(`  - ${doc.id}: ${data.name} (${data.type})`);
      });
    }
    
    return categoriesSnapshot.size;
  } catch (error) {
    console.error('Error checking categories:', error);
    return 0;
  }
}

async function callUploadCategoriesFunction() {
  try {
    console.log('🔄 Calling uploadCategoriesData function...');
    
    // Create callable function reference
    const uploadCategories = httpsCallable(functions, 'uploadCategoriesData');
    
    // Call the function
    const result = await uploadCategories();
    
    console.log('✅ Function executed successfully');
    console.log('Result:', result.data);
    
    return result.data;
  } catch (error) {
    console.error('❌ Error calling function:', error);
    if (error.code) {
      console.error('Error code:', error.code);
    }
    if (error.message) {
      console.error('Error message:', error.message);
    }
    throw error;
  }
}

async function main() {
  console.log('🚀 Testing uploadCategoriesData function...');
  
  try {
    // Check current state
    const existingCount = await checkExistingCategories();
    console.log(`\n📊 Current categories count: ${existingCount}`);
    
    // Call the upload function
    const result = await callUploadCategoriesFunction();
    
    // Wait a moment for data to propagate
    console.log('\n⏳ Waiting for data to propagate...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Check final state
    const finalCount = await checkExistingCategories();
    console.log(`\n📊 Final categories count: ${finalCount}`);
    
    if (result && result.success && result.count === 104) {
      console.log('\n✅ SUCCESS: All 104 categories uploaded successfully!');
      console.log(`Categories uploaded: ${result.count}`);
    } else {
      console.log('\n⚠️  Function completed but results may be incomplete');
      console.log('Result:', result);
    }
    
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});