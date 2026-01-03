import Fastify from 'fastify';
import cors from '@fastify/cors';
import { authRoutes } from './routes/auth.js';
import { escrowRoutes } from './routes/escrows.js';
import { paymentRoutes } from './routes/payments.js';
import { webhookRoutes } from './routes/webhooks.js';
import { testSupabaseConnection } from './services/supabase.js';
import { initPrivy } from './services/privy.js';

export async function buildApp() {
  const fastify = Fastify({
    logger: true
  });

  // Register CORS
  await fastify.register(cors, {
    origin: true
  });

  // Initialize services
  testSupabaseConnection();
  initPrivy();

  // Health check
  fastify.get('/health', async () => {
    return { status: 'ok' };
  });

  // Register routes
  await fastify.register(authRoutes, { prefix: '/auth' });
  await fastify.register(escrowRoutes, { prefix: '/escrows' });
  await fastify.register(paymentRoutes, { prefix: '/payment-requests' });
  await fastify.register(webhookRoutes, { prefix: '/webhooks' });

  return fastify;
}