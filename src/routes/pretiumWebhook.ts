import { FastifyInstance } from 'fastify';
import { pool } from '../services/database.js';
import { withIdempotency } from '../services/redis.js';
import { encrypt, hashForLookup } from '../utils/crypto.js';

interface PretiumWebhookPayload {
  transaction_code: string;
  status: 'success' | 'failed';
  amount_usdc: string;
  tx_hash: string;
  chain: string;
}

export async function pretiumWebhookRoutes(fastify: FastifyInstance) {
  // NOTE: buildApp() registers this plugin with prefix `/webhooks/pretium`.
  // Keep the route path as `/` to avoid double-prefixing.
  fastify.post('/', async (req, reply) => {
    const payload = req.body as PretiumWebhookPayload;

    if (!payload?.transaction_code) {
      return reply.code(400).send({ error: 'Missing transaction_code' });
    }

    return withIdempotency(req, reply, 'pretium', payload.transaction_code, async () => {
      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        // New flow: funding intent (escrow created after confirmation)
        const intentRes = await client.query(
          `SELECT * FROM escrow_funding_intents WHERE pretium_transaction_code = $1 FOR UPDATE`,
          [payload.transaction_code],
        );

        if (intentRes.rows.length) {
          const intent = intentRes.rows[0];

          if (payload.status !== 'success') {
            await client.query(
              `UPDATE escrow_funding_intents
               SET status = 'failed', webhook_payload = $1, failed_at = NOW(), error_message = 'Pretium reported failure', updated_at = NOW()
               WHERE intent_id = $2`,
              [payload, intent.intent_id],
            );
            await client.query('COMMIT');
            return reply.code(200).send({ ok: true });
          }

          const receivedUsdCents = Math.round(Number(payload.amount_usdc) * 100);
          if (receivedUsdCents < Number(intent.expected_usdc_cents)) {
            throw new Error(
              `Underfunded intent: expected=${intent.expected_usdc_cents}, received=${receivedUsdCents}`,
            );
          }

          // Create escrow now (single transaction)
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

          // Migrate any legacy recipient rows so future lookups work via SHA-256 hash.
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

          // Insert categories from intent payload
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
             SET status = 'confirmed', webhook_payload = $1, confirmed_at = NOW(), escrow_id = $2, updated_at = NOW()
             WHERE intent_id = $3`,
            [payload, escrowId, intent.intent_id],
          );

          await client.query('COMMIT');
          return reply.code(200).send({ ok: true });
        }

        const onrampRes = await client.query(
          `SELECT * FROM onramp_transactions WHERE pretium_transaction_code = $1 FOR UPDATE`,
          [payload.transaction_code]
        );

        if (!onrampRes.rows.length) {
          throw new Error('Unknown transaction_code');
        }

        const onramp = onrampRes.rows[0];

        if (payload.status !== 'success') {
          await client.query(
            `UPDATE onramp_transactions SET status = 'failed', webhook_payload = $1, failed_at = NOW(), error_message = 'Pretium reported failure', updated_at = NOW() WHERE onramp_transaction_id = $2`,
            [payload, onramp.onramp_transaction_id]
          );

          await client.query('COMMIT');
          return reply.code(200).send({ ok: true });
        }

        const receivedUsdCents = Math.round(Number(payload.amount_usdc) * 100);

        if (receivedUsdCents < onramp.expected_usdc_cents) {
          throw new Error(
            `Underfunded escrow: expected=${onramp.expected_usdc_cents}, received=${receivedUsdCents}`
          );
        }

        await client.query(
          `UPDATE onramp_transactions SET status = 'confirmed', webhook_payload = $1, confirmed_at = NOW(), updated_at = NOW() WHERE onramp_transaction_id = $2`,
          [payload, onramp.onramp_transaction_id]
        );

        await client.query(
          `UPDATE escrows SET status = 'active', updated_at = NOW() WHERE escrow_id = $1 AND status = 'pending_deposit'`,
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
  });
}
