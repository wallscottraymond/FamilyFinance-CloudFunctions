#!/usr/bin/env node

/**
 * Script to call the createTestOutflows function
 */

const https = require('https');

const PROJECT_ID = 'family-budget-app-cb59b';
const REGION = 'us-central1';
const BASE_URL = `https://${REGION}-${PROJECT_ID}.cloudfunctions.net`;

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

async function createTestOutflows() {
  try {
    console.log('🏗️ Creating test outflows...');
    
    const currentUserId = 'IKzBkwEZb6MdJkdDVnVyTFAFj5i1'; // Current auth user
    const url = `${BASE_URL}/createTestOutflows?userId=${currentUserId}`;
    
    const response = await makeHttpRequest(url, 'GET', null);
    
    console.log(`Response status: ${response.statusCode}`);
    
    if (response.statusCode === 200) {
      const result = response.data;
      console.log('✅ createTestOutflows completed successfully!');
      
      if (result.success && result.data) {
        const data = result.data;
        console.log('📊 Test Outflows Creation Results:');
        console.log(`   Target User: ${data.targetUserId}`);
        console.log(`   Outflows Created: ${data.outflowsCreated}`);
        console.log(`   Outflow Periods Created: ${data.outflowPeriodsCreated}`);
        console.log('');
        
        if (data.outflows && data.outflows.length > 0) {
          console.log('💰 Created outflows:');
          data.outflows.forEach(outflow => {
            console.log(`   - ${outflow.description} (${outflow.merchantName}): $${outflow.amount} ${outflow.frequency}`);
          });
          console.log('');
        }
      } else {
        console.log('Raw response:', result);
      }
      
      return true;
    } else {
      console.log('❌ Failed to create test outflows');
      console.log('Response:', response.data);
      return false;
    }
  } catch (error) {
    console.error('❌ Error calling createTestOutflows:', error.message);
    return false;
  }
}

async function main() {
  console.log('🚀 Creating test outflows for current user...');
  console.log(`Project: ${PROJECT_ID}`);
  console.log(`Region: ${REGION}`);
  console.log(`Target User: IKzBkwEZb6MdJkdDVnVyTFAFj5i1`);
  console.log('');
  
  const success = await createTestOutflows();
  
  console.log('');
  
  if (success) {
    console.log('🎉 Test outflows created successfully!');
    console.log('💡 You should now see outflow periods in the mobile app.');
  } else {
    console.log('❌ Failed to create test outflows');
  }
  
  process.exit(0);
}

main().catch(error => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});