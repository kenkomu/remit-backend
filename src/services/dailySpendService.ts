// =====================================================
// DAILY SPEND LIMIT SERVICE
// =====================================================
// Purpose: Enforce daily spending limits per recipient
// Design: Race condition safe, atomic updates, concurrency control
// =====================================================

import { pool } from './database.js';
import { encrypt } from '../utils/crypto.js';

export interface CreatePaymentRequestInput {
  recipientId: string;
  escrowId: string;
  categoryId: string;
  categoryName?: string; // Category name to check for one-time payments
  amountKesCents: number;
  amountUsdCents: number;
  exchangeRate: number;
  merchantName: string;
  merchantAccount: string;
  invoiceUrl?: string;
  invoiceHash?: string;
}

// Categories that bypass daily spending limits (one-time payments)
const ONE_TIME_CATEGORIES = new Set(['rent', 'school', 'school fees', 'education']);

export interface DailySpendStatus {
  dailyLimitCents: number;
  spentTodayCents: number;
  remainingTodayCents: number;
  transactionCount: number;
  lastTransactionAt: Date | null;
}

/**
 * Create payment request with ENFORCED daily spend limit
 * Race condition safe, prevents double-spend, atomic
 * 
 * One-time payment categories (rent, school) bypass daily limits
 */
export async function createPaymentRequestWithDailyLimit(
  input: CreatePaymentRequestInput
): Promise<{ paymentRequestId: string; remainingDailyLimitCents: number }> {
  const client = await pool.connect();

  // Check if this is a one-time payment category that bypasses daily limits
  const categoryName = (input.categoryName || '').toLowerCase();
  const isOneTimePayment = ONE_TIME_CATEGORIES.has(categoryName);

  try {
    // ✅ START TRANSACTION
    await client.query('BEGIN');

    // 1. Ensure row exists
    await client.query(
      `INSERT INTO daily_spend (
        recipient_id,
        spend_date,
        daily_limit_usd_cents,
        spent_today_usd_cents,
        remaining_today_usd_cents,
        transaction_count,
        last_transaction_at
      )
      VALUES ($1, CURRENT_DATE, 50000, 0, 50000, 0, NULL)
      ON CONFLICT (recipient_id, spend_date) DO NOTHING`,
      [input.recipientId]
    );

    let remainingDaily = 0;

    // 2. Lock daily spend row and check limit (skip for one-time payments)
    if (!isOneTimePayment) {
      const dailySpendResult = await client.query(
        `SELECT remaining_today_usd_cents
         FROM daily_spend
         WHERE recipient_id = $1
           AND spend_date = CURRENT_DATE
         FOR UPDATE`,
        [input.recipientId]
      );

      remainingDaily = Number(
        dailySpendResult.rows[0].remaining_today_usd_cents
      );

      if (remainingDaily < input.amountUsdCents) {
        throw new Error('Daily limit exceeded');
      }
    } else {
      // For one-time payments, still lock the row but don't check the limit
      await client.query(
        `SELECT remaining_today_usd_cents
         FROM daily_spend
         WHERE recipient_id = $1
           AND spend_date = CURRENT_DATE
         FOR UPDATE`,
        [input.recipientId]
      );
    }

    // 3. Lock escrow
    await client.query(
      `SELECT escrow_id
       FROM escrows
       WHERE escrow_id = $1
       FOR UPDATE`,
      [input.escrowId]
    );

    // 4. Lock category
    await client.query(
      `SELECT category_id
       FROM spending_categories
       WHERE category_id = $1
       FOR UPDATE`,
      [input.categoryId]
    );

    // 5. Insert payment request
    const paymentResult = await client.query(
      `INSERT INTO payment_requests (
        escrow_id,
        category_id,
        requested_by_recipient_id,
        amount_kes_cents,
        amount_usd_cents,
        exchange_rate_kes_per_usd,
        merchant_name_encrypted,
        merchant_account_encrypted,
        status
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending_approval')
      RETURNING payment_request_id`,
      [
        input.escrowId,
        input.categoryId,
        input.recipientId,
        input.amountKesCents,
        input.amountUsdCents,
        input.exchangeRate,
        encrypt(input.merchantName),
        encrypt(input.merchantAccount)
      ]
    );

    const paymentRequestId = paymentResult.rows[0].payment_request_id;

    // 6. Atomic spend update (only deduct from daily limit if NOT a one-time payment)
    let finalRemainingDaily = 0;
    
    if (!isOneTimePayment) {
      // Regular categories: deduct from daily limit
      const updateResult = await client.query(
        `UPDATE daily_spend
         SET
           spent_today_usd_cents = spent_today_usd_cents + $1,
           remaining_today_usd_cents = remaining_today_usd_cents - $1,
           transaction_count = transaction_count + 1,
           last_transaction_at = NOW()
         WHERE recipient_id = $2
           AND spend_date = CURRENT_DATE
           AND remaining_today_usd_cents >= $1
         RETURNING remaining_today_usd_cents`,
        [input.amountUsdCents, input.recipientId]
      );

      if (updateResult.rowCount === 0) {
        throw new Error('Concurrent daily limit exhaustion');
      }

      finalRemainingDaily = Number(updateResult.rows[0].remaining_today_usd_cents);
    } else {
      // One-time payment categories: don't deduct from daily limit, just update transaction count
      const updateResult = await client.query(
        `UPDATE daily_spend
         SET
           transaction_count = transaction_count + 1,
           last_transaction_at = NOW()
         WHERE recipient_id = $1
           AND spend_date = CURRENT_DATE
         RETURNING remaining_today_usd_cents`,
        [input.recipientId]
      );

      finalRemainingDaily = Number(updateResult.rows[0].remaining_today_usd_cents);
    }

    // ✅ COMMIT AT END
    await client.query('COMMIT');

    return {
      paymentRequestId,
      remainingDailyLimitCents: finalRemainingDaily
    };

  } catch (err) {
    // ✅ ROLLBACK ACTUALLY MATTERS NOW
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Reset daily spend at midnight (scheduled job)
 */
export async function resetDailySpend(): Promise<number> {
  const result = await pool.query(
    `DELETE FROM daily_spend WHERE spend_date < CURRENT_DATE`
  );

  return result.rowCount || 0;
}

/**
 * Get recipient's daily spend status
 */
export async function getDailySpendStatus(recipientId: string): Promise<DailySpendStatus> {
  const result = await pool.query(
    `SELECT 
      daily_limit_usd_cents,
      spent_today_usd_cents,
      remaining_today_usd_cents,
      transaction_count,
      last_transaction_at
     FROM daily_spend
     WHERE recipient_id = $1 AND spend_date = CURRENT_DATE`,
    [recipientId]
  );

  if (result.rows.length === 0) {
    return {
      dailyLimitCents: 50000,
      spentTodayCents: 0,
      remainingTodayCents: 50000,
      transactionCount: 0,
      lastTransactionAt: null
    };
  }

  const row = result.rows[0];

  return {
    dailyLimitCents: Number(row.daily_limit_usd_cents),
    spentTodayCents: Number(row.spent_today_usd_cents),
    remainingTodayCents: Number(row.remaining_today_usd_cents),
    transactionCount: Number(row.transaction_count),
    lastTransactionAt: row.last_transaction_at
  };
}

/**
 * Manually adjust daily spend limit (admin function)
 */
export async function adjustDailyLimit(
  recipientId: string,
  newDailyLimitCents: number,
  adminUserId: string
): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get current daily spend
    const currentResult = await client.query(
      `SELECT spent_today_usd_cents, remaining_today_usd_cents
       FROM daily_spend
       WHERE recipient_id = $1 AND spend_date = CURRENT_DATE
       FOR UPDATE`,
      [recipientId]
    );

    let spentToday = 0;
    let newRemaining = newDailyLimitCents;

    if (currentResult.rows.length > 0) {
      spentToday = Number(currentResult.rows[0].spent_today_usd_cents);
      newRemaining = newDailyLimitCents - spentToday;

      if (newRemaining < 0) {
        throw new Error(`Cannot set limit below today's spend (${spentToday} cents)`);
      }

      // Update existing record
      await client.query(
        `UPDATE daily_spend
         SET 
           daily_limit_usd_cents = $1,
           remaining_today_usd_cents = $2,
           updated_at = NOW()
         WHERE recipient_id = $3 AND spend_date = CURRENT_DATE`,
        [newDailyLimitCents, newRemaining, recipientId]
      );
    } else {
      // Create new record
      await client.query(
        `INSERT INTO daily_spend (
          recipient_id,
          spend_date,
          daily_limit_usd_cents,
          spent_today_usd_cents,
          remaining_today_usd_cents,
          transaction_count
        ) VALUES ($1, CURRENT_DATE, $2, 0, $2, 0)`,
        [recipientId, newDailyLimitCents]
      );
    }

    // Audit log
    await client.query(
      `INSERT INTO audit_logs (
        user_id,
        action,
        resource_type,
        resource_id,
        status,
        new_values
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        adminUserId,
        'daily_limit.adjusted',
        'recipients',
        recipientId,
        'success',
        JSON.stringify({
          new_daily_limit_cents: newDailyLimitCents,
          previous_daily_limit_cents: currentResult.rows[0]?.daily_limit_usd_cents || 50000,
          spent_today_cents: spentToday,
          remaining_today_cents: newRemaining
        })
      ]
    );

    await client.query('COMMIT');

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get daily spend statistics for multiple recipients
 */
export async function getBulkDailySpendStatus(recipientIds: string[]): Promise<Record<string, DailySpendStatus>> {
  if (recipientIds.length === 0) return {};

  const result = await pool.query(
    `SELECT 
      recipient_id,
      daily_limit_usd_cents,
      spent_today_usd_cents,
      remaining_today_usd_cents,
      transaction_count,
      last_transaction_at
     FROM daily_spend
     WHERE recipient_id = ANY($1) AND spend_date = CURRENT_DATE`,
    [recipientIds]
  );

  const statuses: Record<string, DailySpendStatus> = {};

  // Initialize with defaults for all requested IDs
  recipientIds.forEach(id => {
    statuses[id] = {
      dailyLimitCents: 50000,
      spentTodayCents: 0,
      remainingTodayCents: 50000,
      transactionCount: 0,
      lastTransactionAt: null
    };
  });

  // Update with actual data
  result.rows.forEach((row: any) => {
    statuses[row.recipient_id] = {
      dailyLimitCents: Number(row.daily_limit_usd_cents),
      spentTodayCents: Number(row.spent_today_usd_cents),
      remainingTodayCents: Number(row.remaining_today_usd_cents),
      transactionCount: Number(row.transaction_count),
      lastTransactionAt: row.last_transaction_at
    };
  });

  return statuses;
}