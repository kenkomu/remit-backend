import { FastifyInstance } from 'fastify';
import { createEscrow } from '../services/database';
import type { CreateEscrowRequest, CreateEscrowResponse, ErrorResponse } from '../types/index.js';
import { pool } from '../services/database.js';

export async function escrowRoutes(fastify: FastifyInstance) {
    // Create escrow
    fastify.post<{
        Body: CreateEscrowRequest;
        Reply: CreateEscrowResponse | ErrorResponse;
    }>('/', async (request, reply) => {
        const { recipientPhone, totalAmountUsd, categories } = request.body;

        if (!recipientPhone || !totalAmountUsd || !categories) {
            return reply.code(400).send({
                error: 'recipientPhone, totalAmountUsd, and categories are required',
            });
        }

        try {
            // TODO: Get senderUserId from auth token
            const senderUserId = request.headers['x-user-id'] as string;

            // 🔑 Lookup or create recipient (simple: match by phone number string)
            let recipientId: string;
            const existing = await pool.query(
                `SELECT recipient_id 
         FROM recipients 
         WHERE phone_number_encrypted = $1`,
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
    VALUES ($1, $2, md5($2), $3, false, $4, NOW(), NOW())
    RETURNING recipient_id`,
                    [senderUserId, recipientPhone, 'KE', 'Unknown'] // <-- 'Unknown' as placeholder
                );

                recipientId = insertResult.rows[0].recipient_id;
            }

            // Convert USD to cents
            const totalAmountUsdCents = Math.round(totalAmountUsd * 100);

            // Map categories to database format
            const dbCategories = categories.map((cat) => ({
                name: cat.name,
                allocatedAmountUsdCents: Math.round(cat.amountUsd * 100),
            }));

            // Create escrow in database
            const escrowId = await createEscrow({
                senderUserId,
                recipientId,
                totalAmountUsdCents,
                categories: dbCategories,
            });

            return {
                escrowId,
                status: 'pending_deposit',
                totalAmountUsd,
            };
        } catch (error: any) {
            fastify.log.error(error);
            return reply.code(500).send({ error: error.message });
        }
    });

    // Get escrow by ID
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
