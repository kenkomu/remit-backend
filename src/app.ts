import Fastify from 'fastify';
import cors from '@fastify/cors';

import authPlugin from './plugins/auth';
import { authRoutes } from './routes/auth.js';
import { escrowRoutes } from './routes/escrows.js';
import { paymentRequestRoutes } from './routes/paymentRequests';
// import { paymentRoutes } from './routes/payments.js';
import { recipientRoutes } from './routes/recipients.js';
import { webhookRoutes } from './routes/webhooks.js';
import { onrampRoutes } from './routes/onramp.js';
import { pretiumWebhookRoutes } from './routes/pretiumWebhook';
import { offrampRoutes } from './routes/offramp.js';
import { pretiumTransactionsRoutes } from './routes/pretiumTransactions.js';

import { initPrivy } from './services/privy.js';
import { scheduleDailySpendReset } from './jobs/resetDailySpend';

export async function buildApp() {
  const fastify = Fastify({ logger: true });

  await fastify.register(cors, { origin: true });

  initPrivy();

  // 🔐 Auth plugin
  await fastify.register(authPlugin);

  // Health
  fastify.get('/health', async () => ({ status: 'ok' }));

  // Routes
  await fastify.register(authRoutes, { prefix: '/auth' });
  await fastify.register(escrowRoutes, { prefix: '/escrows' });
  await fastify.register(paymentRequestRoutes);
  // await fastify.register(paymentRoutes, { prefix: '/payment-requests' });
  await fastify.register(recipientRoutes, { prefix: '/recipients' });
  await fastify.register(webhookRoutes, { prefix: '/webhooks' });
  await fastify.register(onrampRoutes, { prefix: '/onramp' });
  await fastify.register(pretiumWebhookRoutes, { prefix: '/webhooks/pretium' });
  await fastify.register(offrampRoutes, { prefix: '/offramp' });
  await fastify.register(pretiumTransactionsRoutes);


  // 🕛 Scheduled job
  if (process.env.NODE_ENV === 'production') {
    scheduleDailySpendReset();
  }

  return fastify;
}
