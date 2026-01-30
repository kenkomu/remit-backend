#!/usr/bin/env node

import { existsSync } from 'fs';
import { resolve } from 'path';

console.log('🔍 Verifying build output...');

// Check if we're running from src directory (Render) or project root (local)
const isInSrc = process.cwd().endsWith('/src');
const distPath = isInSrc ? resolve('../dist') : resolve('dist');
const serverPath = resolve(distPath, 'server.js');
const blockchainDir = resolve(distPath, 'blockchain');
const simpleEscrowPath = resolve(blockchainDir, 'SimpleEscrow.json');

console.log(`Working from: ${isInSrc ? 'src directory' : 'project root'}`);
console.log(`Checking for dist directory: ${distPath}`);

if (!existsSync(distPath)) {
  console.error('❌ dist directory not found!');
  process.exit(1);
}
console.log('✅ dist directory exists');

console.log(`Checking for server file: ${serverPath}`);
if (!existsSync(serverPath)) {
  console.error('❌ dist/server.js not found!');
  process.exit(1);
}
console.log('✅ dist/server.js exists');

console.log(`Checking for blockchain directory: ${blockchainDir}`);
if (!existsSync(blockchainDir)) {
  console.error('❌ dist/blockchain directory not found!');
  process.exit(1);
}
console.log('✅ dist/blockchain directory exists');

console.log(`Checking for contract artifact: ${simpleEscrowPath}`);
if (!existsSync(simpleEscrowPath)) {
  console.error('❌ dist/blockchain/SimpleEscrow.json not found!');
  process.exit(1);
}
console.log('✅ dist/blockchain/SimpleEscrow.json exists');

console.log('🎉 Build verification successful!');