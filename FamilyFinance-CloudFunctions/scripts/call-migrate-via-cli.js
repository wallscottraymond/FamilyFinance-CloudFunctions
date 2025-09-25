const { exec } = require('child_process');

async function callMigrationFunction() {
  console.log('Calling migrateTransactionsToSplits function via Firebase CLI...');
  
  const command = `firebase functions:call migrateTransactionsToSplits --data '{}'`;
  
  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error('Error calling function:', error);
      return;
    }
    
    if (stderr) {
      console.error('Stderr:', stderr);
    }
    
    console.log('Function result:');
    console.log(stdout);
  });
}

callMigrationFunction();