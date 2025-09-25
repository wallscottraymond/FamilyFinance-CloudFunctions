#!/usr/bin/env node

/**
 * Script to call the debugOutflowPeriods function
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

async function debugOutflowPeriods() {
  try {
    console.log('🔍 Calling debugOutflowPeriods function...');
    
    const url = `${BASE_URL}/debugOutflowPeriods`;
    
    const response = await makeHttpRequest(url, 'GET', null);
    
    console.log(`Response status: ${response.statusCode}`);
    
    if (response.statusCode === 200) {
      const result = response.data;
      console.log('✅ debugOutflowPeriods completed successfully!');
      
      if (result.success && result.data) {
        const data = result.data;
        console.log('📊 Outflow Periods Debug Results:');
        console.log(`   Total periods: ${data.total}`);
        console.log(`   Unique users: ${data.users.length}`);
        console.log(`   Current periods: ${data.currentPeriods.length}`);
        console.log('');
        
        if (data.users.length > 0) {
          console.log('👥 Users with outflow periods:');
          data.users.forEach(userId => {
            console.log(`   - ${userId}`);
          });
          console.log('');
        }
        
        if (data.currentPeriods.length > 0) {
          console.log('📅 Current outflow periods:');
          data.currentPeriods.forEach(period => {
            console.log(`   - ${period.id}: $${period.billAmount} (${period.periodStartDate} to ${period.periodEndDate})`);
            console.log(`     User: ${period.userId}, Due: ${period.isDuePeriod}, Active: ${period.isActive}`);
          });
          console.log('');
        }
        
        if (data.currentUserResults) {
          console.log(`🎯 Current User (${data.currentUserResults.userId}) Results:`);
          console.log(`   Found ${data.currentUserResults.count} outflow periods`);
          if (data.currentUserResults.periods.length > 0) {
            console.log('   Periods:');
            data.currentUserResults.periods.forEach(period => {
              console.log(`   - ${period.id}: $${period.billAmount}`);
              console.log(`     Description: ${period.description}`);
              console.log(`     OutflowId: ${period.outflowId}`);
              console.log(`     PeriodId: ${period.periodId}, SourcePeriodId: ${period.sourcePeriodId}`);
            });
          }
          console.log('');
        }
        
        if (data.periods.length > 0) {
          console.log('📋 All outflow periods (first 10):');
          data.periods.slice(0, 10).forEach(period => {
            console.log(`   - ${period.id}: $${period.billAmount} (${period.isCurrent ? 'CURRENT' : 'NOT CURRENT'})`);
            console.log(`     User: ${period.userId}, Period: ${period.periodStartDate} to ${period.periodEndDate}`);
            console.log(`     PeriodId: ${period.periodId || 'UNDEFINED'}, SourcePeriodId: ${period.sourcePeriodId || 'UNDEFINED'}`);
            console.log(`     HasFields: periodId=${period.hasFields?.periodId}, sourcePeriodId=${period.hasFields?.sourcePeriodId}, userId=${period.hasFields?.userId}, isActive=${period.hasFields?.isActive}`);
          });
        }
      } else {
        console.log('Raw response:', result);
      }
      
      return true;
    } else {
      console.log('❌ Failed to debug outflow periods');
      console.log('Response:', response.data);
      return false;
    }
  } catch (error) {
    console.error('❌ Error calling debugOutflowPeriods:', error.message);
    return false;
  }
}

async function main() {
  console.log('🚀 Debugging outflow periods...');
  console.log(`Project: ${PROJECT_ID}`);
  console.log(`Region: ${REGION}`);
  console.log('');
  
  const success = await debugOutflowPeriods();
  
  console.log('');
  
  if (success) {
    console.log('🎉 Debug completed successfully!');
  } else {
    console.log('❌ Debug failed');
  }
  
  process.exit(0);
}

main().catch(error => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});