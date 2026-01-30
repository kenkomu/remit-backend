#!/usr/bin/env node

// Alternative start script for Render deployment
import { resolve } from 'path';
import { existsSync } from 'fs';

const serverPath = resolve('./dist/server.js');

console.log(`🚀 Starting server from: ${serverPath}`);
console.log(`Current working directory: ${process.cwd()}`);
console.log(`Server file exists: ${existsSync(serverPath)}`);

if (!existsSync(serverPath)) {
  console.error('❌ Server file not found at:', serverPath);
  console.log('📁 Directory contents:');
  try {
    const { readdirSync } = await import('fs');
    console.log(readdirSync('.'));
    if (existsSync('./dist')) {
      console.log('📁 dist/ contents:');
      console.log(readdirSync('./dist'));
    }
  } catch (error) {
    console.error('Error listing directory contents:', error);
  }
  process.exit(1);
}

// Import and start the server
try {
  await import('./dist/server.js');
} catch (error) {
  console.error('❌ Error starting server:', error);
  process.exit(1);
}