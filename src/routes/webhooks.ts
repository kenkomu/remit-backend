import { FastifyInstance } from 'fastify';

export async function webhookRoutes(fastify: FastifyInstance) {
  // Stripe webhook
  fastify.post('/stripe', async (request, reply) => {
    console.log('[WEBHOOK:STRIPE] Received payload:', JSON.stringify(request.body, null, 2));
    return { received: true };
  });

  // M-Pesa webhook
  fastify.post('/mpesa', async (request, reply) => {
    console.log('[WEBHOOK:MPESA] Received payload:', JSON.stringify(request.body, null, 2));
    return { received: true };
  });
}