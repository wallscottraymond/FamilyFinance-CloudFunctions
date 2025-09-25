const admin = require('firebase-admin');
const fs = require('fs');
const csv = require('csv-parser');

// Initialize Firebase Admin
const app = admin.initializeApp({
  projectId: 'family-budget-app-cb59b'
});

const db = admin.firestore();

// Path to the CSV file
const csvFilePath = '/Users/scottwall/Downloads/alpacaCategories - alpacaCategories.csv';

async function uploadCategories() {
  const categories = [];
  
  return new Promise((resolve, reject) => {
    fs.createReadStream(csvFilePath)
      .pipe(csv())
      .on('data', (row) => {
        // Convert string boolean values to actual booleans
        const category = {
          name: row.cateogry_id, // Note: keeping the original field name despite typo
          primary_plaid_category: row.primary_plaid_category,
          detailed_plaid_category: row.detailed_plaid_category,
          description: row.description,
          type: row.type,
          second_category: row.second_category,
          first_category: row.first_category,
          overall_category: row.overall_category,
          visible_by_default: row.visible_by_default === 'TRUE',
          budget_selection: row.budget_selection === 'TRUE',
          income_selection: row.income_selection === 'TRUE',
          index: parseInt(row.index)
        };
        categories.push(category);
      })
      .on('end', async () => {
        console.log(`Parsed ${categories.length} categories from CSV`);
        
        try {
          // Upload categories to Firestore
          const batch = db.batch();
          
          categories.forEach((category) => {
            const categoryRef = db.collection('categories').doc(category.name);
            batch.set(categoryRef, category);
          });
          
          await batch.commit();
          console.log('Successfully uploaded all categories to Firestore');
          resolve();
        } catch (error) {
          console.error('Error uploading categories:', error);
          reject(error);
        }
      })
      .on('error', (error) => {
        console.error('Error reading CSV file:', error);
        reject(error);
      });
  });
}

uploadCategories()
  .then(() => {
    console.log('Category upload complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Upload failed:', error);
    process.exit(1);
  });