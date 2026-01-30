import { FastifyInstance } from 'fastify';
import { createEscrow } from '../services/database.js';
import type { CreateEscrowRequest, CreateEscrowResponse, ErrorResponse } from '../types/index.js';
import { pool } from '../services/database.js';
import { authMiddleware } from '../middleware/auth.js'; // ✅ import middleware
import { Queue } from 'bullmq';
import { getEscrowDetails } from '../services/onchainService.js';

// Queue for blockchain operations
const escrowQueue = new Queue('escrow-creation', { 
  connection: { host: '127.0.0.1', port: 6379 } 
});

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

        const existing = await pool.query(
          `SELECT recipient_id FROM recipients WHERE phone_number_encrypted = $1`,
          [recipientPhone]
        );

        if (existing.rows.length > 0) {
          recipientId = existing.rows[0].recipient_id;
        } else {
          const insertResult = await pool.query(
            `INSERT INTO recipients (
              created_by_user_id,
              phone_number_encrypted,
              phone_number_hash,
              country_code,
              is_verified,
              full_name_encrypted,
              created_at,
              updated_at
            )
            VALUES ($1, $2, md5($2), 'KE', false, 'Unknown', NOW(), NOW())
            RETURNING recipient_id`,
            [senderUserId, recipientPhone]
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

        // Queue blockchain escrow creation
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
