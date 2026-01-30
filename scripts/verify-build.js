#!/usr/bin/env node

import { existsSync } from 'fs';
import { resolve } from 'path';

console.log('🔍 Verifying build output...');

const serverPath = resolve('dist/server.js');
const blockchainDir = resolve('dist/blockchain');
const simpleEscrowPath = resolve('dist/blockchain/SimpleEscrow.json');

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