import { FastifyInstance } from 'fastify';
import { pool } from '../services/database';
import {
  initiateKesOnRamp,
  getExchangeRate,
 
} from '../services/pretium';

interface InitiateOnRampBody {
  phone_number: string;
  escrow_id: string;
}

export async function onrampRoutes(fastify: FastifyInstance) {
 fastify.post('/kes', async (req, reply) => {
  const { phone_number, escrow_id } = req.body as any;
  const userId = req.headers['x-user-id'];

  if (!userId) return reply.code(401).send({ error: 'Unauthorized' });

  // 🚫 DO NOT normalize to 254
  if (!/^0\d{9}$/.test(phone_number)) {
    return reply.code(400).send({ error: 'Invalid phone number format' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const escrow = await client.query(
      `SELECT total_amount_usd_cents, status
       FROM escrows
       WHERE escrow_id = $1 AND sender_user_id = $2
       FOR UPDATE`,
      [escrow_id, userId]
    );

    if (!escrow.rows.length) throw new Error('Escrow not found');
    if (escrow.rows[0].status !== 'pending_deposit') {
      throw new Error('Escrow not ready');
    }

    const usd = escrow.rows[0].total_amount_usd_cents / 100;
    const rate = await getExchangeRate();
    const amountKes = Math.ceil(usd * rate);

    const pretium = await initiateKesOnRamp({
      phone: phone_number,
      amountKes,
    });

    await client.query(
      `INSERT INTO onramp_transactions (
        escrow_id,
        sender_user_id,
        pretium_transaction_code,
        phone_number,
        amount_kes_cents,
        exchange_rate,
        status
      ) VALUES ($1,$2,$3,$4,$5,$6,'pending')`,
      [
        escrow_id,
        userId,
        pretium.transaction_code,
        phone_number,
        amountKes * 100,
        rate,
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
