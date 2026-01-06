-- =====================================================
-- TRANSACTIONAL PATTERNS FOR FINANCIAL CORRECTNESS
-- =====================================================
-- Purpose: Critical SQL patterns for concurrent, safe operations
-- Design: ACID guarantees, row-level locking, idempotency
-- Context: Low-trust environment with concurrent requests
-- =====================================================

-- =====================================================
-- PATTERN 1: Create Escrow (Atomic)
-- =====================================================
-- Requirements:
-- - Escrow and categories created atomically
-- - Category allocations sum to total escrow amount
-- - Transaction fails if allocations don't match total
-- =====================================================

BEGIN;

-- Insert escrow
INSERT INTO escrows (
    sender_user_id,
    recipient_id,
    total_amount_usd_cents,
    remaining_balance_usd_cents,
    total_spent_usd_cents,
    status,
    expires_at
) VALUES (
    '550e8400-e29b-41d4-a716-446655440000', -- sender_user_id
    '6ba7b810-9dad-11d1-80b4-00c04fd430c8', -- recipient_id
    50000, -- $500.00
    50000, -- Initially all remaining
    0,     -- Nothing spent yet
    'pending_deposit',
    NOW() + INTERVAL '90 days'
) RETURNING escrow_id;

-- Store escrow_id for use in next queries
-- In application: const escrowId = result.rows[0].escrow_id;

-- Insert spending categories
-- NOTE: Sum of allocated_amount_usd_cents MUST equal escrow total
INSERT INTO spending_categories (escrow_id, category_name, allocated_amount_usd_cents, remaining_amount_usd_cents)
VALUES
    ('ESCROW_ID', 'electricity', 15000, 15000), -- $150
    ('ESCROW_ID', 'water', 10000, 10000),        -- $100
    ('ESCROW_ID', 'rent', 20000, 20000),         -- $200
    ('ESCROW_ID', 'food', 5000, 5000);           -- $50

-- Verify category allocations sum to escrow total
-- This query will return 0 if correct, non-zero if mismatch
SELECT 
    e.total_amount_usd_cents - COALESCE(SUM(sc.allocated_amount_usd_cents), 0) AS allocation_mismatch
FROM escrows e
LEFT JOIN spending_categories sc ON e.escrow_id = sc.escrow_id
WHERE e.escrow_id = 'ESCROW_ID'
GROUP BY e.escrow_id, e.total_amount_usd_cents;

-- If allocation_mismatch != 0, ROLLBACK
-- If allocation_mismatch = 0, COMMIT

COMMIT; -- Or ROLLBACK if verification fails

-- =====================================================
-- PATTERN 2: Approve Payment Request (with Locking)
-- =====================================================
-- Requirements:
-- - Lock escrow and category rows to prevent concurrent updates
-- - Verify sufficient balance in both escrow and category
-- - Atomically deduct from both balances
-- - Update payment request status
-- - Create settlement record
-- - Create audit log
-- =====================================================

BEGIN;

-- Step 1: Lock payment request (prevent double-approval)
SELECT payment_request_id, escrow_id, category_id, amount_usd_cents, status
FROM payment_requests
WHERE payment_request_id = 'PAYMENT_REQUEST_ID'
FOR UPDATE; -- Row-level lock

-- Verify status is 'pending_approval'
-- If not, ROLLBACK (already processed)

-- Step 2: Lock escrow (prevent concurrent balance changes)
SELECT escrow_id, remaining_balance_usd_cents, status
FROM escrows
WHERE escrow_id = 'ESCROW_ID'
FOR UPDATE;

-- Verify:
-- - status = 'active'
-- - remaining_balance_usd_cents >= amount_usd_cents
-- If not, ROLLBACK

-- Step 3: Lock category (prevent overspend in category)
SELECT category_id, remaining_amount_usd_cents
FROM spending_categories
WHERE category_id = 'CATEGORY_ID'
FOR UPDATE;

-- Verify:
-- - remaining_amount_usd_cents >= amount_usd_cents
-- If not, ROLLBACK

-- Step 4: Update escrow balance
UPDATE escrows
SET 
    remaining_balance_usd_cents = remaining_balance_usd_cents - 5000,
    total_spent_usd_cents = total_spent_usd_cents + 5000,
    updated_at = NOW()
WHERE escrow_id = 'ESCROW_ID';

-- Step 5: Update category balance
UPDATE spending_categories
SET 
    spent_amount_usd_cents = spent_amount_usd_cents + 5000,
    remaining_amount_usd_cents = remaining_amount_usd_cents - 5000,
    updated_at = NOW()
WHERE category_id = 'CATEGORY_ID';

-- Step 6: Update payment request status
UPDATE payment_requests
SET 
    status = 'approved',
    approved_by_user_id = 'APPROVER_USER_ID',
    approved_at = NOW(),
    updated_at = NOW()
WHERE payment_request_id = 'PAYMENT_REQUEST_ID';

-- Step 7: Create settlement record
INSERT INTO settlements (
    escrow_id,
    payment_request_id,
    amount_usd_cents,
    settlement_type,
    settled_by_user_id
) VALUES (
    'ESCROW_ID',
    'PAYMENT_REQUEST_ID',
    5000,
    'payment_release',
    'APPROVER_USER_ID'
);

-- Step 8: Create audit log
INSERT INTO audit_logs (
    user_id,
    escrow_id,
    payment_request_id,
    action,
    resource_type,
    resource_id,
    status,
    new_values
) VALUES (
    'APPROVER_USER_ID',
    'ESCROW_ID',
    'PAYMENT_REQUEST_ID',
    'payment_request.approved',
    'payment_requests',
    'PAYMENT_REQUEST_ID',
    'success',
    jsonb_build_object('amount_usd_cents', 5000, 'approved_at', NOW())
);

COMMIT; -- All-or-nothing transaction

-- =====================================================
-- PATTERN 3: Process M-Pesa Payment (Idempotent)
-- =====================================================
-- Requirements:
-- - Prevent duplicate payments with idempotency key
-- - Create M-Pesa payment record atomically
-- - Update payment request status
-- - Fail gracefully if duplicate
-- =====================================================

BEGIN;

-- Check if payment already exists (idempotency check)
SELECT mpesa_payment_id, status
FROM mpesa_payments
WHERE idempotency_key = 'unique-idempotency-key-12345'
FOR UPDATE;

-- If exists and status = 'completed', ROLLBACK (already processed)
-- If exists and status = 'failed', allow retry
-- If not exists, proceed

-- Insert M-Pesa payment record
INSERT INTO mpesa_payments (
    payment_request_id,
    escrow_id,
    recipient_id,
    amount_kes_cents,
    recipient_phone_number_encrypted,
    recipient_name_encrypted,
    status,
    idempotency_key,
    mpesa_originator_conversation_id
) VALUES (
    'PAYMENT_REQUEST_ID',
    'ESCROW_ID',
    'RECIPIENT_ID',
    500000, -- 5000 KES
    'ENCRYPTED_PHONE',
    'ENCRYPTED_NAME',
    'initiated',
    'unique-idempotency-key-12345',
    'REQ-12345-' || EXTRACT(EPOCH FROM NOW())::TEXT
) RETURNING mpesa_payment_id;

-- Update payment request status
UPDATE payment_requests
SET 
    status = 'processing',
    processing_started_at = NOW(),
    updated_at = NOW()
WHERE payment_request_id = 'PAYMENT_REQUEST_ID';

COMMIT;

-- =====================================================
-- PATTERN 4: Complete M-Pesa Payment (Webhook)
-- =====================================================
-- Requirements:
-- - Update M-Pesa payment status on webhook callback
-- - Update payment request to completed
-- - Record M-Pesa transaction ID
-- - Store webhook payload for audit
-- =====================================================

BEGIN;

-- Lock M-Pesa payment record
SELECT mpesa_payment_id, status, payment_request_id
FROM mpesa_payments
WHERE mpesa_conversation_id = 'MPESA_CONVERSATION_ID'
FOR UPDATE;

-- Verify status is 'initiated' or 'processing'
-- If already 'completed', ROLLBACK (duplicate webhook)

-- Update M-Pesa payment
UPDATE mpesa_payments
SET 
    status = 'completed',
    mpesa_transaction_id = 'QGK1234XYZ', -- M-Pesa receipt
    webhook_payload = '{"ResultCode": 0, "ResultDesc": "Success"}'::jsonb,
    completed_at = NOW(),
    updated_at = NOW()
WHERE mpesa_conversation_id = 'MPESA_CONVERSATION_ID';

-- Update payment request
UPDATE payment_requests
SET 
    status = 'completed',
    processing_completed_at = NOW(),
    updated_at = NOW()
WHERE payment_request_id = (
    SELECT payment_request_id 
    FROM mpesa_payments 
    WHERE mpesa_conversation_id = 'MPESA_CONVERSATION_ID'
);

-- Create audit log
INSERT INTO audit_logs (
    action,
    resource_type,
    resource_id,
    status,
    new_values
) VALUES (
    'mpesa_payment.completed',
    'mpesa_payments',
    (SELECT mpesa_payment_id FROM mpesa_payments WHERE mpesa_conversation_id = 'MPESA_CONVERSATION_ID'),
    'success',
    jsonb_build_object('mpesa_transaction_id', 'QGK1234XYZ', 'completed_at', NOW())
);

COMMIT;

-- =====================================================
-- PATTERN 5: Update Daily Spend Limit (Atomic)
-- =====================================================
-- Requirements:
-- - Atomically check and update daily spend
-- - Prevent exceeding daily limit
-- - Auto-create daily_spend record if not exists
-- - Use UPSERT (INSERT ... ON CONFLICT)
-- =====================================================

BEGIN;

-- Upsert daily spend record (creates if not exists)
INSERT INTO daily_spend (
    recipient_id,
    spend_date,
    daily_limit_usd_cents,
    spent_today_usd_cents,
    remaining_today_usd_cents,
    transaction_count,
    last_transaction_at
) VALUES (
    'RECIPIENT_ID',
    CURRENT_DATE,
    50000, -- $500 daily limit
    5000,  -- $50 this transaction
    45000, -- $450 remaining
    1,
    NOW()
)
ON CONFLICT (recipient_id, spend_date)
DO UPDATE SET
    spent_today_usd_cents = daily_spend.spent_today_usd_cents + 5000,
    remaining_today_usd_cents = daily_spend.remaining_today_usd_cents - 5000,
    transaction_count = daily_spend.transaction_count + 1,
    last_transaction_at = NOW(),
    updated_at = NOW()
WHERE daily_spend.remaining_today_usd_cents >= 5000; -- Only update if sufficient balance

-- Check if update succeeded (rows affected = 1)
-- If 0 rows affected, daily limit exceeded, ROLLBACK

COMMIT;

-- =====================================================
-- PATTERN 6: Refund Escrow (Return Funds)
-- =====================================================
-- Requirements:
-- - Return unused escrow funds to sender
-- - Mark escrow as completed/cancelled
-- - Create settlement record
-- - Atomic operation
-- =====================================================

BEGIN;

-- Lock escrow
SELECT escrow_id, remaining_balance_usd_cents, status
FROM escrows
WHERE escrow_id = 'ESCROW_ID'
FOR UPDATE;

-- Verify status allows refund (active, expired, or cancelled)

-- Calculate refund amount (remaining balance)
-- Store: const refundAmount = row.remaining_balance_usd_cents;

-- Update escrow to completed/cancelled
UPDATE escrows
SET 
    status = 'cancelled',
    remaining_balance_usd_cents = 0,
    updated_at = NOW()
WHERE escrow_id = 'ESCROW_ID';

-- Create settlement for refund
INSERT INTO settlements (
    escrow_id,
    amount_usd_cents,
    settlement_type,
    notes,
    settled_by_user_id
) VALUES (
    'ESCROW_ID',
    50000, -- refundAmount
    'refund',
    'Unused escrow funds returned to sender',
    'ADMIN_USER_ID' -- Or sender_user_id
);

-- Create audit log
INSERT INTO audit_logs (
    escrow_id,
    action,
    resource_type,
    resource_id,
    status,
    new_values
) VALUES (
    'ESCROW_ID',
    'escrow.refunded',
    'escrows',
    'ESCROW_ID',
    'success',
    jsonb_build_object('refund_amount_usd_cents', 50000, 'status', 'cancelled')
);

COMMIT;

-- =====================================================
-- PATTERN 7: Retry Failed M-Pesa Payment
-- =====================================================
-- Requirements:
-- - Increment retry count
-- - Check against max retries
-- - Update status to retry_pending
-- - Prevent infinite retry loop
-- =====================================================

BEGIN;

-- Lock payment request
SELECT payment_request_id, retry_count, max_retries, status
FROM payment_requests
WHERE payment_request_id = 'PAYMENT_REQUEST_ID'
FOR UPDATE;

-- Verify:
-- - status = 'failed'
-- - retry_count < max_retries

-- Increment retry count
UPDATE payment_requests
SET 
    retry_count = retry_count + 1,
    status = 'retry_pending',
    updated_at = NOW()
WHERE payment_request_id = 'PAYMENT_REQUEST_ID'
  AND retry_count < max_retries;

-- Check rows affected
-- If 0, max retries exceeded, ROLLBACK or mark as permanently failed

-- Update M-Pesa payment status
UPDATE mpesa_payments
SET 
    status = 'initiated', -- Reset for retry
    updated_at = NOW()
WHERE payment_request_id = 'PAYMENT_REQUEST_ID'
  AND status = 'failed';

COMMIT;

-- =====================================================
-- PATTERN 8: Expire Old Escrows (Scheduled Job)
-- =====================================================
-- Requirements:
-- - Run daily to expire stale escrows
-- - Automatically refund remaining balance
-- - Create settlement records
-- - Mark escrow as expired
-- =====================================================

BEGIN;

-- Find expired escrows
SELECT escrow_id, sender_user_id, remaining_balance_usd_cents
FROM escrows
WHERE status = 'active'
  AND expires_at < NOW()
FOR UPDATE;

-- For each expired escrow:
UPDATE escrows
SET 
    status = 'expired',
    updated_at = NOW()
WHERE escrow_id = 'EXPIRED_ESCROW_ID';

-- Create settlement for auto-return
INSERT INTO settlements (
    escrow_id,
    amount_usd_cents,
    settlement_type,
    notes
) VALUES (
    'EXPIRED_ESCROW_ID',
    25000, -- remaining_balance_usd_cents
    'expiry_return',
    'Escrow expired, funds automatically returned to sender'
);

-- Create audit log
INSERT INTO audit_logs (
    escrow_id,
    action,
    resource_type,
    resource_id,
    status,
    new_values
) VALUES (
    'EXPIRED_ESCROW_ID',
    'escrow.expired',
    'escrows',
    'EXPIRED_ESCROW_ID',
    'success',
    jsonb_build_object('expired_at', NOW(), 'refund_amount', 25000)
);

COMMIT;

-- =====================================================
-- HELPER QUERIES: Balance Verification
-- =====================================================

-- Verify escrow balance integrity
SELECT 
    escrow_id,
    total_amount_usd_cents,
    remaining_balance_usd_cents,
    total_spent_usd_cents,
    (total_amount_usd_cents - remaining_balance_usd_cents - total_spent_usd_cents) AS balance_error
FROM escrows
WHERE (total_amount_usd_cents - remaining_balance_usd_cents - total_spent_usd_cents) != 0;

-- Verify category balance integrity
SELECT 
    category_id,
    escrow_id,
    category_name,
    allocated_amount_usd_cents,
    spent_amount_usd_cents,
    remaining_amount_usd_cents,
    (allocated_amount_usd_cents - spent_amount_usd_cents - remaining_amount_usd_cents) AS balance_error
FROM spending_categories
WHERE (allocated_amount_usd_cents - spent_amount_usd_cents - remaining_amount_usd_cents) != 0;

-- Verify escrow total matches category allocations
SELECT 
    e.escrow_id,
    e.total_amount_usd_cents AS escrow_total,
    COALESCE(SUM(sc.allocated_amount_usd_cents), 0) AS category_total,
    (e.total_amount_usd_cents - COALESCE(SUM(sc.allocated_amount_usd_cents), 0)) AS mismatch
FROM escrows e
LEFT JOIN spending_categories sc ON e.escrow_id = sc.escrow_id
GROUP BY e.escrow_id, e.total_amount_usd_cents
HAVING (e.total_amount_usd_cents - COALESCE(SUM(sc.allocated_amount_usd_cents), 0)) != 0;

-- =====================================================
-- CRITICAL NOTES FOR IMPLEMENTATION
-- =====================================================

/*
1. ALWAYS use transactions for financial operations
2. ALWAYS lock rows with FOR UPDATE before balance changes
3. ALWAYS verify balances before deducting
4. ALWAYS check constraint violations after updates
5. ALWAYS log to audit_logs for financial actions
6. ALWAYS use idempotency keys for external API calls
7. NEVER assume sequential execution (concurrent requests)
8. NEVER trust client-provided amounts (recalculate server-side)
9. NEVER partially commit financial transactions
10. ALWAYS test with concurrent requests in load testing

REMEMBER: If money can disappear, appear, or double, the system is broken.
          Financial correctness > Performance > Elegance
*/