-- =====================================================
-- REMIT DATABASE SCHEMA - PRODUCTION FINTECH SYSTEM
-- =====================================================
-- Purpose: Invoice-locked migrant remittances (Kenya MVP)
-- Design: Optimized for correctness, audit, and concurrency
-- Database: PostgreSQL 14+
-- Assumptions: Low trust, concurrent requests, financial correctness
-- =====================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- TABLE: users
-- =====================================================
-- Purpose: Senders (diaspora users who create escrows)
-- Security: PII encrypted at application level before storage
-- =====================================================

CREATE TABLE users (
    -- Identity
    user_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Authentication (Privy integration)
    privy_user_id VARCHAR(255) UNIQUE NOT NULL, -- Privy's unique identifier
    
    -- Contact (ENCRYPTED)
    phone_number_encrypted TEXT NOT NULL, -- E.164 format, encrypted (e.g., +254712345678)
    phone_number_hash VARCHAR(64) UNIQUE NOT NULL, -- SHA-256 hash for lookups without decryption
    
    -- Personal Info (ENCRYPTED - PII)
    full_name_encrypted TEXT, -- User's full legal name
    email_encrypted TEXT, -- Email address if provided
    
    -- Metadata
    country_code CHAR(2) NOT NULL DEFAULT 'US', -- ISO 3166-1 alpha-2 (sender's country)
    kyc_status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending | verified | rejected
    kyc_verified_at TIMESTAMPTZ, -- When KYC was completed
    
    -- Account status
    status VARCHAR(20) NOT NULL DEFAULT 'active', -- active | suspended | closed
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMPTZ,
    
    -- Constraints
    CONSTRAINT users_status_check CHECK (status IN ('active', 'suspended', 'closed')),
    CONSTRAINT users_kyc_check CHECK (kyc_status IN ('pending', 'verified', 'rejected'))
);

-- Indexes for performance
CREATE INDEX idx_users_privy ON users(privy_user_id);
CREATE INDEX idx_users_phone_hash ON users(phone_number_hash);
CREATE INDEX idx_users_status ON users(status) WHERE status = 'active';
CREATE INDEX idx_users_created ON users(created_at DESC);

COMMENT ON TABLE users IS 'Senders (diaspora) who create and fund escrows';
COMMENT ON COLUMN users.phone_number_encrypted IS 'ENCRYPTED: E.164 phone number (PII)';
COMMENT ON COLUMN users.phone_number_hash IS 'SHA-256 hash for lookups without decryption';
COMMENT ON COLUMN users.full_name_encrypted IS 'ENCRYPTED: Full legal name (PII)';
COMMENT ON COLUMN users.email_encrypted IS 'ENCRYPTED: Email address (PII)';

-- =====================================================
-- TABLE: recipients
-- =====================================================
-- Purpose: Beneficiaries in Kenya who receive funds
-- Security: PII encrypted, linked to sender
-- =====================================================

CREATE TABLE recipients (
    -- Identity
    recipient_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Ownership
    created_by_user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    
    -- Contact (ENCRYPTED)
    phone_number_encrypted TEXT NOT NULL, -- E.164 format, encrypted (Kenyan M-Pesa number)
    phone_number_hash VARCHAR(64) NOT NULL, -- SHA-256 hash for lookups
    
    -- Personal Info (ENCRYPTED - PII)
    full_name_encrypted TEXT NOT NULL, -- Recipient's full name
    relationship_encrypted TEXT, -- Relationship to sender (e.g., "mother", "spouse")
    
    -- Metadata
    country_code CHAR(2) NOT NULL DEFAULT 'KE', -- Always Kenya for MVP
    
    -- Verification
    is_verified BOOLEAN NOT NULL DEFAULT FALSE, -- Has recipient confirmed their identity?
    verified_at TIMESTAMPTZ,
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT recipients_unique_per_user UNIQUE(created_by_user_id, phone_number_hash)
);

-- Indexes
CREATE INDEX idx_recipients_user ON recipients(created_by_user_id);
CREATE INDEX idx_recipients_phone_hash ON recipients(phone_number_hash);
CREATE INDEX idx_recipients_created ON recipients(created_at DESC);

COMMENT ON TABLE recipients IS 'Beneficiaries in Kenya who receive escrow funds';
COMMENT ON COLUMN recipients.phone_number_encrypted IS 'ENCRYPTED: Kenyan M-Pesa number (PII)';
COMMENT ON COLUMN recipients.full_name_encrypted IS 'ENCRYPTED: Recipient full name (PII)';
COMMENT ON COLUMN recipients.relationship_encrypted IS 'ENCRYPTED: Relationship to sender (PII)';

-- =====================================================
-- TABLE: escrows
-- =====================================================
-- Purpose: Core escrow contracts between sender and recipient
-- Financial: All amounts in USD cents (to avoid floating point)
-- Concurrency: Row-level locking for balance updates
-- =====================================================

CREATE TABLE escrows (
    -- Identity
    escrow_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Parties
    sender_user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    recipient_id UUID NOT NULL REFERENCES recipients(recipient_id) ON DELETE RESTRICT,
    
    -- Financial (all amounts in USD CENTS to avoid floating point errors)
    total_amount_usd_cents BIGINT NOT NULL, -- Original escrow amount (e.g., 50000 = $500.00)
    remaining_balance_usd_cents BIGINT NOT NULL, -- Current available balance
    total_spent_usd_cents BIGINT NOT NULL DEFAULT 0, -- Total released so far
    
    -- Blockchain (placeholder for future integration)
    blockchain_contract_address VARCHAR(255), -- Smart contract address (Stellar/Base)
    blockchain_tx_hash VARCHAR(255), -- Creation transaction hash
    blockchain_status VARCHAR(20) DEFAULT 'pending', -- pending | deployed | failed
    
    -- State machine
    status VARCHAR(20) NOT NULL DEFAULT 'pending_deposit', 
    -- pending_deposit -> active -> completed | cancelled | expired
    
    -- Lifecycle timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    funded_at TIMESTAMPTZ, -- When initial deposit confirmed
    activated_at TIMESTAMPTZ, -- When escrow becomes active
    completed_at TIMESTAMPTZ, -- When all funds released
    expires_at TIMESTAMPTZ, -- Auto-expiry date (e.g., 90 days from creation)
    
    -- Metadata
    currency_code CHAR(3) NOT NULL DEFAULT 'USD',
    memo TEXT, -- Optional note from sender
    
    -- Timestamps
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Constraints: Balance integrity
    CONSTRAINT escrows_amounts_positive CHECK (
        total_amount_usd_cents > 0 AND
        remaining_balance_usd_cents >= 0 AND
        total_spent_usd_cents >= 0
    ),
    CONSTRAINT escrows_balance_equation CHECK (
        total_amount_usd_cents = remaining_balance_usd_cents + total_spent_usd_cents
    ),
    CONSTRAINT escrows_status_check CHECK (
        status IN ('pending_deposit', 'active', 'completed', 'cancelled', 'expired')
    ),
    CONSTRAINT escrows_blockchain_status_check CHECK (
        blockchain_status IN ('pending', 'deployed', 'failed')
    )
);

-- Indexes for queries and locking
CREATE INDEX idx_escrows_sender ON escrows(sender_user_id);
CREATE INDEX idx_escrows_recipient ON escrows(recipient_id);
CREATE INDEX idx_escrows_status ON escrows(status) WHERE status = 'active';
CREATE INDEX idx_escrows_created ON escrows(created_at DESC);
CREATE INDEX idx_escrows_expires ON escrows(expires_at) WHERE status = 'active';

COMMENT ON TABLE escrows IS 'Core escrow contracts with financial guarantees';
COMMENT ON COLUMN escrows.total_amount_usd_cents IS 'Original escrow amount in USD cents (immutable)';
COMMENT ON COLUMN escrows.remaining_balance_usd_cents IS 'Current available balance (decreases with payments)';
COMMENT ON COLUMN escrows.total_spent_usd_cents IS 'Total released to recipient (increases with payments)';
COMMENT ON CONSTRAINT escrows_balance_equation ON escrows IS 'CRITICAL: Ensures no money is created or destroyed';

-- =====================================================
-- TABLE: spending_categories
-- =====================================================
-- Purpose: Spending limits per escrow (e.g., electricity, rent)
-- Financial: Track allocated and spent amounts per category
-- Concurrency: Row-level locking for updates
-- =====================================================

CREATE TABLE spending_categories (
    -- Identity
    category_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Ownership
    escrow_id UUID NOT NULL REFERENCES escrows(escrow_id) ON DELETE CASCADE,
    
    -- Category definition
    category_name VARCHAR(50) NOT NULL, -- electricity | water | rent | food | medical | education | other
    
    -- Financial (USD cents)
    allocated_amount_usd_cents BIGINT NOT NULL, -- Maximum allowed for this category
    spent_amount_usd_cents BIGINT NOT NULL DEFAULT 0, -- Total spent so far
    remaining_amount_usd_cents BIGINT NOT NULL, -- allocated - spent
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT categories_amounts_positive CHECK (
        allocated_amount_usd_cents > 0 AND
        spent_amount_usd_cents >= 0 AND
        remaining_amount_usd_cents >= 0
    ),
    CONSTRAINT categories_balance_equation CHECK (
        allocated_amount_usd_cents = spent_amount_usd_cents + remaining_amount_usd_cents
    ),
    CONSTRAINT categories_unique_per_escrow UNIQUE(escrow_id, category_name),
    CONSTRAINT categories_name_check CHECK (
        category_name IN ('electricity', 'water', 'rent', 'food', 'medical', 'education', 'other')
    )
);

-- Indexes
CREATE INDEX idx_categories_escrow ON spending_categories(escrow_id);
CREATE INDEX idx_categories_name ON spending_categories(category_name);

COMMENT ON TABLE spending_categories IS 'Per-escrow spending limits by category';
COMMENT ON CONSTRAINT categories_balance_equation ON spending_categories IS 'CRITICAL: Category balance integrity';

-- =====================================================
-- TABLE: payment_requests
-- =====================================================
-- Purpose: Recipient-initiated payment requests (invoice uploads)
-- Flow: created -> pending_approval -> approved -> processing -> completed | rejected | failed
-- Financial: All amounts in KES cents (Kenyan Shilling)
-- =====================================================

CREATE TABLE payment_requests (
    -- Identity
    payment_request_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Ownership
    escrow_id UUID NOT NULL REFERENCES escrows(escrow_id) ON DELETE RESTRICT,
    category_id UUID NOT NULL REFERENCES spending_categories(category_id) ON DELETE RESTRICT,
    requested_by_recipient_id UUID NOT NULL REFERENCES recipients(recipient_id) ON DELETE RESTRICT,
    
    -- Financial (KES cents - M-Pesa uses Kenyan Shillings)
    amount_kes_cents BIGINT NOT NULL, -- Amount in Kenyan Shilling cents (e.g., 500000 = 5000 KES)
    amount_usd_cents BIGINT NOT NULL, -- Equivalent in USD cents (calculated at request time)
    exchange_rate_kes_per_usd NUMERIC(10, 4) NOT NULL, -- Exchange rate used (e.g., 150.5000)
    
    -- Invoice/Receipt (ENCRYPTED - contains PII/account numbers)
    invoice_url_encrypted TEXT, -- S3/CDN URL to uploaded invoice image
    invoice_hash VARCHAR(64), -- SHA-256 hash of file for integrity
    
    -- Merchant details (ENCRYPTED)
    merchant_name_encrypted TEXT NOT NULL, -- e.g., "Kenya Power" (PII if small merchant)
    merchant_account_encrypted TEXT, -- Utility account number or paybill (SENSITIVE)
    
    -- State machine
    status VARCHAR(30) NOT NULL DEFAULT 'pending_approval',
    -- pending_approval -> approved -> processing -> completed
    --                  -> rejected
    --                  -> failed -> retry_pending
    
    -- Approval
    approved_by_user_id UUID REFERENCES users(user_id), -- Sender who approved
    approved_at TIMESTAMPTZ,
    rejection_reason TEXT,
    
    -- Processing
    processing_started_at TIMESTAMPTZ,
    processing_completed_at TIMESTAMPTZ,
    failure_reason TEXT,
    retry_count INT NOT NULL DEFAULT 0,
    max_retries INT NOT NULL DEFAULT 3,
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ, -- Auto-reject if not approved within N hours
    
    -- Constraints
    CONSTRAINT payment_requests_amount_positive CHECK (
        amount_kes_cents > 0 AND amount_usd_cents > 0
    ),
    CONSTRAINT payment_requests_exchange_rate CHECK (exchange_rate_kes_per_usd > 0),
    CONSTRAINT payment_requests_status_check CHECK (
        status IN ('pending_approval', 'approved', 'rejected', 'processing', 'completed', 'failed', 'retry_pending')
    ),
    CONSTRAINT payment_requests_retry_check CHECK (retry_count >= 0 AND retry_count <= max_retries)
);

-- Indexes
CREATE INDEX idx_payment_requests_escrow ON payment_requests(escrow_id);
CREATE INDEX idx_payment_requests_category ON payment_requests(category_id);
CREATE INDEX idx_payment_requests_recipient ON payment_requests(requested_by_recipient_id);
CREATE INDEX idx_payment_requests_status ON payment_requests(status);
CREATE INDEX idx_payment_requests_pending ON payment_requests(created_at DESC) 
    WHERE status = 'pending_approval';
CREATE INDEX idx_payment_requests_expires ON payment_requests(expires_at) 
    WHERE status = 'pending_approval' AND expires_at IS NOT NULL;

COMMENT ON TABLE payment_requests IS 'Recipient-initiated payment requests with approval workflow';
COMMENT ON COLUMN payment_requests.invoice_url_encrypted IS 'ENCRYPTED: S3 URL to invoice image (may contain PII)';
COMMENT ON COLUMN payment_requests.merchant_account_encrypted IS 'ENCRYPTED: Utility account or paybill number (SENSITIVE)';
COMMENT ON COLUMN payment_requests.amount_kes_cents IS 'Amount in Kenyan Shilling cents (M-Pesa currency)';

-- =====================================================
-- TABLE: mpesa_payments
-- =====================================================
-- Purpose: M-Pesa B2C payment records (escrow -> recipient)
-- Integration: Tracks M-Pesa API calls and webhooks
-- Idempotency: Prevents duplicate payments
-- =====================================================

CREATE TABLE mpesa_payments (
    -- Identity
    mpesa_payment_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Links
    payment_request_id UUID NOT NULL REFERENCES payment_requests(payment_request_id) ON DELETE RESTRICT,
    escrow_id UUID NOT NULL REFERENCES escrows(escrow_id) ON DELETE RESTRICT,
    recipient_id UUID NOT NULL REFERENCES recipients(recipient_id) ON DELETE RESTRICT,
    
    -- M-Pesa API data
    mpesa_conversation_id VARCHAR(255), -- M-Pesa's unique conversation ID
    mpesa_originator_conversation_id VARCHAR(255), -- Our request ID sent to M-Pesa
    mpesa_transaction_id VARCHAR(255) UNIQUE, -- M-Pesa receipt number (e.g., QGK1234XYZ)
    
    -- Financial (KES cents)
    amount_kes_cents BIGINT NOT NULL,
    mpesa_charges_kes_cents BIGINT, -- M-Pesa transaction fees
    
    -- Recipient details (cached for audit)
    recipient_phone_number_encrypted TEXT NOT NULL, -- ENCRYPTED: M-Pesa phone number
    recipient_name_encrypted TEXT, -- ENCRYPTED: Name as per M-Pesa
    
    -- State machine
    status VARCHAR(30) NOT NULL DEFAULT 'initiated',
    -- initiated -> processing -> completed | failed | timeout
    
    -- API interaction
    api_request_payload JSONB, -- Full M-Pesa API request (for debugging)
    api_response_payload JSONB, -- Full M-Pesa API response
    webhook_payload JSONB, -- M-Pesa callback data
    
    -- Timing
    initiated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    
    -- Error handling
    error_code VARCHAR(50),
    error_message TEXT,
    
    -- Idempotency
    idempotency_key VARCHAR(255) UNIQUE NOT NULL, -- Prevents duplicate payments
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT mpesa_amount_positive CHECK (amount_kes_cents > 0),
    CONSTRAINT mpesa_status_check CHECK (
        status IN ('initiated', 'processing', 'completed', 'failed', 'timeout')
    )
);

-- Indexes
CREATE INDEX idx_mpesa_payment_request ON mpesa_payments(payment_request_id);
CREATE INDEX idx_mpesa_escrow ON mpesa_payments(escrow_id);
CREATE INDEX idx_mpesa_recipient ON mpesa_payments(recipient_id);
CREATE INDEX idx_mpesa_status ON mpesa_payments(status);
CREATE INDEX idx_mpesa_transaction_id ON mpesa_payments(mpesa_transaction_id) 
    WHERE mpesa_transaction_id IS NOT NULL;
CREATE INDEX idx_mpesa_conversation_id ON mpesa_payments(mpesa_conversation_id) 
    WHERE mpesa_conversation_id IS NOT NULL;
CREATE INDEX idx_mpesa_idempotency ON mpesa_payments(idempotency_key);

COMMENT ON TABLE mpesa_payments IS 'M-Pesa B2C payment records with idempotency';
COMMENT ON COLUMN mpesa_payments.idempotency_key IS 'CRITICAL: Prevents duplicate payments to same recipient';
COMMENT ON COLUMN mpesa_payments.recipient_phone_number_encrypted IS 'ENCRYPTED: M-Pesa phone number (PII)';

-- =====================================================
-- TABLE: settlements
-- =====================================================
-- Purpose: Track when escrow funds are released (blockchain future)
-- Audit: Immutable record of all fund movements
-- =====================================================

CREATE TABLE settlements (
    -- Identity
    settlement_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Links
    escrow_id UUID NOT NULL REFERENCES escrows(escrow_id) ON DELETE RESTRICT,
    payment_request_id UUID REFERENCES payment_requests(payment_request_id) ON DELETE RESTRICT,
    mpesa_payment_id UUID REFERENCES mpesa_payments(mpesa_payment_id) ON DELETE RESTRICT,
    
    -- Financial (USD cents)
    amount_usd_cents BIGINT NOT NULL,
    
    -- Settlement type
    settlement_type VARCHAR(30) NOT NULL,
    -- payment_release: Normal payment to recipient
    -- refund: Return funds to sender
    -- expiry_return: Auto-return after escrow expiry
    -- admin_adjustment: Manual correction
    
    -- Blockchain (future)
    blockchain_tx_hash VARCHAR(255), -- Transaction hash on-chain
    blockchain_status VARCHAR(20) DEFAULT 'pending', -- pending | confirmed | failed
    
    -- Metadata
    notes TEXT,
    settled_by_user_id UUID REFERENCES users(user_id), -- Admin who triggered (if manual)
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    settled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT settlements_amount_positive CHECK (amount_usd_cents > 0),
    CONSTRAINT settlements_type_check CHECK (
        settlement_type IN ('payment_release', 'refund', 'expiry_return', 'admin_adjustment')
    )
);

-- Indexes
CREATE INDEX idx_settlements_escrow ON settlements(escrow_id);
CREATE INDEX idx_settlements_payment_request ON settlements(payment_request_id);
CREATE INDEX idx_settlements_mpesa ON settlements(mpesa_payment_id);
CREATE INDEX idx_settlements_created ON settlements(created_at DESC);
CREATE INDEX idx_settlements_type ON settlements(settlement_type);

COMMENT ON TABLE settlements IS 'Immutable audit trail of all fund movements';
COMMENT ON COLUMN settlements.settlement_type IS 'Type of settlement: payment_release | refund | expiry_return | admin_adjustment';

-- =====================================================
-- TABLE: daily_spend
-- =====================================================
-- Purpose: Daily spending limits per recipient (fraud prevention)
-- Concurrency: Row-level locking for atomic updates
-- Reset: Daily rollover at midnight UTC
-- =====================================================

CREATE TABLE daily_spend (
    -- Identity (composite primary key for efficiency)
    recipient_id UUID NOT NULL REFERENCES recipients(recipient_id) ON DELETE CASCADE,
    spend_date DATE NOT NULL DEFAULT CURRENT_DATE,
    
    -- Limits (USD cents)
    daily_limit_usd_cents BIGINT NOT NULL DEFAULT 50000, -- $500 default daily limit
    spent_today_usd_cents BIGINT NOT NULL DEFAULT 0,
    remaining_today_usd_cents BIGINT NOT NULL,
    
    -- Tracking
    transaction_count INT NOT NULL DEFAULT 0,
    last_transaction_at TIMESTAMPTZ,
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Primary key
    PRIMARY KEY (recipient_id, spend_date),
    
    -- Constraints
    CONSTRAINT daily_spend_amounts_positive CHECK (
        daily_limit_usd_cents > 0 AND
        spent_today_usd_cents >= 0 AND
        remaining_today_usd_cents >= 0
    ),
    CONSTRAINT daily_spend_balance_equation CHECK (
        daily_limit_usd_cents = spent_today_usd_cents + remaining_today_usd_cents
    )
);

-- Indexes
CREATE INDEX idx_daily_spend_recipient ON daily_spend(recipient_id);
CREATE INDEX idx_daily_spend_date ON daily_spend(spend_date DESC);

COMMENT ON TABLE daily_spend IS 'Daily spending limits per recipient for fraud prevention';
COMMENT ON CONSTRAINT daily_spend_balance_equation ON daily_spend IS 'CRITICAL: Daily spend balance integrity';

-- =====================================================
-- TABLE: audit_logs
-- =====================================================
-- Purpose: Immutable audit trail of all critical actions
-- Compliance: Required for financial regulations
-- Security: Detect unauthorized access or tampering
-- =====================================================

CREATE TABLE audit_logs (
    -- Identity
    audit_log_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Context
    user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
    escrow_id UUID REFERENCES escrows(escrow_id) ON DELETE SET NULL,
    payment_request_id UUID REFERENCES payment_requests(payment_request_id) ON DELETE SET NULL,
    
    -- Action details
    action VARCHAR(100) NOT NULL, -- e.g., "escrow.created", "payment.approved", "user.login"
    resource_type VARCHAR(50) NOT NULL, -- users | escrows | payment_requests | etc.
    resource_id UUID, -- ID of the affected resource
    
    -- Changes (JSONB for flexibility)
    old_values JSONB, -- State before action
    new_values JSONB, -- State after action
    
    -- Request metadata
    ip_address INET,
    user_agent TEXT,
    request_id VARCHAR(255), -- Trace ID from API gateway
    
    -- Result
    status VARCHAR(20) NOT NULL, -- success | failure | error
    error_message TEXT,
    
    -- Timestamp (immutable)
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT audit_logs_status_check CHECK (status IN ('success', 'failure', 'error'))
);

-- Indexes (audit logs are write-heavy, read-rarely)
CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_escrow ON audit_logs(escrow_id);
CREATE INDEX idx_audit_logs_payment_request ON audit_logs(payment_request_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id);

COMMENT ON TABLE audit_logs IS 'Immutable audit trail for compliance and security';
COMMENT ON COLUMN audit_logs.action IS 'Action performed (e.g., escrow.created, payment.approved)';
COMMENT ON COLUMN audit_logs.old_values IS 'State before action (JSON)';
COMMENT ON COLUMN audit_logs.new_values IS 'State after action (JSON)';

ALTER TABLE audit_logs
ALTER COLUMN user_id DROP NOT NULL;

-- =====================================================
-- TRIGGERS: Updated_at timestamp automation
-- =====================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to all tables with updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_recipients_updated_at BEFORE UPDATE ON recipients
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_escrows_updated_at BEFORE UPDATE ON escrows
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_categories_updated_at BEFORE UPDATE ON spending_categories
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_payment_requests_updated_at BEFORE UPDATE ON payment_requests
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_mpesa_payments_updated_at BEFORE UPDATE ON mpesa_payments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_daily_spend_updated_at BEFORE UPDATE ON daily_spend
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- INDEXES: Performance optimization
-- =====================================================

-- Composite indexes for common queries
CREATE INDEX idx_escrows_sender_status ON escrows(sender_user_id, status);
CREATE INDEX idx_escrows_recipient_status ON escrows(recipient_id, status);
CREATE INDEX idx_payment_requests_escrow_status ON payment_requests(escrow_id, status);

-- Partial indexes for active records only
CREATE INDEX idx_active_escrows ON escrows(escrow_id) WHERE status = 'active';
CREATE INDEX idx_pending_payments ON payment_requests(payment_request_id) 
    WHERE status = 'pending_approval';

COMMENT ON INDEX idx_active_escrows IS 'Optimized for active escrow lookups';
COMMENT ON INDEX idx_pending_payments IS 'Optimized for pending approval queries';

ALTER TABLE escrows 
ADD COLUMN funded_via_onramp BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE escrows
ADD COLUMN onramp_transaction_id UUID REFERENCES onramp_transactions(onramp_transaction_id);

CREATE INDEX idx_escrows_onramp ON escrows(onramp_transaction_id) WHERE onramp_transaction_id IS NOT NULL;
