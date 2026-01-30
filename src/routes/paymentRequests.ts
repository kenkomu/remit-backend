import { FastifyInstance } from 'fastify';
import { pool } from '../services/database.js';
import { createPaymentRequestWithDailyLimit } from '../services/dailySpendService.js';
import { Queue } from 'bullmq';
import axios from 'axios';
import { authMiddleware } from '../middleware/auth.js';
import { randomUUID } from 'crypto';

const PRETIUM_BASE_URL = process.env.PRETIUM_BASE_URL!;

// Queue for smart contract payment confirmations
const paymentQueue = new Queue('payment-confirmation', { 
  connection: { host: '127.0.0.1', port: 6379 } 
});

async function fetchOfframpStatus(
  transactionCode: string
): Promise<'completed' | 'pending' | 'failed'> {
  try {
    const res = await axios.post(`${PRETIUM_BASE_URL}/v1/status/KES`, {
      transaction_code: transactionCode,
    });

    const status = res.data?.data?.status;
    if (status === 'COMPLETE') return 'completed';
    if (status === 'PENDING') return 'pending';
    return 'failed';
  } catch {
    return 'pending';
  }
}

export async function paymentRequestRoutes(fastify: FastifyInstance) {

  // =========================
  // CREATE PAYMENT REQUEST
  // =========================
  fastify.post(
    '/payment-requests',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const body = request.body as any;

      const required = [
        body.escrowId,
        body.categoryId,
        body.amountKesCents,
        body.amountUsdCents,
        body.exchangeRate,
        body.merchantName,
        body.merchantAccount,
      ];

      if (required.some(v => !v)) {
        return reply.status(400).send({ error: 'Missing required fields' });
      }

      // 1️⃣ Fetch recipient from escrow
      const escrowRes = await pool.query(
        `SELECT recipient_id
   FROM escrows
   WHERE escrow_id = $1`,
        [body.escrowId]
      );

      if (!escrowRes.rows.length) {
        return reply.status(404).send({ error: 'Escrow not found' });
      }

      const recipientId = escrowRes.rows[0].recipient_id;

      // 2️⃣ Use REAL recipient id
      const paymentRequest = await createPaymentRequestWithDailyLimit({
        recipientId,
        ...body,
        onchainStatus: 'pending',
      });

      // Generate unique payment ID for smart contract
      const paymentId = randomUUID();
      
      // Store payment ID in database
      await pool.query(
        'UPDATE payment_requests SET invoice_number = $1 WHERE payment_request_id = $2',
        [paymentId, paymentRequest.paymentRequestId]
      );

      // Queue smart contract payment confirmation
      await paymentQueue.add(
        'confirm-payment',
        {
          escrowId: body.escrowId,
          paymentId,
          amountUsdCents: body.amountUsdCents,
          mpesaRef: `MP-${Date.now()}`, // Will be updated with actual M-Pesa ref
          paymentRequestId: paymentRequest.paymentRequestId,
        },
        { 
          jobId: paymentRequest.paymentRequestId,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
        }
      );

      return reply.status(202).send({
        success: true,
        paymentRequestId: paymentRequest.paymentRequestId,
        paymentId,
        status: 'onchain_pending',
      });
    }
  );

  // =========================
  // FETCH PAYMENT STATUS (READ ONLY)
  // =========================
  fastify.get(
    '/payment-requests/:id',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      // 1️⃣ Fetch the payment request
      const { rows } = await pool.query(
        `
      SELECT
        pr.payment_request_id,
        pr.status,
        pr.onchain_status,
        pr.onchain_transaction_hash
      FROM payment_requests pr
      WHERE pr.payment_request_id = $1
      `,
        [id]
      );

      if (!rows.length) {
        return reply.status(404).send({ error: 'Payment request not found' });
      }

      const row = rows[0];

      // 2️⃣ Fetch latest off-ramp transaction for this payment request
      const { rows: offRows } = await pool.query(
        `
      SELECT *
      FROM offramp_transactions
      WHERE payment_request_id = $1
      ORDER BY created_at DESC
      LIMIT 1
      `,
        [id]
      );

      const offrampTx = offRows[0];

      // 3️⃣ Check Pretium API for current off-ramp status
      let offrampStatus: 'completed' | 'pending' | 'failed' | null = offrampTx?.status ?? null;
      if (offrampTx?.pretium_transaction_code) {
        offrampStatus = await fetchOfframpStatus(offrampTx.pretium_transaction_code);

        // ✅ Update DB using the correct primary key column
        await pool.query(
          `
        UPDATE offramp_transactions
        SET status = $1
        WHERE offramp_transaction_id = $2
        `,
          [offrampStatus, offrampTx.offramp_transaction_id]
        );
      }

      // 4️⃣ Compute user-friendly status
      const userFriendlyStatus = (() => {
        if (row.onchain_status === 'broadcasted' && offrampStatus === 'completed') return 'completed';
        if (row.onchain_status === 'broadcasted' && (offrampStatus === 'pending' || offrampStatus === null)) return 'onchain_done_offramp_pending';
        if (row.onchain_status === 'pending') return 'onchain_pending';
        if (row.status === 'pending_approval') return 'pending';
        return row.status;
      })();

      // 5️⃣ Add smart contract status
      const { rows: escrowRows } = await pool.query(
        `SELECT e.blockchain_contract_address 
         FROM escrows e 
         JOIN payment_requests pr ON pr.escrow_id = e.escrow_id 
         WHERE pr.payment_request_id = $1 
         LIMIT 1`,
        [id]
      );

      const contractAddress = escrowRows[0]?.blockchain_contract_address;

      // 6️⃣ Return combined response
      return reply.send({
        success: true,
        data: {
          payment_request_id: row.payment_request_id,
          status: userFriendlyStatus,
          onchain_status: row.onchain_status,
          transaction_hash: row.onchain_transaction_hash,
          offramp_status: offrampStatus,
          contract_address: contractAddress,
          smart_contract_enabled: !!contractAddress,
        },
      });
    }
  );
}
