import { FastifyInstance } from 'fastify';
import { pool } from '../services/database.js';
import { initiateKesOnRamp, getExchangeRate } from '../services/pretium.js';
import { getTransactions } from '../services/pretiumTransactions.js';
import { authMiddleware } from '../middleware/auth.js';
import { encrypt, hashForLookup } from '../utils/crypto.js';


const SETTLEMENT_WALLET = process.env.BACKEND_SETTLEMENT_WALLET!;

function toYyyyMmDd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isCompletedStatus(status: string): boolean {
  const s = String(status || '').toUpperCase();
  return s === 'COMPLETE' || s === 'COMPLETED' || s === 'SUCCESS' || s === 'SUCCESSFUL';
}

// IMPORTANT: This endpoint only initiates onramp.
// It must NEVER finalize transaction or escrow state.
// Webhooks are authoritative.


export async function onrampRoutes(fastify: FastifyInstance) {
  // ---------------------------------------------------------------------------
  // New flow: initiate onramp WITHOUT creating an escrow first.
  // Client sends the escrow payload + sender phone; we create a funding intent
  // and initiate the Pretium onramp. Webhook confirmation creates the escrow.
  // ---------------------------------------------------------------------------
  fastify.post('/kes/intent', { preHandler: authMiddleware }, async (req, reply) => {
    const {
      phone_number,
      recipient_phone,
      total_amount_usd,
      categories,
      memo,
    } = req.body as any;
    const userId = req.user!.userId;

    if (!userId) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    if (!/^0\d{9}$/.test(phone_number)) {
      return reply.code(400).send({ error: 'Invalid phone number format' });
    }

    if (typeof recipient_phone !== 'string' || !recipient_phone.startsWith('+254')) {
      return reply.code(400).send({ error: 'Invalid recipient phone format' });
    }

    const totalUsd = Number(total_amount_usd);
    if (!Number.isFinite(totalUsd) || totalUsd <= 0) {
      return reply.code(400).send({ error: 'Invalid total_amount_usd' });
    }

    if (!Array.isArray(categories) || categories.length === 0) {
      return reply.code(400).send({ error: 'categories are required' });
    }

    // Validate categories
    const allowed = new Set(['electricity', 'water', 'rent', 'food', 'medical', 'education', 'other']);
    for (const c of categories) {
      const name = String(c?.name ?? '').toLowerCase();
      const amount = Number(c?.amountUsd);
      if (!allowed.has(name)) {
        return reply.code(400).send({ error: `Invalid category: ${name}` });
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        return reply.code(400).send({ error: `Invalid category amount for ${name}` });
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Ensure recipient exists for this sender (and migrate any legacy rows).
      const recipientHash = hashForLookup(recipient_phone);
      const recipientRes = await client.query(
        `SELECT recipient_id, phone_number_hash, phone_number_encrypted, full_name_encrypted
         FROM recipients
         WHERE created_by_user_id = $1
           AND (
             phone_number_hash = $2 OR
             phone_number_hash = md5($3) OR
             phone_number_encrypted = $3
           )
         ORDER BY
           CASE WHEN phone_number_hash = $2 THEN 2 ELSE 0 END DESC,
           CASE WHEN phone_number_hash = md5($3) THEN 1 ELSE 0 END DESC
         LIMIT 1`,
        [userId, recipientHash, recipient_phone],
      );

      if (!recipientRes.rows.length) {
        await client.query(
          `INSERT INTO recipients (
             created_by_user_id,
             phone_number_encrypted,
             phone_number_hash,
             full_name_encrypted,
             country_code
           ) VALUES ($1,$2,$3,$4,'KE')`,
          [
            userId,
            encrypt(recipient_phone),
            recipientHash,
            encrypt('Unknown'),
          ],
        );
      } else {
        const row = recipientRes.rows[0];
        const phoneEnc = String(row.phone_number_encrypted ?? '');
        const nameEnc = String(row.full_name_encrypted ?? '');
        const needsPhoneEncFix = phoneEnc !== '' && !phoneEnc.includes(':');
        const needsNameEncFix = nameEnc !== '' && !nameEnc.includes(':');
        const needsHashFix = String(row.phone_number_hash ?? '') !== recipientHash;

        if (needsPhoneEncFix || needsNameEncFix || needsHashFix) {
          await client.query(
            `UPDATE recipients
             SET phone_number_hash = $1,
                 phone_number_encrypted = $2,
                 full_name_encrypted = $3,
                 updated_at = NOW()
             WHERE recipient_id = $4`,
            [
              recipientHash,
              needsPhoneEncFix ? encrypt(recipient_phone) : phoneEnc,
              needsNameEncFix ? encrypt(nameEnc || 'Unknown') : nameEnc,
              row.recipient_id,
            ],
          );
        }
      }

      const totalUsdCents = Math.round(totalUsd * 100);

      const rate = await getExchangeRate();
      if (!Number.isFinite(rate) || rate <= 0) {
        throw new Error('Invalid exchange rate');
      }

      const amountKes = Math.ceil((totalUsdCents / 100) * rate);
      if (!Number.isFinite(amountKes) || amountKes <= 0) {
        throw new Error('Invalid KES amount');
      }

      const pretium = await initiateKesOnRamp({
        phone: phone_number,
        amountKes,
      });

      // Store intent payload for webhook → escrow creation
      const intentRes = await client.query(
        `INSERT INTO escrow_funding_intents (
          sender_user_id,
          recipient_phone,
          total_amount_usd_cents,
          categories,
          memo,
          phone_number,
          exchange_rate,
          amount_kes_cents,
          expected_usdc_cents,
          settlement_address,
          pretium_transaction_code,
          status
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending')
        RETURNING intent_id`,
        [
          userId,
          recipient_phone,
          totalUsdCents,
          JSON.stringify(categories),
          memo ?? null,
          phone_number,
          rate,
          amountKes * 100,
          totalUsdCents,
          SETTLEMENT_WALLET,
          pretium.transaction_code,
        ],
      );

      await client.query('COMMIT');
      return reply.send({
        message: 'M-Pesa prompt sent',
        transaction_code: pretium.transaction_code,
        intent_id: intentRes.rows[0].intent_id,
      });
    } catch (err: any) {
      await client.query('ROLLBACK');
      return reply.code(400).send({ error: err.message });
    } finally {
      client.release();
    }
  });

  // Status lookup so frontend can poll by transaction_code.
  // NOTE: If an intent is stuck in `pending`, this endpoint may attempt a best-effort
  // reconciliation against Pretium transactions and finalize the intent.
  fastify.get('/kes/status/:transactionCode', { preHandler: authMiddleware }, async (req, reply) => {
    const { transactionCode } = req.params as any;
    const userId = req.user!.userId;

    if (!userId) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { rows } = await pool.query(
      `SELECT intent_id, status, escrow_id
       FROM escrow_funding_intents
       WHERE pretium_transaction_code = $1 AND sender_user_id = $2
       LIMIT 1`,
      [transactionCode, userId],
    );

    if (!rows.length) {
      return reply.code(404).send({ error: 'Transaction not found' });
    }

    // Fallback: if webhook delivery fails, try to confirm via Pretium transactions.
    // Webhooks remain authoritative; this only attempts to reconcile a stuck pending intent.
    if (rows[0].status === 'pending') {
      try {
        const end = new Date();
        const start = new Date(end.getTime() - 3 * 24 * 60 * 60 * 1000);
        const transactions = await getTransactions('KES', toYyyyMmDd(start), toYyyyMmDd(end));
        const tx = transactions.find((t) => t.transaction_code === transactionCode);

        if (tx && isCompletedStatus(tx.status)) {
          const receivedUsdCents = Math.round(Number((tx as any).amount_in_usd) * 100);
          const client = await pool.connect();
          try {
            await client.query('BEGIN');

            const intentRes = await client.query(
              `SELECT * FROM escrow_funding_intents
               WHERE pretium_transaction_code = $1 AND sender_user_id = $2
               FOR UPDATE`,
              [transactionCode, userId],
            );

            if (!intentRes.rows.length) {
              await client.query('ROLLBACK');
              return reply.code(404).send({ error: 'Transaction not found' });
            }

            const intent = intentRes.rows[0];

            if (intent.status === 'confirmed') {
              await client.query('COMMIT');
              return reply.send({
                success: true,
                intentId: intent.intent_id,
                status: intent.status,
                escrowId: intent.escrow_id,
              });
            }

            if (!Number.isFinite(receivedUsdCents) || receivedUsdCents < Number(intent.expected_usdc_cents)) {
              await client.query(
                `UPDATE escrow_funding_intents
                 SET status = 'failed', failed_at = NOW(), error_message = $1, updated_at = NOW()
                 WHERE intent_id = $2`,
                ['Underfunded or missing amount from Pretium status reconciliation', intent.intent_id],
              );
              await client.query('COMMIT');
              return reply.send({
                success: true,
                intentId: intent.intent_id,
                status: 'failed',
                escrowId: null,
              });
            }

            const recipientPhone = String(intent.recipient_phone);
            const recipientHash = hashForLookup(recipientPhone);
            const recipientRes = await client.query(
              `SELECT recipient_id, phone_number_hash, phone_number_encrypted, full_name_encrypted
               FROM recipients
               WHERE created_by_user_id = $1
                 AND (
                   phone_number_hash = $2 OR
                   phone_number_hash = md5($3) OR
                   phone_number_encrypted = $3
                 )
               ORDER BY
                 CASE WHEN phone_number_hash = $2 THEN 2 ELSE 0 END DESC,
                 CASE WHEN phone_number_hash = md5($3) THEN 1 ELSE 0 END DESC
               LIMIT 1`,
              [intent.sender_user_id, recipientHash, recipientPhone],
            );

            if (!recipientRes.rows.length) {
              throw new Error('Recipient not found for funding intent');
            }

            {
              const row = recipientRes.rows[0];
              const phoneEnc = String(row.phone_number_encrypted ?? '');
              const nameEnc = String(row.full_name_encrypted ?? '');
              const needsPhoneEncFix = phoneEnc !== '' && !phoneEnc.includes(':');
              const needsNameEncFix = nameEnc !== '' && !nameEnc.includes(':');
              const needsHashFix = String(row.phone_number_hash ?? '') !== recipientHash;

              if (needsPhoneEncFix || needsNameEncFix || needsHashFix) {
                await client.query(
                  `UPDATE recipients
                   SET phone_number_hash = $1,
                       phone_number_encrypted = $2,
                       full_name_encrypted = $3,
                       updated_at = NOW()
                   WHERE recipient_id = $4`,
                  [
                    recipientHash,
                    needsPhoneEncFix ? encrypt(recipientPhone) : phoneEnc,
                    needsNameEncFix ? encrypt(nameEnc || 'Unknown') : nameEnc,
                    row.recipient_id,
                  ],
                );
              }
            }

            const escrowRes = await client.query(
              `INSERT INTO escrows (
                 sender_user_id,
                 recipient_id,
                 total_amount_usd_cents,
                 remaining_balance_usd_cents,
                 total_spent_usd_cents,
                 status,
                 expires_at,
                 memo,
                 funded_at,
                 activated_at
               )
               VALUES (
                 $1,
                 $2,
                 $3,
                 $3,
                 0,
                 'active',
                 NOW() + INTERVAL '90 days',
                 $4,
                 NOW(),
                 NOW()
               )
               RETURNING escrow_id`,
              [
                intent.sender_user_id,
                recipientRes.rows[0].recipient_id,
                Number(intent.total_amount_usd_cents),
                intent.memo,
              ],
            );

            const escrowId = escrowRes.rows[0].escrow_id;

            const cats = Array.isArray(intent.categories) ? intent.categories : intent.categories?.categories;
            const parsedCats = Array.isArray(cats)
              ? cats
              : (typeof intent.categories === 'string' ? JSON.parse(intent.categories) : intent.categories);

            const categories = Array.isArray(parsedCats) ? parsedCats : [];
            for (const c of categories) {
              const name = String(c?.name ?? '').toLowerCase();
              const amountUsd = Number(c?.amountUsd);
              const allocated = Math.round(amountUsd * 100);
              await client.query(
                `INSERT INTO spending_categories (
                   escrow_id,
                   category_name,
                   allocated_amount_usd_cents,
                   spent_amount_usd_cents,
                   remaining_amount_usd_cents
                 ) VALUES ($1,$2,$3,0,$3)`,
                [escrowId, name, allocated],
              );
            }

            await client.query(
              `UPDATE escrow_funding_intents
               SET status = 'confirmed', confirmed_at = NOW(), escrow_id = $1, updated_at = NOW()
               WHERE intent_id = $2`,
              [escrowId, intent.intent_id],
            );

            await client.query('COMMIT');
            return reply.send({
              success: true,
              intentId: intent.intent_id,
              status: 'confirmed',
              escrowId,
            });
          } catch (e) {
            await client.query('ROLLBACK');
            throw e;
          } finally {
            client.release();
          }
        }
      } catch {
        // If fallback lookup fails, keep status as pending and let webhook resolve.
      }
    }

    return reply.send({
      success: true,
      intentId: rows[0].intent_id,
      status: rows[0].status,
      escrowId: rows[0].escrow_id,
    });
  });

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
