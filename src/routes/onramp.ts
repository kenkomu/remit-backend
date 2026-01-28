import { FastifyInstance } from 'fastify';
import { pool } from '../services/database.js';
import { initiateKesOnRamp, getExchangeRate } from '../services/pretium.js';
import { authMiddleware } from '../middleware/auth.js';


const SETTLEMENT_WALLET = process.env.BACKEND_SETTLEMENT_WALLET!;

// IMPORTANT: This endpoint only initiates onramp.
// It must NEVER finalize transaction or escrow state.
// Webhooks are authoritative.


export async function onrampRoutes(fastify: FastifyInstance) {
  fastify.post('/kes',{ preHandler: authMiddleware }, async (req, reply) => {
    const { phone_number, escrow_id } = req.body as any;
    const userId = req.user!.userId;


    if (!userId) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    if (!/^0\d{9}$/.test(phone_number)) {
      return reply.code(400).send({ error: 'Invalid phone number format' });
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const escrowRes = await client.query(
        `SELECT total_amount_usd_cents, status
         FROM escrows
         WHERE escrow_id = $1 AND sender_user_id = $2
         FOR UPDATE`,
        [escrow_id, userId]
      );

      if (!escrowRes.rows.length) {
        throw new Error('Escrow not found');
      }

      const escrow = escrowRes.rows[0];

      if (escrow.status !== 'pending_deposit') {
        throw new Error('Escrow not ready');
      }

      const totalUsdCents = Number(escrow.total_amount_usd_cents);
      if (!Number.isFinite(totalUsdCents) || totalUsdCents <= 0) {
        throw new Error('Invalid escrow USD amount');
      }

      const usd = totalUsdCents / 100;

      const rate = await getExchangeRate();
      if (!Number.isFinite(rate) || rate <= 0) {
        throw new Error('Invalid exchange rate');
      }

      const amountKes = Math.ceil(usd * rate);
      if (!Number.isFinite(amountKes) || amountKes <= 0) {
        throw new Error('Invalid KES amount');
      }

      const pretium = await initiateKesOnRamp({
        phone: phone_number,
        amountKes,
      });

      // ✅ FIXED INSERT
      await client.query(
        `INSERT INTO onramp_transactions (
          escrow_id,
          sender_user_id,
          pretium_transaction_code,
          phone_number,
          amount_kes_cents,
          expected_usdc_cents,
          exchange_rate,
          settlement_address,
          status
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending')`,
        [
          escrow_id,
          userId,
          pretium.transaction_code,
          phone_number,
          amountKes * 100,
          totalUsdCents,
          rate,
          SETTLEMENT_WALLET,
        ]
      );

      await client.query('COMMIT');

      return {
        message: 'M-Pesa prompt sent',
        transaction_code: pretium.transaction_code,
      };
    } catch (err: any) {
      await client.query('ROLLBACK');
      return reply.code(400).send({ error: err.message });
    } finally {
      client.release();
    }
  });
}
