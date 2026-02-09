import { FastifyInstance } from 'fastify';
import { getDailySpendStatus } from '../services/dailySpendService.js';
import { claimRecipientForUser, findRecipientByUserId, getRecipientDashboard } from '../services/database.js';
import { authMiddleware } from '../middleware/auth.js';

export async function recipientRoutes(fastify: FastifyInstance) {
  // ─────────────────────────────────────────────────────────────────────────
  // POST /recipients/me/claim
  // ─────────────────────────────────────────────────────────────────────────
  // Option B: One-time claim flow. Recipient proves they own a phone number
  // (via OTP) and we link the matching recipients row to the authenticated user.
  //
  // Phase 1 note: OTP is mocked; auth token encodes phone.
  // ─────────────────────────────────────────────────────────────────────────
  fastify.post(
    '/me/claim',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const recipientPhone = (request as any).recipientPhone;
      if (typeof recipientPhone !== 'string' || !recipientPhone.startsWith('+254')) {
        return reply.code(400).send({ error: 'Missing verified recipient phone' });
      }

      const claimed = await claimRecipientForUser({ userId, phone: recipientPhone });
      if (!claimed) {
        return reply.code(404).send({ error: 'Recipient not found' });
      }

      return reply.send({ success: true, recipientId: claimed.recipientId });
    },
  );

  // ─────────────────────────────────────────────────────────────────────────
  // GET /recipients/me/dashboard
  // ─────────────────────────────────────────────────────────────────────────
  // Returns aggregated dashboard data for the authenticated recipient.
  // Phase 1: Uses mock phone from auth context.
  // Phase 2: Will derive phone from JWT claims.
  // ─────────────────────────────────────────────────────────────────────────
  fastify.get(
    '/me/dashboard',
    { preHandler: authMiddleware },
    async (request, reply) => {
      try {
        const userId = request.user?.userId;
        if (!userId) {
          return reply.code(401).send({ error: 'Unauthorized' });
        }

        // Option B: direct lookup by linked user_id.
        let recipient = await findRecipientByUserId(userId);

        // Back-compat / Phase 1: if not linked yet, attempt one-time claim using verified phone.
        if (!recipient) {
          const recipientPhone = (request as any).recipientPhone;
          if (typeof recipientPhone === 'string' && recipientPhone.startsWith('+254')) {
            const claimed = await claimRecipientForUser({ userId, phone: recipientPhone });
            if (claimed) {
              recipient = await findRecipientByUserId(userId);
            }
          }
        }

        if (!recipient) {
          return reply.code(404).send({
            error: 'Recipient not found',
            message: 'No recipient account found for this phone number. Please contact the sender.'
          });
        }

        // Get full dashboard data
        const dashboard = await getRecipientDashboard(recipient.recipientId);

        return {
          success: true,
          data: dashboard
        };

      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({ error: error.message });
      }
    }
  );

  // ─────────────────────────────────────────────────────────────────────────
  // GET /recipients/:id/daily-spend (legacy endpoint)
  // ─────────────────────────────────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>(
    '/:id/daily-spend',
    async (request, reply) => {
      const { id } = request.params;

      try {
        const status = await getDailySpendStatus(id);

        return {
          dailyLimitUsd: status.dailyLimitCents / 100,
          spentTodayUsd: status.spentTodayCents / 100,
          remainingTodayUsd: status.remainingTodayCents / 100,
          transactionCount: status.transactionCount,
          lastTransactionAt: status.lastTransactionAt
        };

      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({ error: error.message });
      }
    }
  );
}
