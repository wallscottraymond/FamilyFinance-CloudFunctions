// This script should be run using firebase functions:shell or firebase emulators:exec
const fs = require('fs');
const csv = require('csv-parser');

const csvFilePath = '/Users/scottwall/Downloads/alpacaCategories - alpacaCategories.csv';

function uploadCategories() {
  return new Promise((resolve, reject) => {
    const categories = [];
    
    fs.createReadStream(csvFilePath)
      .pipe(csv())
      .on('data', (row) => {
        const category = {
          name: row.cateogry_id,
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
          const admin = require('firebase-admin');
          const db = admin.firestore();
          
          // Upload categories to Firestore in batches
          const batch = db.batch();
          
          categories.forEach((category) => {
            const categoryRef = db.collection('categories').doc(category.name);
            batch.set(categoryRef, category);
          });
          
          await batch.commit();
          console.log('Successfully uploaded all categories to Firestore');
          resolve(categories.length);
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

module.exports = { uploadCategories };