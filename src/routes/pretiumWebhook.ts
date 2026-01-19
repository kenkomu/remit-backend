import { FastifyInstance } from 'fastify';
import { pool } from '../services/database';

interface PretiumWebhookPayload {
  transaction_code: string;
  status: 'success' | 'failed';
  amount_usdc: string;
  tx_hash: string;
  chain: string;
}

export async function pretiumWebhookRoutes(fastify: FastifyInstance) {
  fastify.post('/webhooks/pretium', async (req, reply) => {
    const payload = req.body as PretiumWebhookPayload;

    if (!payload?.transaction_code) {
      return reply.code(400).send({ error: 'Missing transaction_code' });
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // 1️⃣ Lock onramp transaction
      const onrampRes = await client.query(
        `
        SELECT *
        FROM onramp_transactions
        WHERE pretium_transaction_code = $1
        FOR UPDATE
        `,
        [payload.transaction_code]
      );

      if (onrampRes.rows.length === 0) {
        throw new Error('Unknown transaction_code');
      }

      const onramp = onrampRes.rows[0];

      // 2️⃣ Idempotency
      if (onramp.status === 'confirmed') {
        await client.query('COMMIT');
        return reply.code(200).send({ ok: true });
      }

      // 3️⃣ Validate success
      if (payload.status !== 'success') {
        await client.query(
          `
          UPDATE onramp_transactions
          SET
            status = 'failed',
            webhook_payload = $1,
            failed_at = NOW(),
            error_message = 'Pretium reported failure',
            updated_at = NOW()
          WHERE onramp_transaction_id = $2
          `,
          [payload, onramp.onramp_transaction_id]
        );

        await client.query('COMMIT');
        return reply.code(200).send({ ok: true });
      }

      // 4️⃣ Validate chain
      if (payload.chain !== onramp.chain) {
        throw new Error('Chain mismatch');
      }

      // 5️⃣ Validate amount
      const receivedUsdCents = Math.round(Number(payload.amount_usdc) * 100);

      if (receivedUsdCents < onramp.expected_usdc_cents) {
        throw new Error(
          `Underfunded escrow: expected=${onramp.expected_usdc_cents}, received=${receivedUsdCents}`
        );
      }

      // 6️⃣ Confirm onramp transaction
      await client.query(
        `
        UPDATE onramp_transactions
        SET
          status = 'confirmed',
          webhook_payload = $1,
          confirmed_at = NOW(),
          updated_at = NOW()
        WHERE onramp_transaction_id = $2
        `,
        [payload, onramp.onramp_transaction_id]
      );

      // 7️⃣ Activate escrow
      await client.query(
        `
        UPDATE escrows
        SET
          status = 'active',
          updated_at = NOW()
        WHERE escrow_id = $1
          AND status = 'pending_deposit'
        `,
        [onramp.escrow_id]
      );

      await client.query('COMMIT');

      return reply.code(200).send({ ok: true });

    } catch (err: any) {
      await client.query('ROLLBACK');
      fastify.log.error(err);
      return reply.code(400).send({ error: err.message });
    } finally {
      client.release();
    }
  });
}
