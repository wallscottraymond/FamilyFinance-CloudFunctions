const fs = require('fs');
const { exec } = require('child_process');

const data = JSON.parse(fs.readFileSync('categories-data.json', 'utf8'));

async function uploadCategory(categoryId, categoryData) {
  return new Promise((resolve, reject) => {
    const curlCommand = `curl -X PATCH "https://firestore.googleapis.com/v1/projects/family-budget-app-cb59b/databases/(default)/documents/categories/${categoryId}" \\
      -H "Authorization: Bearer $(gcloud auth print-access-token)" \\
      -H "Content-Type: application/json" \\
      --data '{
        "fields": {
          "name": {"stringValue": "${categoryData.name}"},
          "primary_plaid_category": {"stringValue": "${categoryData.primary_plaid_category}"},
          "detailed_plaid_category": {"stringValue": "${categoryData.detailed_plaid_category}"},
          "description": {"stringValue": "${categoryData.description.replace(/"/g, '\\"')}"},
          "type": {"stringValue": "${categoryData.type}"},
          "second_category": {"stringValue": "${categoryData.second_category}"},
          "first_category": {"stringValue": "${categoryData.first_category}"},
          "overall_category": {"stringValue": "${categoryData.overall_category}"},
          "visible_by_default": {"booleanValue": ${categoryData.visible_by_default}},
          "budget_selection": {"booleanValue": ${categoryData.budget_selection}},
          "income_selection": {"booleanValue": ${categoryData.income_selection}},
          "index": {"integerValue": "${categoryData.index}"}
        }
      }'`;
    
    exec(curlCommand, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error uploading ${categoryId}:`, stderr);
        reject(error);
      } else {
        console.log(`✓ Uploaded ${categoryId}`);
        resolve();
      }
    });
  });
}

async function uploadAllCategories() {
  const categories = data.categories;
  const categoryIds = Object.keys(categories);
  
  console.log(`Uploading ${categoryIds.length} categories...`);
  
  for (let i = 0; i < categoryIds.length; i++) {
    const categoryId = categoryIds[i];
    const categoryData = categories[categoryId];
    
    try {
      await uploadCategory(categoryId, categoryData);
      
      // Add small delay to avoid rate limiting
      if (i < categoryIds.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (error) {
      console.error(`Failed to upload ${categoryId}:`, error.message);
    }
  }
  
  console.log('Upload complete!');
}

uploadAllCategories();