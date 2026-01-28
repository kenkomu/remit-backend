import { FastifyInstance } from 'fastify';
import { getTransactions } from '../services/pretiumTransactions.js';

function daysBetween(a: Date, b: Date) {
  return Math.floor((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

export async function pretiumTransactionsRoutes(fastify: FastifyInstance) {
  fastify.route({
    method: ['GET', 'POST'],
    url: '/transactions',
    handler: async (request, reply) => {
      try {
        const source = request.method === 'GET' ? request.query : request.body;
        const { currency, start_date, end_date } = source as any;

        if (!currency || !start_date || !end_date) {
          return reply.code(400).send({
            error: 'currency, start_date, and end_date are required',
          });
        }

        const start = new Date(start_date);
        const end = new Date(end_date);
        const today = new Date();

        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
          return reply.code(400).send({
            error: 'Invalid date format. Use YYYY-MM-DD',
          });
        }

        if (end < start) {
          return reply.code(400).send({
            error: 'end_date must be after start_date',
          });
        }

        // ✅ max 3-day range
        if (daysBetween(start, end) > 3) {
          return reply.code(400).send({
            error: 'Date range cannot exceed 3 days',
          });
        }

        // ✅ must be recent
        if (daysBetween(start, today) > 3 || daysBetween(end, today) > 3) {
          return reply.code(400).send({
            error: 'Dates must be within the last 3 days',
          });
        }

        const transactions = await getTransactions(currency, start_date, end_date);

        return {
          success: true,
          transactions,
        };
      } catch (err: any) {
        fastify.log.error(err);
        return reply.code(500).send({
          error: err.message || 'Internal server error',
        });
      }
    },
  });
}
