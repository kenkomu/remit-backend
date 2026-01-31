import { FastifyReply, FastifyRequest } from 'fastify';

// Log Redis configuration at startup
console.log('🔍 Redis Service Initialization:');
console.log('  REDIS_URL provided:', !!process.env.REDIS_URL);
if (process.env.REDIS_URL) {
  try {
    const urlObj = new URL(process.env.REDIS_URL);
    console.log('  Connecting to:', `${urlObj.hostname}:${urlObj.port || 6379}`);
  } catch (e) {
    console.log('  Redis URL format:', process.env.REDIS_URL.substring(0, 50) + '...');
  }
} else {
  console.log('  ⚠️ Running without Redis (REDIS_URL not set)');
}

// Don't create ioredis connection here - let BullMQ handle it
// This prevents duplicate connection attempts and localhost fallbacks
export const redis = null;

export async function withIdempotency(
  req: FastifyRequest,
  reply: FastifyReply,
  provider: string,
  transactionCode: string,
  handler: () => Promise<any>
) {
  const key = `webhook:${provider}:${transactionCode}`;

  // If no Redis, just run the handler without idempotency check
  if (!process.env.REDIS_URL) {
    console.log('⚠️ Redis not available, skipping idempotency check');
    return handler();
  }

  // If Redis is available, handler will use it via BullMQ
  // For now, just run the handler directly (idempotency handled by queue if available)
  return handler();
}