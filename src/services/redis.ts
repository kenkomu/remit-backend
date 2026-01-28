import { FastifyReply, FastifyRequest } from 'fastify';
import Redis from 'ioredis';

export const redis = new Redis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  
  // Add these parameters from forum solutions
  connectTimeout: 10000, // 10 seconds timeout
  keepAlive: 1000, // Keep connection alive
  retryStrategy: (times) => {
    // Exponential backoff with max delay of 3 seconds
    const delay = Math.min(times * 100, 3000);
    return delay;
  },
  
  // Add error handling
  maxRetriesPerRequest: 3,
  enableReadyCheck: false,
  
  // If you're having DNS issues, try using IP instead of hostname
  // family: 4, // Force IPv4
});

// Add event listeners for debugging
redis.on('error', (error) => {
  console.error('Redis error:', error);
});

redis.on('connect', () => {
  console.log('Redis connected successfully');
});

redis.on('ready', () => {
  console.log('Redis is ready');
});

redis.on('close', () => {
  console.log('Redis connection closed');
});

export async function withIdempotency(
  req: FastifyRequest,
  reply: FastifyReply,
  provider: string,
  transactionCode: string,
  handler: () => Promise<any>
) {
  const key = `webhook:${provider}:${transactionCode}`;

  const exists = await redis.exists(key);
  if (exists) {
    // Already processed
    return reply.code(200).send({ ok: true, message: 'Already processed' });
  }

  // Set key with 24h TTL
  await redis.set(key, '1', 'EX', 24 * 60 * 60);

  // Proceed with original handler
  return handler();
}