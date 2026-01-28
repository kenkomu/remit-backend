import { FastifyInstance } from 'fastify';
import { completeMpesaPayment } from '../services/database.js';
import { withIdempotency } from '../services/redis.js'; // import your wrapper

export async function webhookRoutes(fastify: FastifyInstance) {
  // M-Pesa webhook with Redis idempotency
  fastify.post('/mpesa', async (request, reply) => {
    console.log('[WEBHOOK:MPESA] Received:', JSON.stringify(request.body, null, 2));

    try {
      const payload = request.body as any;

      // M-Pesa callback structure
      const result = payload.Body?.stkCallback || payload.Result;

      if (!result) {
        return reply.code(400).send({ error: 'Invalid M-Pesa webhook payload' });
      }

      const conversationId = result.ConversationID || result.OriginatorConversationID;
      if (!conversationId) {
        return reply.code(400).send({ error: 'Missing ConversationID' });
      }

      // Idempotency wrapper
      return withIdempotency(request, reply, 'mpesa', conversationId, async () => {
        const resultCode = result.ResultCode;

        if (resultCode === 0) {
          // Success
          const transactionId = result.TransactionID;
          await completeMpesaPayment(conversationId, transactionId, payload);

          fastify.log.info(`M-Pesa payment completed: ${transactionId}`);
        } else {
          // Failed
          fastify.log.error(`M-Pesa payment failed: ${result.ResultDesc}`);

          // Optional: update payment status to 'failed' in DB if needed
        }

        return reply.code(200).send({ ok: true });
      });
    } catch (error: any) {
      fastify.log.error('M-Pesa webhook error:', error);
      return reply.code(500).send({ error: error.message });
    }
  });

  // Pretium webhook (leave for now)
  fastify.post('/pretium', async (request, reply) => {
    console.log('[WEBHOOK:PRETIUM] Received:', JSON.stringify(request.body, null, 2));
    // TODO: verify signature and handle onramp/offramp events
    return { received: true };
  });
}
