import { FastifyInstance } from 'fastify';
import { pool } from '../services/database.js';
import { createPaymentRequestWithDailyLimit } from '../services/dailySpendService.js';
import { approvePaymentRequest } from '../services/database.js';
import { disburseKes } from '../services/pretiumDisburse.js';
import axios from 'axios';
import { authMiddleware } from '../middleware/auth.js';
import { randomUUID } from 'crypto';
import { decrypt } from '../utils/crypto.js';

const PRETIUM_BASE_URL = process.env.PRETIUM_BASE_URL || process.env.PRETIUM_API_URL!;

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

      // Generate unique payment ID for tracking
      const paymentId = randomUUID();

      // Note: On-chain execution and off-ramp will be handled in Step 9
      // For now, payment request is created with status 'pending_approval'

      return reply.status(202).send({
        success: true,
        paymentRequestId: paymentRequest.paymentRequestId,
        paymentId,
        status: 'pending_approval',
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

        // Note: On-chain execution and off-ramp will be handled in Step 9
        // After approval, the payment status changes to 'approved' and can proceed to execution

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

  // =========================
  // EXECUTE PAYMENT (M-Pesa Off-Ramp)
  // =========================
  fastify.post(
    '/payment-requests/:id/execute',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const userId = request.user!.userId;

      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        // 1. Lock and fetch payment request with all necessary data
        const { rows } = await client.query(
          `SELECT 
            pr.payment_request_id,
            pr.escrow_id,
            pr.category_id,
            pr.amount_kes_cents,
            pr.amount_usd_cents,
            pr.merchant_name_encrypted,
            pr.merchant_account_encrypted,
            pr.status,
            pr.onchain_status,
            e.sender_user_id,
            e.blockchain_contract_address
          FROM payment_requests pr
          JOIN escrows e ON pr.escrow_id = e.escrow_id
          WHERE pr.payment_request_id = $1
          FOR UPDATE`,
          [id]
        );

        if (!rows.length) {
          await client.query('ROLLBACK');
          return reply.status(404).send({ error: 'Payment request not found' });
        }

        const paymentRequest = rows[0];

        // 2. Verify sender owns this escrow
        if (paymentRequest.sender_user_id !== userId) {
          await client.query('ROLLBACK');
          return reply.status(403).send({ error: 'Not authorized to execute this payment' });
        }

        // 3. Verify status is approved (ready for execution)
        if (paymentRequest.status !== 'approved') {
          await client.query('ROLLBACK');
          return reply.status(400).send({ 
            error: `Cannot execute payment with status: ${paymentRequest.status}. Must be 'approved' first.` 
          });
        }

        // 4. Decrypt merchant account (phone number for M-Pesa)
        const merchantAccount = paymentRequest.merchant_account_encrypted 
          ? decrypt(paymentRequest.merchant_account_encrypted)
          : null;

        if (!merchantAccount) {
          await client.query('ROLLBACK');
          return reply.status(400).send({ error: 'Missing merchant account information' });
        }

        // 5. Update status to processing
        await client.query(
          `UPDATE payment_requests
           SET status = 'processing',
               onchain_status = 'pending',
               updated_at = NOW()
           WHERE payment_request_id = $1`,
          [id]
        );

        // 6. Generate a unique transaction hash for Pretium
        // In production with smart contracts, this would be the on-chain tx hash
        const transactionHash = `0x${randomUUID().replace(/-/g, '')}${randomUUID().replace(/-/g, '')}`.slice(0, 66);

        // 7. Call Pretium to initiate M-Pesa disbursement
        const amountKes = Number(paymentRequest.amount_kes_cents) / 100;
        
        let pretiumResponse;
        try {
          pretiumResponse = await disburseKes({
            phone: merchantAccount,
            amountKes,
            transactionHash,
          });
        } catch (pretiumError: any) {
          // Rollback status if Pretium call fails
          await client.query(
            `UPDATE payment_requests
             SET status = 'approved',
                 onchain_status = 'pending',
                 updated_at = NOW()
             WHERE payment_request_id = $1`,
            [id]
          );
          await client.query('COMMIT');
          
          fastify.log.error('Pretium disbursement failed:', pretiumError);
          return reply.status(502).send({ 
            error: 'Payment execution failed: ' + (pretiumError.message || 'M-Pesa service unavailable')
          });
        }

        // 8. Store offramp transaction
        await client.query(
          `INSERT INTO offramp_transactions (
            payment_request_id,
            pretium_transaction_code,
            phone_number,
            amount_kes_cents,
            status,
            created_at
          ) VALUES ($1, $2, $3, $4, 'pending', NOW())`,
          [
            id,
            pretiumResponse.transaction_code,
            merchantAccount,
            paymentRequest.amount_kes_cents,
          ]
        );

        // 9. Update payment request with transaction hash
        await client.query(
          `UPDATE payment_requests
           SET onchain_status = 'broadcasted',
               onchain_transaction_hash = $1,
               updated_at = NOW()
           WHERE payment_request_id = $2`,
          [transactionHash, id]
        );

        // 10. Audit log
        await client.query(
          `INSERT INTO audit_logs (user_id, escrow_id, payment_request_id, action, resource_type, resource_id, status, new_values)
           VALUES ($1, $2, $3, 'payment_request.executed', 'payment_requests', $3, 'success', $4)`,
          [
            userId,
            paymentRequest.escrow_id,
            id,
            JSON.stringify({
              amount_kes: amountKes,
              pretium_transaction_code: pretiumResponse.transaction_code,
              transaction_hash: transactionHash,
            }),
          ]
        );

        await client.query('COMMIT');

        return reply.send({
          success: true,
          message: 'Payment execution initiated',
          paymentRequestId: id,
          transactionCode: pretiumResponse.transaction_code,
          transactionHash,
          amountKes,
          status: 'processing',
        });
      } catch (error: any) {
        await client.query('ROLLBACK');
        fastify.log.error('Execute payment error:', error);
        return reply.status(500).send({ error: error.message });
      } finally {
        client.release();
      }
    }
  );
}
