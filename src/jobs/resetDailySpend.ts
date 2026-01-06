// =====================================================
// SCHEDULED JOB: Reset Daily Spend Limits
// =====================================================
// Purpose: Run daily at midnight to reset spend limits
// =====================================================

import { resetDailySpend } from '../services/dailySpendService';
import { pool } from '../services/database';
import cron from 'node-cron';
import logger from '../utils/logger';

/**
 * Reset daily spend limits at midnight UTC
 */
export async function runDailySpendReset(): Promise<void> {
  const client = await pool.connect();
  
  try {
    logger.info('Starting daily spend reset job...');
    
    const deletedCount = await resetDailySpend();
    
    logger.info(`Daily spend reset completed. Deleted ${deletedCount} old records.`);
    
    // Log to audit_logs as well
    await client.query(
      `INSERT INTO audit_logs (
        action,
        resource_type,
        status,
        new_values
      ) VALUES ($1, $2, $3, $4)`,
      [
        'daily_spend.reset',
        'daily_spend',
        'success',
        JSON.stringify({ deleted_records: deletedCount, reset_at: new Date().toISOString() })
      ]
    );
    
  } catch (error) {
    logger.error('Daily spend reset job failed:', error);
    
    await client.query(
      `INSERT INTO audit_logs (
        action,
        resource_type,
        status,
        error_message
      ) VALUES ($1, $2, $3, $4)`,
      [
        'daily_spend.reset',
        'daily_spend',
        'error',
        error instanceof Error ? error.message : 'Unknown error'
      ]
    );
    
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Schedule the daily reset job
 */
export function scheduleDailySpendReset(): void {
  // Run at 00:01 UTC every day (just after midnight)
  cron.schedule('1 0 * * *', async () => {
    try {
      await runDailySpendReset();
    } catch (error) {
      logger.error('Scheduled daily spend reset failed:', error);
    }
  }, {
    timezone: 'UTC'
    // Removed the 'scheduled' option
  });

  logger.info('Daily spend reset job scheduled to run at 00:01 UTC daily');
}

/**
 * Manual trigger for testing
 */
export async function manualReset(): Promise<void> {
  try {
    await runDailySpendReset();
    console.log('Manual daily spend reset completed');
  } catch (error) {
    console.error('Manual daily spend reset failed:', error);
    throw error;
  }
}