// Call the uploadCategoriesData function
const https = require('https');

// Function URL from Firebase deployment
const functionUrl = 'https://uploadcategoriesdata-xrjkrpnjjq-uc.a.run.app';

const requestData = JSON.stringify({
  data: {}
});

const options = {
  hostname: 'uploadcategoriesdata-xrjkrpnjjq-uc.a.run.app',
  port: 443,
  path: '/',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': requestData.length
  }
};

console.log('Calling uploadCategoriesData function...');

const req = https.request(options, (res) => {
  let data = '';
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    try {
      const response = JSON.parse(data);
      if (response.result && response.result.success) {
        console.log('✅ Categories uploaded successfully!');
        console.log(`📊 Total categories uploaded: ${response.result.count}`);
      } else {
        console.log('❌ Upload failed:', response);
      }
    } catch (e) {
      console.log('Response:', data);
    }
  });
});

req.on('error', (error) => {
  console.error('Error:', error);
});

req.write(requestData);
req.end();