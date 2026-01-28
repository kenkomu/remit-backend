import { FastifyInstance } from 'fastify';
import { getDailySpendStatus } from '../services/dailySpendService.js';

export async function recipientRoutes(fastify: FastifyInstance) {
  // Get daily spend status
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