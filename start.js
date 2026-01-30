#!/usr/bin/env node

// Alternative start script for Render deployment
import { resolve, join } from 'path';
import { existsSync, readdirSync } from 'fs';

console.log(`🚀 Render Deployment Debug Information`);
console.log(`Current working directory: ${process.cwd()}`);
console.log(`Node.js version: ${process.version}`);
console.log(`Platform: ${process.platform}`);

// Render is running from /opt/render/project/src, so we need to go up one level
const projectRoot = resolve('..');
const srcDir = resolve('.');

console.log(`\n📁 Project root: ${projectRoot}`);
console.log(`📁 Source directory: ${srcDir}`);

// Try multiple possible locations for the server file
const possiblePaths = [
  resolve('./dist/server.js'),                    // ./dist/server.js (from src)
  resolve('../dist/server.js'),                   // ../dist/server.js (from project root)
  join(projectRoot, 'dist', 'server.js'),        // /opt/render/project/dist/server.js
  join(srcDir, 'dist', 'server.js'),             // /opt/render/project/src/dist/server.js
];

console.log('\n📁 Checking possible server locations:');
let serverPath = null;

for (const path of possiblePaths) {
  const exists = existsSync(path);
  console.log(`${exists ? '✅' : '❌'} ${path}`);
  if (exists && !serverPath) {
    serverPath = path;
  }
}

// List directory contents for debugging
console.log('\n📁 Current directory (src) contents:');
try {
  console.log(readdirSync('.').join(', '));
  
  console.log('\n📁 Project root contents:');
  console.log(readdirSync('..').join(', '));
  
  if (existsSync('./dist')) {
    console.log('\n📁 ./dist/ (from src) contents:');
    console.log(readdirSync('./dist').join(', '));
  }
  
  if (existsSync('../dist')) {
    console.log('\n📁 ../dist/ (from project root) contents:');
    console.log(readdirSync('../dist').join(', '));
  }
  
} catch (error) {
  console.error('Error listing directory contents:', error);
}

if (!serverPath) {
  console.error('\n❌ Server file not found in any expected location!');
  console.error('This suggests the build process did not complete successfully.');
  console.error('Expected locations checked:', possiblePaths);
  process.exit(1);
}

console.log(`\n🎯 Using server file: ${serverPath}`);

// Import and start the server
try {
  await import(serverPath);
} catch (error) {
  console.error('❌ Error starting server:', error);
  console.error('Stack trace:', error.stack);
  process.exit(1);
}