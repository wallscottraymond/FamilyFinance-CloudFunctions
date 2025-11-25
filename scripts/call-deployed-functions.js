#!/usr/bin/env node

/**
 * Script to call deployed Firebase Cloud Functions
 * This uses HTTP calls to the deployed functions
 */

const https = require('https');

const PROJECT_ID = 'family-budget-app-cb59b';
const REGION = 'us-central1';
const BASE_URL = `https://${REGION}-${PROJECT_ID}.cloudfunctions.net`;

const USER_ID = 'HIXw4Pp4FpX72aHU4BHbF9o54no1';

function makeHttpRequest(url, method = 'GET', data = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    if (data && method !== 'GET') {
      const jsonData = JSON.stringify(data);
      options.headers['Content-Length'] = Buffer.byteLength(jsonData);
    }

    const req = https.request(options, (res) => {
      let responseData = '';

      res.on('data', (chunk) => {
        responseData += chunk;
      });

      res.on('end', () => {
        try {
          const parsedData = JSON.parse(responseData);
          resolve({
            statusCode: res.statusCode,
            data: parsedData,
            headers: res.headers
          });
        } catch (error) {
          resolve({
            statusCode: res.statusCode,
            data: responseData,
            headers: res.headers
          });
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    if (data && method !== 'GET') {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

async function checkUserExists() {
  try {
    console.log(`🔍 Checking if user ${USER_ID} exists...`);
    
    const url = `${BASE_URL}/getUserProfile?userId=${USER_ID}`;
    const response = await makeHttpRequest(url);
    
    console.log(`   Response status: ${response.statusCode}`);
    
    if (response.statusCode === 200 && response.data.success) {
      const user = response.data.data;
      console.log(`✅ User found: ${user.email} (${user.displayName})`);
      console.log(`   Current role: ${user.role}`);
      console.log(`   Family ID: ${user.familyId || 'None'}`);
      return { exists: true, user };
    } else if (response.statusCode === 404) {
      console.log(`❌ User ${USER_ID} not found`);
      return { exists: false, user: null };
    } else {
      console.log(`⚠️  Unexpected response:`, response.data);
      return { exists: false, user: null };
    }
  } catch (error) {
    console.error('❌ Error checking user:', error.message);
    return { exists: false, user: null };
  }
}

async function generateSourcePeriods() {
  try {
    console.log('🔧 Calling generateSourcePeriods function...');
    
    const url = `${BASE_URL}/generateSourcePeriods`;
    
    // This function requires admin auth, but since we don't have proper auth setup,
    // let's try calling it and see what happens
    const response = await makeHttpRequest(url, 'POST', {});
    
    console.log(`   Response status: ${response.statusCode}`);
    
    if (response.statusCode === 200 && response.data.success) {
      const summary = response.data.data;
      console.log('✅ Source periods generated successfully!');
      console.log('   Summary:');
      console.log(`     Total periods: ${summary.totalPeriods}`);
      console.log(`     Monthly: ${summary.byType.monthly}`);
      console.log(`     Weekly: ${summary.byType.weekly}`);
      console.log(`     Bi-monthly: ${summary.byType.biMonthly}`);
      console.log(`     Current periods: ${summary.currentPeriods}`);
      console.log(`     Year range: ${summary.yearRange}`);
      return true;
    } else if (response.statusCode === 401) {
      console.log('❌ Authentication required. The function requires admin permissions.');
      console.log('   Response:', response.data);
      return false;
    } else {
      console.log('❌ Failed to generate source periods');
      console.log('   Response:', response.data);
      return false;
    }
  } catch (error) {
    console.error('❌ Error calling generateSourcePeriods:', error.message);
    return false;
  }
}

async function updateUserRoleViaDirect() {
  try {
    console.log(`🔧 Attempting to call updateUserRole function...`);
    
    const url = `${BASE_URL}/updateUserRole`;
    
    const requestData = {
      userId: USER_ID,
      newRole: 'admin'
    };
    
    const response = await makeHttpRequest(url, 'PUT', requestData);
    
    console.log(`   Response status: ${response.statusCode}`);
    
    if (response.statusCode === 200 && response.data.success) {
      const result = response.data.data;
      console.log('✅ User role updated successfully!');
      console.log(`   User: ${result.user.email} (${result.user.displayName})`);
      console.log(`   Old role: ${result.oldRole}`);
      console.log(`   New role: ${result.newRole}`);
      return true;
    } else if (response.statusCode === 401) {
      console.log('❌ Authentication required. This function requires admin permissions.');
      console.log('   Response:', response.data);
      return false;
    } else {
      console.log('❌ Failed to update user role');
      console.log('   Response:', response.data);
      return false;
    }
  } catch (error) {
    console.error('❌ Error calling updateUserRole:', error.message);
    return false;
  }
}

async function checkHealthStatus() {
  try {
    console.log('🔍 Checking Cloud Functions health...');
    
    const url = `${BASE_URL}/healthCheck`;
    const response = await makeHttpRequest(url);
    
    if (response.statusCode === 200) {
      console.log('✅ Cloud Functions are healthy and responding');
      return true;
    } else {
      console.log('⚠️  Cloud Functions health check failed');
      console.log('   Response:', response.data);
      return false;
    }
  } catch (error) {
    console.error('❌ Error checking health:', error.message);
    return false;
  }
}

async function main() {
  console.log('🚀 Starting Cloud Functions interaction...');
  console.log(`   Project: ${PROJECT_ID}`);
  console.log(`   Region: ${REGION}`);
  console.log(`   Target user: ${USER_ID}`);
  console.log('');
  
  // Step 1: Check if functions are healthy
  const healthOk = await checkHealthStatus();
  if (!healthOk) {
    console.error('❌ Cloud Functions are not responding properly. Aborting.');
    process.exit(1);
  }
  
  console.log('');
  
  // Step 2: Check if user exists
  const userCheck = await checkUserExists();
  
  console.log('');
  
  // Step 3: Try to update user role (this will likely fail due to auth)
  const roleUpdateSuccess = await updateUserRoleViaDirect();
  
  console.log('');
  
  // Step 4: Try to generate source periods (this will likely fail due to auth)
  const periodsSuccess = await generateSourcePeriods();
  
  console.log('');
  
  if (!roleUpdateSuccess && !periodsSuccess) {
    console.log('⚠️  Both operations failed due to authentication requirements.');
    console.log('');
    console.log('🔧 Alternative approaches:');
    console.log('   1. Use Firebase Admin SDK with service account key');
    console.log('   2. Temporarily disable authentication in the functions');
    console.log('   3. Create a special admin setup endpoint');
    console.log('   4. Use Firebase CLI with proper authentication');
    console.log('');
    console.log('💡 Recommendation: Use the Firebase Console to:');
    console.log(`   1. Go to Authentication > Users`);
    console.log(`   2. Find user ${USER_ID}`);
    console.log(`   3. Set custom claims: {"role": "admin"}`);
    console.log(`   4. Then run the generateSourcePeriods function`);
  } else {
    console.log('🎉 Some operations completed successfully!');
    if (roleUpdateSuccess) console.log('   ✅ User role updated');
    if (periodsSuccess) console.log('   ✅ Source periods generated');
  }
  
  process.exit(0);
}

// Run the script
main().catch(error => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});