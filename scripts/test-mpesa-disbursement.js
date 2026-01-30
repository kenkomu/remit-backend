#!/usr/bin/env node

import { disburseKes } from '../src/services/pretiumDisburse.js';

// Test M-Pesa disbursement for 28 KES
async function testMpesaDisbursement() {
  console.log('🧪 Testing M-Pesa Disbursement');
  console.log('📱 Phone: 0112285105');
  console.log('💰 Amount: 28 KES');
  
  try {
    const result = await disburseKes({
      phone: '0112285105',
      amountKes: 28,
      transactionHash: '0x' + Date.now().toString(16), // Mock transaction hash
    });
    
    console.log('✅ Disbursement successful!');
    console.log('📄 Transaction Code:', result.transaction_code);
    console.log('📝 Status:', result.status);
    console.log('📋 Message:', result.message);
    
    return result;
  } catch (error) {
    console.error('❌ Disbursement failed:', error.message);
    
    // Check if it's a configuration issue
    if (error.message.includes('PRETIUM_API_URL') || error.message.includes('PRETIUM_API_KEY')) {
      console.log('\n🔧 Configuration needed:');
      console.log('Set PRETIUM_API_URL in .env file');  
      console.log('Set PRETIUM_API_KEY in .env file');
      console.log('Set WEBHOOK_BASE_URL in .env file');
    }
    
    throw error;
  }
}

// Run the test
testMpesaDisbursement().catch(console.error);