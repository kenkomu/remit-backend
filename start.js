#!/usr/bin/env node

// Debug script to find the actual server location
import { resolve } from 'path';
import { existsSync } from 'fs';
import { execSync } from 'child_process';

console.log('🔍 DEBUGGING RENDER DIRECTORY STRUCTURE');
console.log('Current working directory:', process.cwd());

try {
  console.log('\n📁 Listing current directory:');
  console.log(execSync('ls -la', { encoding: 'utf-8' }));

  console.log('\n📁 Looking for dist directories:');
  console.log(execSync('find . -name "dist" -type d 2>/dev/null || echo "No dist directories found"', { encoding: 'utf-8' }));

  console.log('\n📁 Looking for server.js files:');
  console.log(execSync('find . -name "server.js" -type f 2>/dev/null || echo "No server.js files found"', { encoding: 'utf-8' }));

  console.log('\n📁 Check if build actually ran - looking for any .js files:');
  console.log(execSync('find . -name "*.js" -not -path "./node_modules/*" 2>/dev/null || echo "No JS files found outside node_modules"', { encoding: 'utf-8' }));

  console.log('\n🔧 Running build manually to see what happens:');
  console.log(execSync('npm run build', { encoding: 'utf-8' }));

  console.log('\n📁 After build - listing current directory again:');
  console.log(execSync('ls -la', { encoding: 'utf-8' }));

  console.log('\n📁 After build - looking for dist:');
  console.log(execSync('find . -name "dist" -type d 2>/dev/null || echo "Still no dist found"', { encoding: 'utf-8' }));

  console.log('\n📁 After build - looking for server.js:');
  const serverFiles = execSync('find . -name "server.js" -type f 2>/dev/null || echo "No server.js found"', { encoding: 'utf-8' });
  console.log(serverFiles);

  // Try to find and run the server
  const serverPath = serverFiles.split('\n').find(line => line.includes('server.js') && !line.includes('node_modules'));
  if (serverPath && serverPath.trim()) {
    console.log(`\n🚀 Found server at: ${serverPath.trim()}`);
    console.log('Starting server...');
    await import(resolve(serverPath.trim()));
  } else {
    console.error('❌ No server.js file found after build!');
    process.exit(1);
  }

} catch (error) {
  console.error('Error during debugging:', error.message);
  process.exit(1);
}