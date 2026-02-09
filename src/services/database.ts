// =====================================================
// DATABASE SERVICE LAYER - PRODUCTION IMPLEMENTATION
// =====================================================
// Purpose: Type-safe database operations with transactions
// Design: Financial correctness, concurrency safety, audit logging
// =====================================================

import { Pool } from 'pg';
import { encrypt, decrypt, hashForLookup } from '../utils/crypto.js';

export const pool = new Pool({
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT) || 5432,
    database: process.env.DATABASE_NAME,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

// =====================================================
// TYPE DEFINITIONS
// =====================================================

export interface CreateEscrowInput {
    senderUserId: string;
    recipientId: string;
    totalAmountUsdCents: number;
    categories: Array<{
        name: string;
        allocatedAmountUsdCents: number;
    }>;
    expiresInDays?: number;
    memo?: string;
}

export interface ApprovePaymentInput {
    paymentRequestId: string;
    approverUserId: string;
    escrowId: string;
    categoryId: string;
    amountUsdCents: number;
}

export interface CreateMpesaPaymentInput {
    paymentRequestId: string;
    escrowId: string;
    recipientId: string;
    amountKesCents: number;
    recipientPhone: string;
    recipientName: string;
    idempotencyKey: string;
}

// =====================================================
// ESCROW OPERATIONS
// =====================================================

/**
 * Create new escrow with spending categories (atomic)
 * Returns escrow_id or throws error
 */
export async function createEscrow(input: CreateEscrowInput): Promise<string> {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Validate: Categories sum to total amount
        const categorySum = input.categories.reduce(
            (sum, cat) => sum + cat.allocatedAmountUsdCents,
            0
        );

        // if (categorySum !== input.totalAmountUsdCents) {
        //     throw new Error(
        //         `Category allocations (${categorySum}) must equal total amount (${input.totalAmountUsdCents})`
        //     );
        // }

        // Insert escrow
        const escrowResult = await client.query(
            `INSERT INTO escrows (
                sender_user_id,
                recipient_id,
                total_amount_usd_cents,
                remaining_balance_usd_cents,
                total_spent_usd_cents,
                status,
                expires_at,
                memo
            ) VALUES ($1, $2, $3, $4, $5, $6, NOW() + INTERVAL '${input.expiresInDays || 90} days', $7)
            RETURNING escrow_id`,
            [
                input.senderUserId,
                input.recipientId,
                input.totalAmountUsdCents,
                input.totalAmountUsdCents, // Initially all remaining
                0, // Nothing spent yet
                'pending_deposit',
                input.memo || null
            ]
        );

        const escrowId = escrowResult.rows[0].escrow_id;

        // Insert categories
        for (const category of input.categories) {
            await client.query(
                `INSERT INTO spending_categories (
                    escrow_id,
                    category_name,
                    allocated_amount_usd_cents,
                    spent_amount_usd_cents,
                    remaining_amount_usd_cents
                ) VALUES ($1, $2, $3, $4, $5)`,
                [
                    escrowId,
                    category.name,
                    category.allocatedAmountUsdCents,
                    0,
                    category.allocatedAmountUsdCents
                ]
            );
        }

        // Verify integrity - FIXED VERSION
        const verifyResult = await client.query(
            `SELECT 
                (SELECT total_amount_usd_cents FROM escrows WHERE escrow_id = $1) as escrow_total,
                (SELECT COALESCE(SUM(allocated_amount_usd_cents), 0) FROM spending_categories WHERE escrow_id = $1) as categories_total
            `,
            [escrowId]
        );

        const escrowTotal = verifyResult.rows[0].escrow_total;
        const categoriesTotal = verifyResult.rows[0].categories_total;

        if (escrowTotal !== categoriesTotal) {
            throw new Error(`Escrow balance integrity check failed: escrow=${escrowTotal}, categories=${categoriesTotal}, mismatch=${escrowTotal - categoriesTotal}`);
        }

        // Audit log
        await client.query(
            `INSERT INTO audit_logs (
                user_id, escrow_id, action, resource_type, resource_id, status, new_values
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
                input.senderUserId,
                escrowId,
                'escrow.created',
                'escrows',
                escrowId,
                'success',
                JSON.stringify({ total_amount_usd_cents: input.totalAmountUsdCents })
            ]
        );

        await client.query('COMMIT');
        return escrowId;

    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}
/**
 * Approve payment request and deduct from balances (atomic with locking)
 */
export async function approvePaymentRequest(input: ApprovePaymentInput): Promise<void> {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Lock payment request
        const paymentResult = await client.query(
            `SELECT payment_request_id, escrow_id, category_id, amount_usd_cents, status
       FROM payment_requests
       WHERE payment_request_id = $1
       FOR UPDATE`,
            [input.paymentRequestId]
        );

        if (paymentResult.rows.length === 0) {
            throw new Error('Payment request not found');
        }

        const payment = paymentResult.rows[0];

        if (payment.status !== 'pending_approval') {
            throw new Error(`Cannot approve payment in status: ${payment.status}`);
        }

        // Lock escrow
        const escrowResult = await client.query(
            `SELECT escrow_id, remaining_balance_usd_cents, status
       FROM escrows
       WHERE escrow_id = $1
       FOR UPDATE`,
            [input.escrowId]
        );

        const escrow = escrowResult.rows[0];

        if (escrow.status !== 'active') {
            throw new Error(`Escrow is not active: ${escrow.status}`);
        }

        if (escrow.remaining_balance_usd_cents < input.amountUsdCents) {
            throw new Error('Insufficient escrow balance');
        }

        // Lock category
        const categoryResult = await client.query(
            `SELECT category_id, remaining_amount_usd_cents
       FROM spending_categories
       WHERE category_id = $1
       FOR UPDATE`,
            [input.categoryId]
        );

        const category = categoryResult.rows[0];

        if (category.remaining_amount_usd_cents < input.amountUsdCents) {
            throw new Error('Insufficient category balance');
        }

        // Update escrow balance
        await client.query(
            `UPDATE escrows
       SET 
         remaining_balance_usd_cents = remaining_balance_usd_cents - $1,
         total_spent_usd_cents = total_spent_usd_cents + $1,
         updated_at = NOW()
       WHERE escrow_id = $2`,
            [input.amountUsdCents, input.escrowId]
        );

        // Update category balance
        await client.query(
            `UPDATE spending_categories
       SET 
         spent_amount_usd_cents = spent_amount_usd_cents + $1,
         remaining_amount_usd_cents = remaining_amount_usd_cents - $1,
         updated_at = NOW()
       WHERE category_id = $2`,
            [input.amountUsdCents, input.categoryId]
        );

        // Update payment request
        await client.query(
            `UPDATE payment_requests
       SET 
         status = 'approved',
         approved_by_user_id = $1,
         approved_at = NOW(),
         updated_at = NOW()
       WHERE payment_request_id = $2`,
            [input.approverUserId, input.paymentRequestId]
        );

        // Create settlement
        await client.query(
            `INSERT INTO settlements (
        escrow_id,
        payment_request_id,
        amount_usd_cents,
        settlement_type,
        settled_by_user_id
      ) VALUES ($1, $2, $3, $4, $5)`,
            [input.escrowId, input.paymentRequestId, input.amountUsdCents, 'payment_release', input.approverUserId]
        );

        // Audit log
        await client.query(
            `INSERT INTO audit_logs (
        user_id, escrow_id, payment_request_id, action, resource_type, resource_id, status, new_values
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
                input.approverUserId,
                input.escrowId,
                input.paymentRequestId,
                'payment_request.approved',
                'payment_requests',
                input.paymentRequestId,
                'success',
                JSON.stringify({ amount_usd_cents: input.amountUsdCents })
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

// =====================================================
// M-PESA PAYMENT OPERATIONS
// =====================================================

/**
 * Create M-Pesa payment record (idempotent)
 */
export async function createMpesaPayment(input: CreateMpesaPaymentInput): Promise<string> {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Check idempotency
        const existingResult = await client.query(
            `SELECT mpesa_payment_id, status
       FROM mpesa_payments
       WHERE idempotency_key = $1
       FOR UPDATE`,
            [input.idempotencyKey]
        );

        if (existingResult.rows.length > 0) {
            const existing = existingResult.rows[0];

            if (existing.status === 'completed') {
                await client.query('COMMIT');
                return existing.mpesa_payment_id; // Already processed
            }

            if (existing.status === 'failed') {
                // Allow retry
                await client.query(
                    `UPDATE mpesa_payments SET status = 'initiated', updated_at = NOW()
           WHERE mpesa_payment_id = $1`,
                    [existing.mpesa_payment_id]
                );
                await client.query('COMMIT');
                return existing.mpesa_payment_id;
            }

            // Still processing
            await client.query('COMMIT');
            return existing.mpesa_payment_id;
        }

        // Encrypt sensitive data
        const phoneEncrypted = encrypt(input.recipientPhone);
        const nameEncrypted = encrypt(input.recipientName);

        // Create new M-Pesa payment
        const mpesaResult = await client.query(
            `INSERT INTO mpesa_payments (
        payment_request_id,
        escrow_id,
        recipient_id,
        amount_kes_cents,
        recipient_phone_number_encrypted,
        recipient_name_encrypted,
        status,
        idempotency_key,
        mpesa_originator_conversation_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING mpesa_payment_id`,
            [
                input.paymentRequestId,
                input.escrowId,
                input.recipientId,
                input.amountKesCents,
                phoneEncrypted,
                nameEncrypted,
                'initiated',
                input.idempotencyKey,
                `REQ-${Date.now()}-${input.paymentRequestId.substring(0, 8)}`
            ]
        );

        const mpesaPaymentId = mpesaResult.rows[0].mpesa_payment_id;

        // Update payment request
        await client.query(
            `UPDATE payment_requests
       SET status = 'processing', processing_started_at = NOW(), updated_at = NOW()
       WHERE payment_request_id = $1`,
            [input.paymentRequestId]
        );

        await client.query('COMMIT');
        return mpesaPaymentId;

    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Complete M-Pesa payment on webhook callback
 */
export async function completeMpesaPayment(
    conversationId: string,
    transactionId: string,
    webhookPayload: any
): Promise<void> {
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Lock M-Pesa payment
        const mpesaResult = await client.query(
            `SELECT mpesa_payment_id, status, payment_request_id
       FROM mpesa_payments
       WHERE mpesa_conversation_id = $1
       FOR UPDATE`,
            [conversationId]
        );

        if (mpesaResult.rows.length === 0) {
            throw new Error('M-Pesa payment not found');
        }

        const mpesa = mpesaResult.rows[0];

        if (mpesa.status === 'completed') {
            // Duplicate webhook, ignore
            await client.query('COMMIT');
            return;
        }

        // Update M-Pesa payment
        await client.query(
            `UPDATE mpesa_payments
       SET 
         status = 'completed',
         mpesa_transaction_id = $1,
         webhook_payload = $2,
         completed_at = NOW(),
         updated_at = NOW()
       WHERE mpesa_conversation_id = $3`,
            [transactionId, JSON.stringify(webhookPayload), conversationId]
        );

        // Update payment request
        await client.query(
            `UPDATE payment_requests
       SET status = 'completed', processing_completed_at = NOW(), updated_at = NOW()
       WHERE payment_request_id = $1`,
            [mpesa.payment_request_id]
        );

        // Audit log
        await client.query(
            `INSERT INTO audit_logs (
        action, resource_type, resource_id, status, new_values
      ) VALUES ($1, $2, $3, $4, $5)`,
            [
                'mpesa_payment.completed',
                'mpesa_payments',
                mpesa.mpesa_payment_id,
                'success',
                JSON.stringify({ transaction_id: transactionId })
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

// =====================================================
// DAILY SPEND TRACKING
// =====================================================



// =====================================================
// USER OPERATIONS (with encryption)
// =====================================================

/**
 * Create new user with encrypted PII
 */
export async function createUser(
    privyUserId: string,
    phone: string,
    fullName: string,
    email?: string
): Promise<string> {
    const phoneEncrypted = encrypt(phone);
    const phoneHash = hashForLookup(phone);
    const nameEncrypted = encrypt(fullName);
    const emailEncrypted = email ? encrypt(email) : null;

    const result = await pool.query(
        `INSERT INTO users (
      privy_user_id,
      phone_number_encrypted,
      phone_number_hash,
      full_name_encrypted,
      email_encrypted
    ) VALUES ($1, $2, $3, $4, $5)
    RETURNING user_id`,
        [privyUserId, phoneEncrypted, phoneHash, nameEncrypted, emailEncrypted]
    );

    return result.rows[0].user_id;
}

/**
 * Find user by phone number (without decrypting all users)
 */
export async function findUserByPhone(phone: string): Promise<any | null> {
    const phoneHash = hashForLookup(phone);

    const result = await pool.query(
        `SELECT user_id, phone_number_encrypted, full_name_encrypted, email_encrypted, status
     FROM users
     WHERE phone_number_hash = $1`,
        [phoneHash]
    );

    if (result.rows.length === 0) {
        return null;
    }

    const row = result.rows[0];

    return {
        userId: row.user_id,
        phone: decrypt(row.phone_number_encrypted),
        fullName: decrypt(row.full_name_encrypted),
        email: row.email_encrypted ? decrypt(row.email_encrypted) : null,
        status: row.status
    };
}

/**
 * Find recipient by phone number (for recipient login flow)
 */
export async function findRecipientByPhone(phone: string): Promise<any | null> {
    const phoneHash = hashForLookup(phone);

    const result = await pool.query(
        `SELECT
            r.recipient_id,
            r.created_by_user_id,
            r.phone_number_encrypted,
            r.full_name_encrypted,
            r.is_verified,
            r.country_code
         FROM recipients r
         WHERE r.phone_number_hash = $1
         LIMIT 1`,
        [phoneHash]
    );

    if (result.rows.length === 0) {
        return null;
    }

    const row = result.rows[0];

    return {
        recipientId: row.recipient_id,
        createdByUserId: row.created_by_user_id,
        phone: decrypt(row.phone_number_encrypted),
        fullName: decrypt(row.full_name_encrypted),
        isVerified: row.is_verified,
        countryCode: row.country_code
    };
}

/** Find recipient by linked user_id (Option B). */
export async function findRecipientByUserId(userId: string): Promise<any | null> {
    const result = await pool.query(
        `SELECT
            r.recipient_id,
            r.created_by_user_id,
            r.phone_number_encrypted,
            r.full_name_encrypted,
            r.is_verified,
            r.country_code
         FROM recipients r
         WHERE r.user_id = $1
         LIMIT 1`,
        [userId],
    );

    if (result.rows.length === 0) {
        return null;
    }

    const row = result.rows[0];
    return {
        recipientId: row.recipient_id,
        createdByUserId: row.created_by_user_id,
        phone: decrypt(row.phone_number_encrypted),
        fullName: decrypt(row.full_name_encrypted),
        isVerified: row.is_verified,
        countryCode: row.country_code,
    };
}

/**
 * Link a recipient record to the recipient's own user account.
 * One-time claim: match by phone_hash, then set user_id.
 */
export async function claimRecipientForUser(params: {
    userId: string;
    phone: string;
}): Promise<{ recipientId: string } | null> {
    const phoneHash = hashForLookup(params.phone);
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // If already claimed, return it.
        const existing = await client.query(
            `SELECT recipient_id
             FROM recipients
             WHERE user_id = $1
             FOR UPDATE`,
            [params.userId],
        );
        if (existing.rows.length) {
            await client.query('COMMIT');
            return { recipientId: existing.rows[0].recipient_id };
        }

        // Find the matching recipient by phone (unclaimed or already linked elsewhere).
        const match = await client.query(
            `SELECT recipient_id, user_id
             FROM recipients
             WHERE phone_number_hash = $1
             FOR UPDATE`,
            [phoneHash],
        );

        if (!match.rows.length) {
            await client.query('ROLLBACK');
            return null;
        }

        if (match.rows[0].user_id && match.rows[0].user_id !== params.userId) {
            throw new Error('Recipient already claimed by another user');
        }

        await client.query(
            `UPDATE recipients
             SET user_id = $1, updated_at = NOW()
             WHERE recipient_id = $2`,
            [params.userId, match.rows[0].recipient_id],
        );

        await client.query('COMMIT');
        return { recipientId: match.rows[0].recipient_id };
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}

/**
 * Get recipient dashboard data (aggregated across all active escrows)
 * Production-ready: single query for efficiency, handles edge cases
 */
export async function getRecipientDashboard(recipientId: string): Promise<{
    recipient: { id: string; phone: string; name: string };
    dailySpend: {
        limitUsd: number;
        spentTodayUsd: number;
        remainingTodayUsd: number;
        transactionCount: number;
    };
    categories: Array<{
        category: string;
        allocatedUsd: number;
        spentUsd: number;
        remainingUsd: number;
        escrowCount: number;
    }>;
    activeEscrows: Array<{
        escrowId: string;
        totalUsd: number;
        remainingUsd: number;
        expiresAt: Date;
        categories: string[];
    }>;
}> {
    // 1. Get recipient info
    const recipientResult = await pool.query(
        `SELECT recipient_id, phone_number_encrypted, full_name_encrypted
         FROM recipients WHERE recipient_id = $1`,
        [recipientId]
    );

    if (recipientResult.rows.length === 0) {
        throw new Error('Recipient not found');
    }

    const recipientRow = recipientResult.rows[0];
    const recipient = {
        id: recipientRow.recipient_id,
        phone: decrypt(recipientRow.phone_number_encrypted),
        name: decrypt(recipientRow.full_name_encrypted)
    };

    // 2. Get daily spend status
    const dailyResult = await pool.query(
        `SELECT
            COALESCE(daily_limit_usd_cents, 50000) as limit_cents,
            COALESCE(spent_today_usd_cents, 0) as spent_cents,
            COALESCE(remaining_today_usd_cents, 50000) as remaining_cents,
            COALESCE(transaction_count, 0) as tx_count
         FROM daily_spend
         WHERE recipient_id = $1 AND spend_date = CURRENT_DATE`,
        [recipientId]
    );

    const dailySpend = dailyResult.rows.length > 0
        ? {
            limitUsd: Number(dailyResult.rows[0].limit_cents) / 100,
            spentTodayUsd: Number(dailyResult.rows[0].spent_cents) / 100,
            remainingTodayUsd: Number(dailyResult.rows[0].remaining_cents) / 100,
            transactionCount: Number(dailyResult.rows[0].tx_count)
        }
        : { limitUsd: 500, spentTodayUsd: 0, remainingTodayUsd: 500, transactionCount: 0 };

    // 3. Get per-category aggregates across ALL active escrows
    const categoryResult = await pool.query(
        `SELECT
            sc.category_name,
            SUM(sc.allocated_amount_usd_cents) as total_allocated,
            SUM(sc.spent_amount_usd_cents) as total_spent,
            SUM(sc.remaining_amount_usd_cents) as total_remaining,
            COUNT(DISTINCT e.escrow_id) as escrow_count
         FROM spending_categories sc
         JOIN escrows e ON sc.escrow_id = e.escrow_id
         WHERE e.recipient_id = $1 AND e.status = 'active'
         GROUP BY sc.category_name
         ORDER BY total_remaining DESC`,
        [recipientId]
    );

    const categories = categoryResult.rows.map(row => ({
        category: row.category_name,
        allocatedUsd: Number(row.total_allocated) / 100,
        spentUsd: Number(row.total_spent) / 100,
        remainingUsd: Number(row.total_remaining) / 100,
        escrowCount: Number(row.escrow_count)
    }));

    // 4. Get active escrows summary
    const escrowResult = await pool.query(
        `SELECT
            e.escrow_id,
            e.total_amount_usd_cents,
            e.remaining_balance_usd_cents,
            e.expires_at,
            ARRAY_AGG(sc.category_name) as categories
         FROM escrows e
         LEFT JOIN spending_categories sc ON e.escrow_id = sc.escrow_id
         WHERE e.recipient_id = $1 AND e.status = 'active'
         GROUP BY e.escrow_id, e.total_amount_usd_cents, e.remaining_balance_usd_cents, e.expires_at
         ORDER BY e.expires_at ASC`,
        [recipientId]
    );

    const activeEscrows = escrowResult.rows.map(row => ({
        escrowId: row.escrow_id,
        totalUsd: Number(row.total_amount_usd_cents) / 100,
        remainingUsd: Number(row.remaining_balance_usd_cents) / 100,
        expiresAt: row.expires_at,
        categories: row.categories || []
    }));

    return { recipient, dailySpend, categories, activeEscrows };
}

/**
 * Create recipient record
 */
export async function createRecipient(
    userId: string,
    phone: string,
    fullName: string
): Promise<string> {
    const phoneEncrypted = encrypt(phone);
    const nameEncrypted = encrypt(fullName);
    const phoneHash = hashForLookup(phone);

    const result = await pool.query(
        `INSERT INTO recipients (
      created_by_user_id,
      phone_number_encrypted,
      phone_number_hash,
      full_name_encrypted,
      country_code
    ) VALUES ($1, $2, $3, $4, $5)
    RETURNING recipient_id`,
        [userId, phoneEncrypted, phoneHash, nameEncrypted, 'KE']
    );

    return result.rows[0].recipient_id;
}
// =====================================================
// HEALTH CHECK & UTILITIES
// =====================================================

/**
 * Test database connection
 */
export async function testConnection(): Promise<boolean> {
    try {
        await pool.query('SELECT 1');
        return true;
    } catch (error) {
        console.error('Database connection failed:', error);
        return false;
    }
}

/**
 * Graceful shutdown
 */
export async function closePool(): Promise<void> {
    await pool.end();
}


// =====================================================
// EXPORT DAILY SPEND FUNCTIONS (from dailySpendService.ts)
// =====================================================

export {
  getDailySpendStatus
} from './dailySpendService.js';
