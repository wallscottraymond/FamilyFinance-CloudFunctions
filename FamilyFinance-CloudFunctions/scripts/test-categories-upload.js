// Test upload with just a few categories
const admin = require('firebase-admin');

// Initialize Firebase Admin with project ID only (will use Firebase CLI auth)
admin.initializeApp({
  projectId: 'family-budget-app-cb59b',
  credential: admin.credential.applicationDefault()
});

const db = admin.firestore();

const testCategories = {
  'FOOD_AND_DRINK_GROCERIES': {
    name: 'FOOD_AND_DRINK_GROCERIES',
    primary_plaid_category: 'FOOD_AND_DRINK',
    detailed_plaid_category: 'FOOD_AND_DRINK_GROCERIES',
    description: 'Purchases for fresh produce and groceries, including farmers\' markets',
    type: 'Outflow',
    second_category: 'Groceries',
    first_category: 'Groceries',
    overall_category: 'Groceries',
    visible_by_default: true,
    budget_selection: true,
    income_selection: false,
    index: 40
  },
  'FOOD_AND_DRINK_RESTAURANT': {
    name: 'FOOD_AND_DRINK_RESTAURANT',
    primary_plaid_category: 'FOOD_AND_DRINK',
    detailed_plaid_category: 'FOOD_AND_DRINK_RESTAURANT',
    description: 'Dining expenses for restaurants, bars, gastropubs, and diners',
    type: 'Outflow',
    second_category: 'Eating Out',
    first_category: 'Food and Drink',
    overall_category: 'Eating Out',
    visible_by_default: true,
    budget_selection: true,
    income_selection: false,
    index: 41
  },
  'TRANSPORTATION_GAS': {
    name: 'TRANSPORTATION_GAS',
    primary_plaid_category: 'TRANSPORTATION',
    detailed_plaid_category: 'TRANSPORTATION_GAS',
    description: 'Purchases at a gas station',
    type: 'Outflow',
    second_category: 'Gas',
    first_category: 'Transportation',
    overall_category: 'Transportation',
    visible_by_default: true,
    budget_selection: true,
    income_selection: false,
    index: 88
  }
};

async function uploadTestCategories() {
  try {
    console.log('Testing Firestore connection...');
    const batch = db.batch();
    
    Object.keys(testCategories).forEach((categoryId) => {
      const categoryRef = db.collection('categories').doc(categoryId);
      batch.set(categoryRef, testCategories[categoryId]);
    });
    
    await batch.commit();
    console.log('✅ Test upload successful! Uploaded 3 test categories');
    
    // Now upload all categories
    console.log('Loading all categories...');
    const fs = require('fs');
    const categoriesJSON = fs.readFileSync('categories-data.json', 'utf8');
    const fullCategoriesData = JSON.parse(categoriesJSON).categories;
    
    const categories = Object.keys(fullCategoriesData);
    console.log(`Found ${categories.length} categories to upload`);
    
    // Upload in batches of 500 (Firestore limit)
    const batchSize = 500;
    let uploadedCount = 0;
    
    for (let i = 0; i < categories.length; i += batchSize) {
      const batchCategories = categories.slice(i, i + batchSize);
      const batch = db.batch();
      
      batchCategories.forEach((categoryId) => {
        const categoryRef = db.collection('categories').doc(categoryId);
        batch.set(categoryRef, fullCategoriesData[categoryId]);
      });
      
      await batch.commit();
      uploadedCount += batchCategories.length;
      console.log(`Uploaded batch: ${uploadedCount}/${categories.length} categories`);
    }
    
    console.log('✅ Successfully uploaded all categories!');
    console.log(`📊 Total categories uploaded: ${uploadedCount}`);
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    process.exit(0);
  }
}

uploadTestCategories();