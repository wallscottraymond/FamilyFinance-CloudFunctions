// Manual Firestore REST API call
const https = require('https');

const projectId = 'family-budget-app-cb59b';
const collectionId = 'categories';
const documentId = 'FOOD_AND_DRINK_GROCERIES';

// Sample category data
const categoryData = {
  fields: {
    name: { stringValue: 'FOOD_AND_DRINK_GROCERIES' },
    primary_plaid_category: { stringValue: 'FOOD_AND_DRINK' },
    detailed_plaid_category: { stringValue: 'FOOD_AND_DRINK_GROCERIES' },
    description: { stringValue: 'Purchases for fresh produce and groceries, including farmers markets' },
    type: { stringValue: 'Outflow' },
    second_category: { stringValue: 'Groceries' },
    first_category: { stringValue: 'Groceries' },
    overall_category: { stringValue: 'Groceries' },
    visible_by_default: { booleanValue: true },
    budget_selection: { booleanValue: true },
    income_selection: { booleanValue: false },
    index: { integerValue: '40' }
  }
};

const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collectionId}/${documentId}`;
const requestData = JSON.stringify(categoryData);

console.log('Manual Firestore upload would require authentication token');
console.log('URL:', url);
console.log('Data sample:', JSON.stringify(categoryData, null, 2));

// Since we don't have authentication set up, let's just show what the request would look like
console.log('\\nTo upload manually, you would run:');
console.log(`curl -X PATCH "${url}" \\`);
console.log('  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \\');
console.log('  -H "Content-Type: application/json" \\');
console.log(`  --data '${requestData}'`);

console.log('\\n⚠️  Authentication required - please configure gcloud or Firebase Admin credentials');