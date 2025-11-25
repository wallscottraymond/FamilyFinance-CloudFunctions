#!/usr/bin/env node

/**
 * Script to call the temporary adminSetup function
 */

const https = require('https');

const PROJECT_ID = 'family-budget-app-cb59b';
const REGION = 'us-central1';
const FUNCTION_URL = `https://${REGION}-${PROJECT_ID}.cloudfunctions.net/adminSetup`;

const USER_ID = 'HIXw4Pp4FpX72aHU4BHbF9o54no1';

function makeHttpRequest(url, method = 'POST', data = null) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: method,
      headers: {
        'Content-Type': 'application/json'
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

async function runAdminSetup() {
  try {
    console.log('🚀 Starting admin setup...');
    console.log(`   Function URL: ${FUNCTION_URL}`);
    console.log(`   Target user ID: ${USER_ID}`);
    console.log('');

    const requestData = {
      userId: USER_ID,
      generatePeriods: true
    };

    console.log('📡 Calling adminSetup function...');
    const response = await makeHttpRequest(FUNCTION_URL, 'POST', requestData);

    console.log(`   Response status: ${response.statusCode}`);

    if (response.statusCode === 200 && response.data.success) {
      const result = response.data.data;
      
      console.log('');
      console.log('🎉 Admin setup completed successfully!');
      console.log('');
      console.log('👤 User Details:');
      console.log(`   ID: ${result.user.id}`);
      console.log(`   Email: ${result.user.email}`);
      console.log(`   Display Name: ${result.user.displayName}`);
      console.log(`   Role: ${result.user.role}`);
      console.log(`   Profile Created: ${result.user.created ? 'Yes' : 'No (Updated existing)'}`);
      
      if (result.periodsGenerated && result.periods) {
        console.log('');
        console.log('📅 Source Periods Generated:');
        console.log(`   Total periods: ${result.periods.totalPeriods}`);
        console.log(`   Monthly periods: ${result.periods.byType.monthly}`);
        console.log(`   Weekly periods: ${result.periods.byType.weekly}`);
        console.log(`   Bi-monthly periods: ${result.periods.byType.biMonthly}`);
        console.log(`   Current periods: ${result.periods.currentPeriods}`);
        console.log(`   Year range: ${result.periods.yearRange}`);
      }
      
      console.log('');
      console.log('✅ Next Steps:');
      console.log('   1. The user now has admin role with custom claims');
      console.log('   2. All source periods are available for budget creation');
      console.log('   3. The user should log out and back in to refresh their tokens');
      console.log('   4. Consider removing the adminSetup function for security');
      
      return true;
    } else {
      console.log('');
      console.log('❌ Admin setup failed');
      console.log('   Response:', JSON.stringify(response.data, null, 2));
      return false;
    }

  } catch (error) {
    console.error('❌ Error running admin setup:', error.message);
    return false;
  }
}

async function main() {
  console.log('🔧 Family Finance Admin Setup');
  console.log('===============================');
  console.log('');

  const success = await runAdminSetup();

  if (success) {
    console.log('');
    console.log('🚨 IMPORTANT SECURITY NOTE:');
    console.log('   The adminSetup function bypasses authentication and should be');
    console.log('   removed after completing the initial setup to prevent misuse.');
    console.log('');
    console.log('   To remove it, run:');
    console.log('   firebase functions:delete adminSetup');
    
    process.exit(0);
  } else {
    process.exit(1);
  }
}

// Run the script
main().catch(error => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});