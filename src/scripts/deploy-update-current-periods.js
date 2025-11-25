#!/usr/bin/env node

/**
 * Deploy script specifically for the updateCurrentPeriods scheduled function
 * 
 * Usage:
 *   node src/scripts/deploy-update-current-periods.js
 * 
 * This script:
 * 1. Builds the TypeScript code
 * 2. Deploys only the updateCurrentPeriods function
 * 3. Shows the function's scheduled status
 */

const { execSync } = require('child_process');
const chalk = require('chalk');

console.log(chalk.blue('🚀 Deploying updateCurrentPeriods scheduled function...'));

try {
  // Build the project
  console.log(chalk.yellow('📦 Building TypeScript...'));
  execSync('npm run build', { stdio: 'inherit' });

  // Deploy only the updateCurrentPeriods function
  console.log(chalk.yellow('☁️ Deploying to Firebase...'));
  execSync('firebase deploy --only functions:updateCurrentPeriods', { stdio: 'inherit' });

  console.log(chalk.green('✅ Deployment complete!'));
  console.log(chalk.cyan('📅 The function is scheduled to run daily at midnight UTC'));
  console.log(chalk.cyan('🔍 Monitor logs with: firebase functions:log --only updateCurrentPeriods'));
  
  // Show function status
  console.log(chalk.yellow('📊 Function status:'));
  try {
    execSync('firebase functions:list --filter updateCurrentPeriods', { stdio: 'inherit' });
  } catch (error) {
    console.log(chalk.red('Could not fetch function status. Check Firebase console.'));
  }

} catch (error) {
  console.error(chalk.red('❌ Deployment failed:'), error.message);
  process.exit(1);
}