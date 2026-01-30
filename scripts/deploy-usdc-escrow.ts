#!/usr/bin/env tsx

/**
 * Deployment script for SimpleEscrowUSDC contract on Base network
 * 
 * Usage: 
 *   npx tsx scripts/deploy-usdc-escrow.ts
 * 
 * Environment Variables Required:
 * - BASE_RPC_URL: Base network RPC endpoint
 * - BASE_PRIVATE_KEY: Deployer wallet private key
 * - BASE_USDC_CONTRACT: USDC contract address on Base (0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913)
 */

import { ethers } from 'ethers';
import fs from 'fs';
import { pool } from '../src/services/database.js';

const BASE_RPC_URL = process.env.BASE_RPC_URL;
const PRIVATE_KEY = process.env.BASE_PRIVATE_KEY;
const BASE_USDC_CONTRACT = process.env.BASE_USDC_CONTRACT || '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

if (!BASE_RPC_URL || !PRIVATE_KEY) {
  console.error('❌ Missing required environment variables: BASE_RPC_URL, BASE_PRIVATE_KEY');
  process.exit(1);
}

// SimpleEscrowUSDC bytecode (compiled contract)
// Note: In a real deployment, you would compile the contract using Hardhat or similar
const SIMPLE_ESCROW_USDC_BYTECODE = `
// Contract bytecode would go here
// For now, this is a placeholder - you would need to compile the SimpleEscrowUSDC.sol contract
// using a framework like Hardhat to get the actual bytecode
`.trim();

const SIMPLE_ESCROW_USDC_ABI = JSON.parse(
  fs.readFileSync(new URL('../src/blockchain/SimpleEscrowUSDC.json', import.meta.url), 'utf-8')
).abi;

async function deployContract() {
  console.log('🚀 Starting SimpleEscrowUSDC deployment to Base network');
  
  // Initialize provider and wallet
  const provider = new ethers.JsonRpcProvider(BASE_RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY!, provider);
  
  console.log('📋 Deployer address:', wallet.address);
  
  // Check deployer balance
  const balance = await provider.getBalance(wallet.address);
  console.log('💰 Deployer ETH balance:', ethers.formatEther(balance));
  
  if (balance < ethers.parseEther('0.001')) {
    console.error('❌ Insufficient ETH balance for deployment');
    process.exit(1);
  }
  
  try {
    // Estimate gas for deployment
    console.log('⛽ Estimating deployment gas...');
    
    // Create contract factory
    const contractFactory = new ethers.ContractFactory(
      SIMPLE_ESCROW_USDC_ABI,
      SIMPLE_ESCROW_USDC_BYTECODE,
      wallet
    );
    
    // Deploy contract
    console.log('📦 Deploying SimpleEscrowUSDC contract...');
    console.log('🪙 USDC Contract Address:', BASE_USDC_CONTRACT);
    
    const deployTx = await contractFactory.deploy(BASE_USDC_CONTRACT);
    
    console.log('📤 Deployment transaction sent:', deployTx.deploymentTransaction()?.hash);
    console.log('⏳ Waiting for confirmation...');
    
    const contract = await deployTx.waitForDeployment();
    const contractAddress = await contract.getAddress();
    const deploymentTx = deployTx.deploymentTransaction();
    
    if (!deploymentTx) {
      throw new Error('Deployment transaction not found');
    }
    
    const receipt = await deploymentTx.wait();
    
    if (!receipt) {
      throw new Error('Transaction receipt not found');
    }
    
    console.log('✅ Contract deployed successfully!');
    console.log('📍 Contract Address:', contractAddress);
    console.log('🔗 Transaction Hash:', receipt.hash);
    console.log('🧱 Block Number:', receipt.blockNumber);
    console.log('⛽ Gas Used:', receipt.gasUsed.toString());
    console.log('💰 Gas Price:', ethers.formatUnits(receipt.gasPrice || 0, 'gwei'), 'gwei');
    
    // Verify contract setup
    console.log('🔍 Verifying contract setup...');
    const contractInterface = new ethers.Contract(contractAddress, SIMPLE_ESCROW_USDC_ABI, wallet);
    const usdcTokenAddress = await contractInterface.usdcToken();
    const nextEscrowId = await contractInterface.nextEscrowId();
    
    console.log('✅ USDC Token Address:', usdcTokenAddress);
    console.log('📊 Next Escrow ID:', nextEscrowId.toString());
    
    if (usdcTokenAddress.toLowerCase() !== BASE_USDC_CONTRACT.toLowerCase()) {
      console.error('❌ USDC token address mismatch!');
      process.exit(1);
    }
    
    // Track deployment in database
    console.log('📝 Recording deployment in database...');
    
    try {
      await pool.query(
        `
        INSERT INTO smart_contract_deployments (
          contract_name, contract_address, network, deployer_address,
          deployment_tx_hash, block_number, gas_used, deployment_cost_wei,
          usdc_token_address, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
        `,
        [
          'SimpleEscrowUSDC',
          contractAddress,
          'base',
          wallet.address,
          receipt.hash,
          receipt.blockNumber,
          receipt.gasUsed.toString(),
          (receipt.gasUsed * (receipt.gasPrice || BigInt(0))).toString(),
          usdcTokenAddress,
        ]
      );
      
      console.log('✅ Deployment recorded in database');
    } catch (dbError) {
      console.warn('⚠️ Failed to record deployment in database:', dbError);
    }
    
    console.log('\n🎉 Deployment completed successfully!');
    console.log('📄 Update your .env file with:');
    console.log(`SIMPLE_ESCROW_ADDRESS=${contractAddress}`);
    console.log('\n🔧 Next steps:');
    console.log('1. Update your environment variables');
    console.log('2. Fund the deployer wallet with USDC for testing');
    console.log('3. Test escrow creation and payments');
    console.log('4. Start the event monitoring service');
    
  } catch (error) {
    console.error('❌ Deployment failed:', error);
    
    if (error instanceof Error) {
      if (error.message.includes('insufficient funds')) {
        console.error('💡 Solution: Add more ETH to deployer wallet for gas fees');
      } else if (error.message.includes('nonce')) {
        console.error('💡 Solution: Wait a moment and retry, or reset wallet nonce');
      } else if (error.message.includes('gas')) {
        console.error('💡 Solution: Increase gas limit or gas price');
      }
    }
    
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Auto-compile instructions
console.log(`
📋 COMPILATION REQUIRED

Before running this deployment script, you need to compile the SimpleEscrowUSDC.sol contract.

Option 1 - Using Hardhat:
1. npm install --save-dev hardhat @nomicfoundation/hardhat-ethers
2. Create hardhat.config.js
3. Move SimpleEscrowUSDC.sol to contracts/
4. Run: npx hardhat compile
5. Extract bytecode from artifacts/

Option 2 - Using Remix IDE:
1. Go to https://remix.ethereum.org/
2. Paste SimpleEscrowUSDC.sol code
3. Compile and copy bytecode
4. Update SIMPLE_ESCROW_USDC_BYTECODE in this script

Option 3 - Using solc directly:
1. npm install -g solc
2. solc --bin --abi SimpleEscrowUSDC.sol
3. Copy bytecode output

After compilation, replace the placeholder bytecode in this script.
`);

if (process.argv.includes('--skip-compile-check')) {
  deployContract().catch(console.error);
} else {
  console.log('\nTo proceed anyway (not recommended), run:');
  console.log('npx tsx scripts/deploy-usdc-escrow.ts --skip-compile-check');
}