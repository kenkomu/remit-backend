import { FastifyInstance } from 'fastify';
import { pool } from '../services/database.js';
import { createPaymentRequestWithDailyLimit } from '../services/dailySpendService.js';
import { approvePaymentRequest } from '../services/database.js';
import { Queue } from 'bullmq';
import axios from 'axios';
import { authMiddleware } from '../middleware/auth.js';
import { randomUUID } from 'crypto';
import { decrypt } from '../utils/crypto.js';

const PRETIUM_BASE_URL = process.env.PRETIUM_BASE_URL!;

// Queue for smart contract payment confirmations (only if Redis is available)
let paymentQueue: Queue | null = null;
try {
  if (process.env.REDIS_URL) {
    paymentQueue = new Queue('payment-confirmation', { 
      connection: { url: process.env.REDIS_URL }
    });
  }
} catch (error) {
  console.warn('⚠️ Failed to create payment queue:', (error as any).message);
}

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

       // Queue smart contract payment confirmation (only if Redis is available)
       if (!paymentQueue) {
         console.warn('⚠️ Redis not available, payment confirmation will be processed manually');
         // For now, continue anyway - in production, this should require Redis
       } else {
         try {
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
         } catch (queueError) {
           console.error('⚠️ Failed to queue payment confirmation:', queueError);
           // Continue anyway - payment exists in database
         }
       }

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

  // =========================
  // LIST SENDER'S PENDING PAYMENT REQUESTS
  // =========================
  fastify.get(
    '/sender/payment-requests',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const userId = request.user!.userId;
      const { status } = request.query as { status?: string };

      // Default to pending_approval if no status specified
      const statusFilter = status || 'pending_approval';

      const { rows } = await pool.query(
        `SELECT 
          pr.payment_request_id,
          pr.escrow_id,
          pr.category_id,
          pr.amount_kes_cents,
          pr.amount_usd_cents,
          pr.exchange_rate_kes_per_usd,
          pr.merchant_name_encrypted,
          pr.merchant_account_encrypted,
          pr.status,
          pr.created_at,
          sc.category_name,
          r.phone_number_encrypted as recipient_phone_encrypted,
          r.full_name_encrypted as recipient_name_encrypted
        FROM payment_requests pr
        JOIN escrows e ON pr.escrow_id = e.escrow_id
        JOIN spending_categories sc ON pr.category_id = sc.category_id
        JOIN recipients r ON e.recipient_id = r.recipient_id
        WHERE e.sender_user_id = $1
          AND pr.status = $2
        ORDER BY pr.created_at DESC`,
        [userId, statusFilter]
      );

      const paymentRequests = rows.map(row => ({
        paymentRequestId: row.payment_request_id,
        escrowId: row.escrow_id,
        categoryId: row.category_id,
        categoryName: row.category_name,
        amountKesCents: Number(row.amount_kes_cents),
        amountUsdCents: Number(row.amount_usd_cents),
        amountKes: Number(row.amount_kes_cents) / 100,
        amountUsd: Number(row.amount_usd_cents) / 100,
        exchangeRate: Number(row.exchange_rate_kes_per_usd),
        merchantName: row.merchant_name_encrypted ? decrypt(row.merchant_name_encrypted) : null,
        merchantAccount: row.merchant_account_encrypted ? decrypt(row.merchant_account_encrypted) : null,
        recipientPhone: row.recipient_phone_encrypted ? decrypt(row.recipient_phone_encrypted) : null,
        recipientName: row.recipient_name_encrypted ? decrypt(row.recipient_name_encrypted) : null,
        status: row.status,
        createdAt: row.created_at,
      }));

      return reply.send({
        success: true,
        data: paymentRequests,
        count: paymentRequests.length,
      });
    }
  );

  // =========================
  // APPROVE PAYMENT REQUEST
  // =========================
  fastify.post(
    '/payment-requests/:id/approve',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const userId = request.user!.userId;

      // 1. Verify sender owns this escrow
      const { rows } = await pool.query(
        `SELECT pr.payment_request_id, pr.escrow_id, pr.category_id, pr.amount_usd_cents, pr.status,
                e.sender_user_id
         FROM payment_requests pr
         JOIN escrows e ON pr.escrow_id = e.escrow_id
         WHERE pr.payment_request_id = $1`,
        [id]
      );

      if (!rows.length) {
        return reply.status(404).send({ error: 'Payment request not found' });
      }

      const paymentRequest = rows[0];

      if (paymentRequest.sender_user_id !== userId) {
        return reply.status(403).send({ error: 'Not authorized to approve this request' });
      }

      if (paymentRequest.status !== 'pending_approval') {
        return reply.status(400).send({ error: `Cannot approve request with status: ${paymentRequest.status}` });
      }

      // 2. Approve the payment request
      try {
        await approvePaymentRequest({
          paymentRequestId: id,
          escrowId: paymentRequest.escrow_id,
          categoryId: paymentRequest.category_id,
          amountUsdCents: Number(paymentRequest.amount_usd_cents),
          approverUserId: userId,
        });

        // 3. Queue for on-chain processing (if Redis available)
        if (paymentQueue) {
          const paymentId = randomUUID();
          await pool.query(
            'UPDATE payment_requests SET invoice_number = $1 WHERE payment_request_id = $2',
            [paymentId, id]
          );

          await paymentQueue.add(
            'confirm-payment',
            {
              escrowId: paymentRequest.escrow_id,
              paymentId,
              amountUsdCents: Number(paymentRequest.amount_usd_cents),
              mpesaRef: `MP-${Date.now()}`,
              paymentRequestId: id,
            },
            {
              jobId: id,
              attempts: 3,
              backoff: { type: 'exponential', delay: 2000 },
            }
          );
        }

        return reply.send({
          success: true,
          message: 'Payment request approved',
          paymentRequestId: id,
        });
      } catch (error: any) {
        return reply.status(400).send({ error: error.message });
      }
    }
  );

  // =========================
  // REJECT PAYMENT REQUEST
  // =========================
  fastify.post(
    '/payment-requests/:id/reject',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const userId = request.user!.userId;
      const { reason } = request.body as { reason?: string };

      // 1. Verify sender owns this escrow
      const { rows } = await pool.query(
        `SELECT pr.payment_request_id, pr.escrow_id, pr.status, pr.amount_usd_cents,
                pr.requested_by_recipient_id, e.sender_user_id
         FROM payment_requests pr
         JOIN escrows e ON pr.escrow_id = e.escrow_id
         WHERE pr.payment_request_id = $1`,
        [id]
      );

      if (!rows.length) {
        return reply.status(404).send({ error: 'Payment request not found' });
      }

      const paymentRequest = rows[0];

      if (paymentRequest.sender_user_id !== userId) {
        return reply.status(403).send({ error: 'Not authorized to reject this request' });
      }

      if (paymentRequest.status !== 'pending_approval') {
        return reply.status(400).send({ error: `Cannot reject request with status: ${paymentRequest.status}` });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // 2. Update payment request status to rejected
        await client.query(
          `UPDATE payment_requests
           SET status = 'rejected',
               rejected_by_user_id = $1,
               rejected_at = NOW(),
               rejection_reason = $2,
               updated_at = NOW()
           WHERE payment_request_id = $3`,
          [userId, reason || null, id]
        );

        // 3. Refund the daily spend limit (if it was deducted)
        // Note: For one-time payments (rent/school), daily limit wasn't deducted
        const categoryResult = await client.query(
          `SELECT sc.category_name FROM spending_categories sc WHERE sc.category_id = $1`,
          [paymentRequest.escrow_id]
        );
        const categoryName = categoryResult.rows[0]?.category_name?.toLowerCase() || '';
        const isOneTimePayment = ['rent', 'school', 'school fees', 'education'].includes(categoryName);

        if (!isOneTimePayment) {
          await client.query(
            `UPDATE daily_spend
             SET spent_today_usd_cents = spent_today_usd_cents - $1,
                 remaining_today_usd_cents = remaining_today_usd_cents + $1,
                 transaction_count = GREATEST(transaction_count - 1, 0)
             WHERE recipient_id = $2 AND spend_date = CURRENT_DATE`,
            [paymentRequest.amount_usd_cents, paymentRequest.requested_by_recipient_id]
          );
        }

        // 4. Audit log
        await client.query(
          `INSERT INTO audit_logs (user_id, escrow_id, payment_request_id, action, resource_type, resource_id, status, new_values)
           VALUES ($1, $2, $3, 'payment_request.rejected', 'payment_requests', $3, 'success', $4)`,
          [userId, paymentRequest.escrow_id, id, JSON.stringify({ reason: reason || 'No reason provided' })]
        );

        await client.query('COMMIT');

        return reply.send({
          success: true,
          message: 'Payment request rejected',
          paymentRequestId: id,
        });
      } catch (error: any) {
        await client.query('ROLLBACK');
        return reply.status(500).send({ error: error.message });
      } finally {
        client.release();
      }
    }
  );
}
