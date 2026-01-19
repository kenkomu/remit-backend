import { FastifyInstance } from 'fastify';
import { pool } from '../services/database';
import { disburseKes } from '../services/pretiumDisburse';

const PRETIUM_CALLBACK_URL = process.env.PRETIUM_OFFRAMP_CALLBACK_URL!;

export async function offrampRoutes(fastify: FastifyInstance) {
  fastify.post('/pay', async (request, reply) => {
    const {
      paymentRequestId,
      phoneNumber,
      amountKes,
      transactionHash,
    } = request.body as any;

    if (!paymentRequestId || !phoneNumber || !amountKes || !transactionHash) {
      return reply.code(400).send({ error: 'Missing required fields' });
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // 1️⃣ Lock payment request
      const prRes = await client.query(
        `
        SELECT *
        FROM payment_requests
        WHERE payment_request_id = $1
        FOR UPDATE
        `,
        [paymentRequestId]
      );

      if (prRes.rows.length === 0) {
        throw new Error('Payment request not found');
      }

      const paymentRequest = prRes.rows[0];

      if (paymentRequest.status !== 'pending_approval') {
        throw new Error('Payment request not payable');
      }

      // 2️⃣ Call Pretium
      const pretiumRes = await disburseKes({
        phone: phoneNumber,
        amountKes,
        transactionHash,
      });
      // 3️⃣ Store offramp transaction
      await client.query(
        `
        INSERT INTO offramp_transactions (
          payment_request_id,
          pretium_transaction_code,
          phone_number,
          amount_kes_cents,
          status,
          created_at
        ) VALUES ($1, $2, $3, $4, 'pending', NOW())
        `,
        [
          paymentRequestId,
          pretiumRes.transaction_code,
          phoneNumber,
          amountKes * 100,
        ]
      );

      // 4️⃣ Mark payment request as processing
      await client.query(
        `
        UPDATE payment_requests
        SET status = 'processing'
        WHERE payment_request_id = $1
        `,
        [paymentRequestId]
      );

      await client.query('COMMIT');

      return {
        message: 'Disbursement initiated',
        transactionCode: pretiumRes.transaction_code,
      };

    } catch (err: any) {
      await client.query('ROLLBACK');
      fastify.log.error(err);
      return reply.code(400).send({ error: err.message });
    } finally {
      client.release();
    }
  });
}
