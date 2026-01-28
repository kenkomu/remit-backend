import { FastifyInstance } from 'fastify';
import { pool } from '../services/database.js';
import { withIdempotency } from '../services/redis.js';

interface PretiumOfframpPayload {
  transaction_code: string;
  status: 'SUCCESS' | 'FAILED';
  mpesa_receipt?: string;
}

export async function pretiumOfframpWebhookRoutes(fastify: FastifyInstance) {
  fastify.post('/webhooks/pretium/offramp', async (req, reply) => {
    const payload = req.body as PretiumOfframpPayload;

    if (!payload?.transaction_code) {
      return reply.code(400).send({ error: 'Missing transaction_code' });
    }

    return withIdempotency(req, reply, 'pretium_offramp', payload.transaction_code, async () => {
      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        const txRes = await client.query(
          `SELECT * FROM offramp_transactions WHERE pretium_transaction_code = $1 FOR UPDATE`,
          [payload.transaction_code]
        );

        if (!txRes.rows.length) throw new Error('Unknown offramp transaction');

        const tx = txRes.rows[0];

        if (payload.status !== 'SUCCESS') {
          await client.query(
            `UPDATE offramp_transactions SET status='failed', updated_at=NOW() WHERE offramp_transaction_id=$1`,
            [tx.offramp_transaction_id]
          );

          await client.query(
            `UPDATE payment_requests SET status='failed' WHERE payment_request_id=$1`,
            [tx.payment_request_id]
          );

          await client.query('COMMIT');
          return reply.send({ ok: true });
        }

        await client.query(
          `UPDATE offramp_transactions SET status='completed', mpesa_receipt=$1, completed_at=NOW() WHERE offramp_transaction_id=$2`,
          [payload.mpesa_receipt, tx.offramp_transaction_id]
        );

        await client.query(
          `UPDATE payment_requests SET status='completed' WHERE payment_request_id=$1`,
          [tx.payment_request_id]
        );

        await client.query('COMMIT');
        return reply.send({ ok: true });

      } catch (err: any) {
        await client.query('ROLLBACK');
        fastify.log.error(err);
        return reply.code(400).send({ error: err.message });
      } finally {
        client.release();
      }
    });
  });
}
