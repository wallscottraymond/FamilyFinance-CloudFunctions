const admin = require('firebase-admin');

// Initialize the Firebase Admin SDK
admin.initializeApp({
  projectId: 'family-budget-app-cb59b'
});

async function callUploadCategoriesFunction() {
  try {
    // Import the function
    const { uploadCategoriesData } = require('../lib/functions/admin/uploadCategoriesData');
    
    // Call the function directly
    const result = await uploadCategoriesData({
      data: {},
      auth: null,
      rawRequest: null
    });
    
    console.log('✅ Categories uploaded successfully!');
    console.log(`📊 Total categories uploaded: ${result.count}`);
  } catch (error) {
    console.error('❌ Error uploading categories:', error.message);
  } finally {
    process.exit(0);
  }
}

callUploadCategoriesFunction();