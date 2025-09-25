const { exec } = require('child_process');

const command = 'firebase functions:call uploadCategoriesData --data="{}"';

console.log('Calling uploadCategoriesData function via Firebase CLI...');

exec(command, (error, stdout, stderr) => {
  if (error) {
    console.error('Error:', error.message);
    return;
  }
  
  if (stderr) {
    console.error('Stderr:', stderr);
    return;
  }
  
  console.log('Success!');
  console.log('Output:', stdout);
});