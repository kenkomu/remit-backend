import { Queue } from 'bullmq';

// Only create queue if REDIS_URL is provided
export const spendQueue = process.env.REDIS_URL ? new Queue('usdc-spend', {
  connection: { url: process.env.REDIS_URL },
}) : null;

