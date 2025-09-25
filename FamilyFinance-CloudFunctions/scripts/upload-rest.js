const fs = require('fs');
const https = require('https');
const { exec } = require('child_process');

// Get Firebase ID token
function getFirebaseToken() {
  return new Promise((resolve, reject) => {
    exec('firebase auth:export token.json --project family-budget-app-cb59b', (error, stdout, stderr) => {
      if (error) {
        console.log('Trying alternative token method...');
        // Try getting token via firebase login
        exec('firebase login:ci', (error2, stdout2, stderr2) => {
          if (error2) {
            reject(new Error('Could not authenticate with Firebase'));
          } else {
            resolve(stdout2.trim());
          }
        });
      } else {
        try {
          const tokenData = JSON.parse(fs.readFileSync('token.json', 'utf8'));
          resolve(tokenData.idToken);
        } catch (e) {
          reject(e);
        }
      }
    });
  });
}

async function uploadCategoriesDirectly() {
  try {
    const data = JSON.parse(fs.readFileSync('categories-data.json', 'utf8'));
    const categories = data.categories;
    
    console.log('Loading categories directly with admin privileges...');
    
    // We'll use a simple admin function approach
    const adminScript = `
const admin = require('firebase-admin');
const serviceAccount = require('../family-budget-app-cb59b-firebase-adminsdk-7l0qu-5fd2b9e826.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const categories = ${JSON.stringify(categories)};

async function uploadCategories() {
  const batch = db.batch();
  
  Object.keys(categories).forEach((categoryId) => {
    const categoryRef = db.collection('categories').doc(categoryId);
    batch.set(categoryRef, categories[categoryId]);
  });
  
  await batch.commit();
  console.log('Successfully uploaded', Object.keys(categories).length, 'categories');
  process.exit(0);
}

uploadCategories().catch(console.error);
`;
    
    fs.writeFileSync('temp-admin-upload.js', adminScript);
    console.log('Created temporary admin upload script');
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

uploadCategoriesDirectly();