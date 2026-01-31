import { Worker } from 'bullmq';
import axios from 'axios';
import { ethers } from 'ethers';
import { pool } from '../services/database.js';
import { 
  createEscrowWithUsdc, 
  confirmPayment, 
  refundEscrow, 
  getEscrowDetails,
  getNextEscrowId
} from '../services/onchainService.js';
import ContractDeploymentService from '../services/contractDeploymentService.js';

const SIMPLE_ESCROW_ADDRESS = process.env.SIMPLE_ESCROW_ADDRESS!;
const PRETIUM_BASE_URL = process.env.PRETIUM_API_URL!;
const PRETIUM_API_KEY = process.env.PRETIUM_API_KEY!;
const REDIS_URL = process.env.REDIS_URL;

// =====================================================
// WORKER: Create Blockchain Escrow
// =====================================================

export const escrowCreationWorker = REDIS_URL ? new Worker(
  'escrow-creation',
  async job => {
    console.log('🔨 Creating blockchain escrow', job.id, job.data);

     const { escrowId, purpose, durationDays } = job.data;

    try {
      // Check if escrow already exists on blockchain
      const nextEscrowId = await getNextEscrowId();
      console.log('📋 Next blockchain escrow ID:', nextEscrowId);

      // Fetch Pretium settlement wallet on Base network
      const accountRes = await axios.post(
        `${PRETIUM_BASE_URL}/account/detail`,
        {},
        { headers: { 'Content-Type': 'application/json', 'x-api-key': PRETIUM_API_KEY } }
      );
      const baseNetwork = accountRes.data.data.networks.find((n: any) => n.name.toLowerCase() === 'base');
      if (!baseNetwork?.settlement_wallet_address) {
        throw new Error('BASE settlement wallet not found');
      }
      const beneficiary = baseNetwork.settlement_wallet_address as string;

      // Use USDC amount directly (no ETH conversion needed)
      const amountUsdCents: number = job.data.amountUsdCents ?? Math.round((job.data.amountUsd || 0) * 100);
      const amountUsdc = amountUsdCents / 100; // Convert cents to USDC

      console.log('🚀 Deploying escrow to blockchain');
      const result = await createEscrowWithUsdc({ 
        escrowId, 
        beneficiary, 
        amountUsdc, 
        durationDays 
      });

      console.log('✅ Escrow created on blockchain', result.txHash);

      // Update database with blockchain info
      await pool.query(
        `
        UPDATE escrows
        SET
          blockchain_contract_address = $1,
          blockchain_escrow_id = $2,
          blockchain_tx_hash = $3,
          blockchain_status = 'deployed',
          funded_at = NOW(),
          status = 'active'
        WHERE escrow_id = $4
        `,
        [SIMPLE_ESCROW_ADDRESS, result.blockchainEscrowId, result.txHash, escrowId]
      );

      // Track blockchain transaction
      await pool.query(
        `
        INSERT INTO blockchain_transactions (
          tx_hash, operation_type, escrow_id, contract_address, 
          status, requested_by_user_id
        ) VALUES ($1, 'create_escrow', $2, $3, 'pending', $4)
        `,
        [
          result.txHash,
          escrowId,
          SIMPLE_ESCROW_ADDRESS,
          job.data.requestedByUserId
        ]
      );

      console.log('📝 Database updated for escrow', escrowId);

      return { txHash: result.txHash, blockchainEscrowId: result.blockchainEscrowId };
    } catch (err: any) {
      console.error('❌ Escrow creation error', err.message);

      await pool.query(
        `
        UPDATE escrows
        SET blockchain_status = 'failed'
        WHERE escrow_id = $1
        `,
        [escrowId]
      );

      throw err;
    }
  },
  REDIS_URL ? {
    connection: { url: REDIS_URL },
    concurrency: 3, // Allow concurrent escrow creation
  } : undefined
) : null;

// =====================================================
// WORKER: Confirm Payment on Blockchain
// =====================================================

export const paymentConfirmationWorker = REDIS_URL ? new Worker(
  'payment-confirmation',
  async job => {
    console.log('💳 Confirming payment on blockchain', job.id, job.data);

    const { escrowId, paymentId, amountUsdc, paymentRequestId } = job.data;

    try {
      // Check if payment ID already used
      const isUsed = await (await import('../services/onchainService.js')).isPaymentIdUsed(paymentId);
      if (isUsed) {
        console.log('⏭️ Payment ID already used on blockchain');
        return { alreadyUsed: true };
      }

      console.log('🔍 Checking escrow details');
      const escrow = await getEscrowDetails(escrowId);
      if (!escrow || escrow.isCompleted) {
        throw new Error('Escrow not found or already completed');
      }

      console.log('💸 Confirming payment on blockchain');
      const txHash = await confirmPayment({
        escrowId,
        paymentId,
        amountUsdc,
      });

      console.log('✅ Payment confirmed on blockchain', txHash);

      // Update payment request status
      await pool.query(
        `
        UPDATE payment_requests
        SET
          onchain_transaction_hash = $1,
          onchain_status = 'broadcasted',
          status = 'completed'
        WHERE payment_request_id = $2
        `,
        [txHash, paymentRequestId]
      );

      // Update escrow balance in database
      const amountCents = typeof job.data.amountUsdCents === 'number'
        ? job.data.amountUsdCents
        : Math.round(amountUsdc * 100);
      await pool.query(
        `
        UPDATE escrows
        SET
          remaining_balance_usd_cents = remaining_balance_usd_cents - $1,
          total_spent_usd_cents = total_spent_usd_cents + $1,
          updated_at = NOW()
        WHERE escrow_id = $2
        `,
        [amountCents, escrowId]
      );

      // Track blockchain transaction
      await pool.query(
        `
        INSERT INTO blockchain_transactions (
          tx_hash, operation_type, escrow_id, contract_address,
          payment_request_id, status, amount_usd_cents
        ) VALUES ($1, 'confirm_payment', $2, $3, $4, 'pending', $5)
        `,
        [txHash, escrowId, SIMPLE_ESCROW_ADDRESS, paymentRequestId, amountCents]
      );

      console.log('📝 Database updated for payment', paymentRequestId);

      return { txHash };
    } catch (err: any) {
      console.error('❌ Payment confirmation error', err.message);

      await pool.query(
        `
        UPDATE payment_requests
        SET onchain_status = 'failed'
        WHERE payment_request_id = $1
        `,
        [paymentRequestId]
      );

       throw err;
     }
   },
  REDIS_URL ? {
    connection: { url: REDIS_URL },
    concurrency: 5, // Higher concurrency for payments
  } : undefined
) : null;

// =====================================================
// WORKER: Refund Expired Escrow
// =====================================================

export const escrowRefundWorker = REDIS_URL ? new Worker(
  'escrow-refund',
  async job => {
    console.log('🔄 Refunding escrow', job.id, job.data);

    const { escrowId, reason } = job.data;

    try {
      // Get escrow details first
      console.log('🔍 Getting escrow details');
      const escrow = await getEscrowDetails(escrowId);
      
      if (!escrow || escrow.isCompleted) {
        console.log('⏭️ Escrow not found or already completed');
        return { alreadyCompleted: true };
      }

      // Check if expired based on database expiry or manual reason
      const now = Math.floor(Date.now() / 1000);
      const expired = Number(escrow.expiry) < now;
      
      if (!expired && !reason) {
        throw new Error('Escrow not expired and no reason provided');
      }

      console.log('💸 Processing refund on blockchain');
      const txHash = await refundEscrow({
        escrowId,
        reason: reason || 'Escrow expired',
      });

      console.log('✅ Refund processed on blockchain', txHash);

      // Update escrow status
      await pool.query(
        `
        UPDATE escrows
        SET
          status = 'cancelled',
          remaining_balance_usd_cents = 0,
          completed_at = NOW(),
          updated_at = NOW()
        WHERE escrow_id = $1
        `,
        [escrowId]
      );

      // Track blockchain transaction
      await pool.query(
        `
        INSERT INTO blockchain_transactions (
          tx_hash, operation_type, escrow_id, contract_address, status
        ) VALUES ($1, 'refund_escrow', $2, $3, 'pending')
        `,
        [txHash, escrowId, SIMPLE_ESCROW_ADDRESS]
      );

      console.log('📝 Database updated for refund', escrowId);

      return { txHash };
    } catch (err: any) {
      console.error('❌ Escrow refund error', err.message);
      throw err;
    }
  },
  REDIS_URL ? {
    connection: { url: REDIS_URL },
    concurrency: 2,
  } : undefined
) : null;

// =====================================================
// WORKER: Contract Deployment (Admin)
// =====================================================

export const contractDeploymentWorker = REDIS_URL ? new Worker(
  'contract-deployment',
  async job => {
    console.log('🚀 Deploying new contract', job.id, job.data);

    const { backendServiceAddress, feeCollectorAddress, deployedByUserId } = job.data;

    try {
      const deploymentService = new ContractDeploymentService();
      
      console.log('📋 Estimating gas costs');
      const gasEstimate = await deploymentService.estimateDeploymentGas(
        backendServiceAddress,
        feeCollectorAddress
      );

      console.log('⛽ Gas estimate:', gasEstimate);

      console.log('🚀 Deploying contract');
      const deployment = await deploymentService.deploySimpleEscrow({
        backendServiceAddress,
        feeCollectorAddress,
      });

      console.log('✅ Contract deployed', deployment);

      // Track deployment in database
      await pool.query(
        `
        INSERT INTO smart_contract_deployments (
          contract_name, contract_address, network, deployer_address,
          deployment_tx_hash, block_number, gas_used, backend_service_address,
          fee_collector_address, initial_protocol_fee_bps
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `,
        [
          'SimpleEscrow',
          deployment.contractAddress,
          'base',
          job.data.deployerAddress,
          deployment.transactionHash,
          deployment.blockNumber,
          gasEstimate.toString(),
          backendServiceAddress,
          feeCollectorAddress,
          100, // Default 1% fee
        ]
      );

      console.log('📝 Deployment tracked in database');

      return deployment;
     } catch (err: any) {
       console.error('❌ Contract deployment error', err.message);
       throw err;
     }
   },
  REDIS_URL ? {
    connection: { url: REDIS_URL },
    concurrency: 1, // One deployment at a time
  } : undefined
) : null;

// =====================================================
// WORKER EVENT HANDLERS
// =====================================================

if (escrowCreationWorker) {
  escrowCreationWorker.on('ready', () => {
    console.log('Escrow creation worker ready');
  });

  escrowCreationWorker.on('failed', (job: any, err: any) => {
    console.error('Escrow creation failed', job?.id, err.message);
  });
}

if (paymentConfirmationWorker) {
  paymentConfirmationWorker.on('ready', () => {
    console.log('Payment confirmation worker ready');
  });

  paymentConfirmationWorker.on('failed', (job: any, err: any) => {
    console.error('Payment confirmation failed', job?.id, err.message);
  });
}

if (escrowRefundWorker) {
  escrowRefundWorker.on('ready', () => {
    console.log('Escrow refund worker ready');
  });

  escrowRefundWorker.on('failed', (job: any, err: any) => {
    console.error('Escrow refund failed', job?.id, err.message);
  });
}

if (contractDeploymentWorker) {
  contractDeploymentWorker.on('ready', () => {
    console.log('Contract deployment worker ready');
  });

  contractDeploymentWorker.on('failed', (job: any, err: any) => {
    console.error('Contract deployment failed', job?.id, err.message);
  });
}
