#!/usr/bin/env node

// Simple script to call the clearAndRegeneratePeriods cloud function
// This is a temporary solution since we can't authenticate easily with admin

const https = require('https');

const FUNCTION_URL = 'https://clearandregenerateperiods-r74y562qfq-uc.a.run.app';

async function callRegeneratePeriods() {
  console.log('🔄 Calling clearAndRegeneratePeriods cloud function...');
  
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({});
    
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
      },
    };

    const req = https.request(FUNCTION_URL, options, (res) => {
      let responseBody = '';
      
      res.on('data', (chunk) => {
        responseBody += chunk;
      });
      
      res.on('end', () => {
        console.log(`Response status: ${res.statusCode}`);
        console.log('Response body:', responseBody);
        
        if (res.statusCode === 200) {
          console.log('✅ Successfully called clearAndRegeneratePeriods');
          resolve(responseBody);
        } else {
          console.log(`❌ Function call failed with status ${res.statusCode}`);
          console.log('Response:', responseBody);
          reject(new Error(`HTTP ${res.statusCode}: ${responseBody}`));
        }
      });
    });

    req.on('error', (error) => {
      console.error('❌ Error making request:', error);
      reject(error);
    });

    req.write(data);
    req.end();
  });
}

// Main execution
async function main() {
  try {
    await callRegeneratePeriods();
    console.log('🎉 Period regeneration completed!');
    process.exit(0);
  } catch (error) {
    console.error('💥 Script failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}