import { FastifyInstance } from 'fastify';
import { createEscrow } from '../services/database.js';
import type { CreateEscrowRequest, CreateEscrowResponse, ErrorResponse } from '../types/index.js';
import { pool } from '../services/database.js';
import { authMiddleware } from '../middleware/auth.js'; // ✅ import middleware
import { Queue } from 'bullmq';
import { getEscrowDetails } from '../services/onchainService.js';
import { encrypt, hashForLookup } from '../utils/crypto.js';

// Queue for blockchain operations (only if Redis is available)
let escrowQueue: Queue | null = null;
try {
  if (process.env.REDIS_URL) {
    escrowQueue = new Queue('escrow-creation', { 
      connection: { url: process.env.REDIS_URL }
    });
  }
} catch (error) {
  console.warn('⚠️ Failed to create escrow queue:', (error as any).message);
}

export async function escrowRoutes(fastify: FastifyInstance) {
  // Create escrow
  fastify.post<{
    Body: CreateEscrowRequest;
    Reply: CreateEscrowResponse | ErrorResponse;
  }>(
    '/',
    { preHandler: authMiddleware }, // ✅ enforce auth
    async (request, reply) => {
      const { recipientPhone, totalAmountUsd, categories } = request.body;

      const senderUserId = request.user?.userId; // ✅ only source of truth

      if (!senderUserId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      if (!recipientPhone || !totalAmountUsd || !categories) {
        return reply.code(400).send({
          error: 'recipientPhone, totalAmountUsd, and categories are required',
        });
      }

        try {
          // 🔑 Lookup or create recipient
          let recipientId: string;

          const recipientHash = hashForLookup(recipientPhone);
          const existing = await pool.query(
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
            [senderUserId, recipientHash, recipientPhone],
          );

          if (existing.rows.length > 0) {
            const row = existing.rows[0];
            recipientId = row.recipient_id;

            // Migrate legacy recipient rows created before hashing/encryption were standardized.
            const phoneEnc = String(row.phone_number_encrypted ?? '');
            const nameEnc = String(row.full_name_encrypted ?? '');
            const needsPhoneEncFix = phoneEnc !== '' && !phoneEnc.includes(':');
            const needsNameEncFix = nameEnc !== '' && !nameEnc.includes(':');
            const needsHashFix = String(row.phone_number_hash ?? '') !== recipientHash;

            if (needsPhoneEncFix || needsNameEncFix || needsHashFix) {
              await pool.query(
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
                  recipientId,
                ],
              );
            }
          } else {
            const insertResult = await pool.query(
              `INSERT INTO recipients (
                 created_by_user_id,
                 phone_number_encrypted,
                 phone_number_hash,
                 full_name_encrypted,
                 country_code
               )
               VALUES ($1,$2,$3,$4,'KE')
               RETURNING recipient_id`,
              [senderUserId, encrypt(recipientPhone), recipientHash, encrypt('Unknown')],
            );
            recipientId = insertResult.rows[0].recipient_id;
          }

        const totalAmountUsdCents = Math.round(totalAmountUsd * 100);

        const dbCategories = categories.map((cat) => ({
          name: cat.name,
          allocatedAmountUsdCents: Math.round(cat.amountUsd * 100),
        }));

        const escrowId = await createEscrow({
          senderUserId,
          recipientId,
          totalAmountUsdCents,
          categories: dbCategories,
        });

         // Queue blockchain escrow creation (only if Redis is available)
         if (escrowQueue) {
           try {
             await escrowQueue.add(
               'create-escrow',
               {
                 escrowId,
                 purpose: categories[0]?.name || 'general',
                 durationDays: 90, // Default 90 days
                 amountUsdCents: totalAmountUsdCents,
                 requestedByUserId: senderUserId,
               },
               {
                 attempts: 3,
                 backoff: {
                   type: 'exponential',
                   delay: 2000,
                 },
               }
             );

             console.log('🚀 Escrow queued for blockchain creation:', escrowId);
           } catch (queueError) {
             console.error('⚠️ Failed to queue escrow creation:', queueError);
             // Continue anyway - escrow exists in database
           }
         } else {
           console.warn('⚠️ Redis not available, escrow creation queued skipped (will be created on-chain later)');
         }

        return reply.code(201).send({
          escrowId,
          status: 'pending_deposit',
          totalAmountUsd,
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({ error: error.message });
      }
    }
  );

  // Get escrow by ID (unchanged)
  fastify.get<{ Params: { id: string } }>(
    '/:id',
    async (request, reply) => {
      const { id } = request.params;

      try {
        const result = await pool.query(
          `SELECT 
             e.escrow_id,
             e.status,
             e.total_spent_usd_cents,
             json_agg(
               json_build_object(
                 'name', sc.category_name,
                 'remainingUsd', sc.remaining_amount_usd_cents / 100.0
               )
             ) AS categories
           FROM escrows e
           LEFT JOIN spending_categories sc 
             ON e.escrow_id = sc.escrow_id
           WHERE e.escrow_id = $1
           GROUP BY e.escrow_id`,
          [id]
        );

        if (result.rows.length === 0) {
          return reply.code(404).send({ error: 'Escrow not found' });
        }

        const escrow = result.rows[0];

        return {
          escrowId: escrow.escrow_id,
          status: escrow.status,
          spentUsd: escrow.total_spent_usd_cents / 100,
          categories: escrow.categories,
        };
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({ error: error.message });
      }
    }
  );
}
