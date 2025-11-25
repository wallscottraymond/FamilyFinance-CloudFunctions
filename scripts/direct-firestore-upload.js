const admin = require('firebase-admin');
const fs = require('fs');

// Initialize Firebase Admin with project ID
admin.initializeApp({
  projectId: 'family-budget-app-cb59b'
});

const db = admin.firestore();

async function uploadCategories() {
  try {
    console.log('Reading categories data...');
    const categoriesJSON = fs.readFileSync('categories-data.json', 'utf8');
    const fullCategoriesData = JSON.parse(categoriesJSON).categories;
    
    const categories = Object.keys(fullCategoriesData);
    console.log(`Found ${categories.length} categories to upload`);
    
    // Create batch
    const batch = db.batch();
    
    categories.forEach((categoryId) => {
      const categoryRef = db.collection('categories').doc(categoryId);
      batch.set(categoryRef, fullCategoriesData[categoryId]);
    });
    
    console.log('Uploading to Firestore...');
    await batch.commit();
    
    console.log('✅ Successfully uploaded all categories to Firestore');
    console.log(`📊 Total categories uploaded: ${categories.length}`);
  } catch (error) {
    console.error('❌ Error uploading categories:', error);
  } finally {
    process.exit(0);
  }
}

uploadCategories();