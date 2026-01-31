import { Worker } from 'bullmq';
import axios from 'axios';
import { pool } from '../services/database.js';
import { sendBaseUsdcTransaction } from '../services/onchainService.js';

const PRETIUM_BASE_URL = process.env.PRETIUM_API_URL!;
const PRETIUM_API_KEY = process.env.PRETIUM_API_KEY!;

export const usdcSpenderWorker = process.env.REDIS_URL ? new Worker(
  'usdc-spend',
  async job => {
    console.log('➡️ Processing job', job.id, job.data);

     const { paymentRequestId, amountUsdCents } = job.data;

     try {
       const { rows } = await pool.query(
         `
         SELECT onchain_status
         FROM payment_requests
         WHERE payment_request_id = $1
         FOR UPDATE
         `,
         [paymentRequestId]
       );

       if (!rows.length) {
         throw new Error('Payment request not found');
       }

       if (rows[0].onchain_status === 'broadcasted') {
         console.log('⏭️ Job skipped (already broadcasted)');
         return { skipped: true };
       }

       console.log('🔍 Fetching Pretium wallet');

       const accountRes = await axios.post(
         `${PRETIUM_BASE_URL}/account/detail`,
         {},
         {
           headers: {
             'Content-Type': 'application/json',
             'x-api-key': PRETIUM_API_KEY,
           },
         }
       );

       const baseNetwork = accountRes.data.data.networks.find(
         (n: any) => n.name.toLowerCase() === 'base'
       );

       if (!baseNetwork?.settlement_wallet_address) {
         throw new Error('BASE settlement wallet not found');
       }

       const amountUsd = amountUsdCents / 100;

       console.log('💸 Sending USDC', amountUsd);

       const txHash = await sendBaseUsdcTransaction({
         toAddress: baseNetwork.settlement_wallet_address,
         amountUsd,
       });

       console.log('✅ USDC sent', txHash);

       await pool.query(
         `
         UPDATE payment_requests
         SET
           onchain_transaction_hash = $1,
           onchain_status = 'broadcasted',
           status = 'pending_approval'
         WHERE payment_request_id = $2
         `,
         [txHash, paymentRequestId]
       );

       console.log('📝 DB updated for', paymentRequestId);

       return { txHash };
     } catch (err: any) {
       console.error('❌ Worker error', err.message);

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
  process.env.REDIS_URL ? {
    connection: { url: process.env.REDIS_URL },
    concurrency: 1,
  } : undefined
) : null;

if (usdcSpenderWorker) {
  usdcSpenderWorker.on('ready', () => {
    console.log('USDC spender worker ready');
  });
  
  usdcSpenderWorker.on('failed', (job, err) => {
    console.error('USDC job failed', job?.id, err.message);
  });
} else {
  console.log('USDC spender worker disabled - no Redis connection');
}
