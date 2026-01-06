-- =====================================================
-- ON-RAMP TRANSACTIONS TABLE
-- =====================================================
-- Purpose: Track KES → USDC on-ramp via Pretium API
-- Critical: Escrow is ONLY funded after webhook confirmation
-- =====================================================

-- Create onramp_transactions table
CREATE TABLE IF NOT EXISTS onramp_transactions (
    onramp_transaction_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    escrow_id UUID NOT NULL REFERENCES escrows(escrow_id) ON DELETE RESTRICT,
    sender_user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    pretium_transaction_code VARCHAR(50) UNIQUE NOT NULL,
    phone_number VARCHAR(20) NOT NULL,
    amount_kes_cents BIGINT NOT NULL,
    expected_usdc_cents BIGINT NOT NULL,
    exchange_rate NUMERIC(10,4) NOT NULL,
    mobile_network VARCHAR(50) NOT NULL DEFAULT 'Safaricom',
    chain VARCHAR(50) NOT NULL DEFAULT 'BASE',
    asset VARCHAR(50) NOT NULL DEFAULT 'USDC',
    settlement_address VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    webhook_payload JSONB,
    webhook_received_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confirmed_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    error_message TEXT,
    retry_count INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT onramp_amount_positive CHECK (amount_kes_cents > 0 AND expected_usdc_cents > 0),
    CONSTRAINT onramp_status_check CHECK (status IN ('pending', 'confirmed', 'failed', 'timeout'))
);

CREATE INDEX IF NOT EXISTS idx_onramp_escrow ON onramp_transactions(escrow_id);
CREATE INDEX IF NOT EXISTS idx_onramp_user ON onramp_transactions(sender_user_id);
CREATE INDEX IF NOT EXISTS idx_onramp_status ON onramp_transactions(status);
CREATE INDEX IF NOT EXISTS idx_onramp_pretium_code ON onramp_transactions(pretium_transaction_code);
CREATE INDEX IF NOT EXISTS idx_onramp_created ON onramp_transactions(created_at DESC);

-- Trigger for updated_at
CREATE TRIGGER update_onramp_transactions_updated_at 
BEFORE UPDATE ON onramp_transactions
FOR EACH ROW 
EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE onramp_transactions IS 'KES → USDC on-ramp transactions via Pretium API';
COMMENT ON COLUMN onramp_transactions.pretium_transaction_code IS 'UNIQUE: Pretium transaction code for idempotency';
COMMENT ON COLUMN onramp_transactions.status IS 'pending: awaiting webhook | confirmed: webhook received & escrow funded | failed: payment failed';

-- =====================================================
-- CRITICAL: Escrow funding status
-- =====================================================
-- Add column to track if escrow was funded via on-ramp
ALTER TABLE escrows ADD COLUMN funded_via_onramp BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE escrows ADD COLUMN onramp_transaction_id UUID REFERENCES onramp_transactions(onramp_transaction_id);

CREATE INDEX idx_escrows_onramp ON escrows(onramp_transaction_id) WHERE onramp_transaction_id IS NOT NULL;

COMMENT ON COLUMN escrows.funded_via_onramp IS 'TRUE if escrow was funded via KES on-ramp';
COMMENT ON COLUMN escrows.onramp_transaction_id IS 'Reference to on-ramp transaction that funded this escrow';