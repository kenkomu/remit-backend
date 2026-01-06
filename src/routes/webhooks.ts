import { FastifyInstance } from 'fastify';
import { completeMpesaPayment } from '../services/database';

export async function webhookRoutes(fastify: FastifyInstance) {
  // M-Pesa webhook
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
      const resultCode = result.ResultCode;

      if (resultCode === 0) {
        // Success
        const transactionId = result.TransactionID;

        await completeMpesaPayment(conversationId, transactionId, payload);

        fastify.log.info(`M-Pesa payment completed: ${transactionId}`);
      } else {
        // Failed
        fastify.log.error(`M-Pesa payment failed: ${result.ResultDesc}`);

        // TODO: Update payment status to 'failed'
      }

      return { received: true };

    } catch (error: any) {
      fastify.log.error('M-Pesa webhook error:', error);
      return reply.code(500).send({ error: error.message });
    }
  });

  // Pretium webhook
  fastify.post('/pretium', async (request, reply) => {
    console.log('[WEBHOOK:PRETIUM] Received:', JSON.stringify(request.body, null, 2));

    // TODO: verify signature (important)
    // TODO: handle onramp/offramp events

    return { received: true };
  });
}