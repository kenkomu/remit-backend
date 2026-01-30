-- =====================================================
-- SMART CONTRACT TRACKING TABLES
-- =====================================================
-- Purpose: Track blockchain operations and contract states
-- Integration: SimpleEscrow contract on Base network
-- Security: Audit trail for all on-chain operations

-- =====================================================
-- TABLE: smart_contract_deployments
-- =====================================================
-- Purpose: Track contract deployments and versions
-- History: Maintain deployment audit trail

CREATE TABLE IF NOT EXISTS smart_contract_deployments (
    -- Identity
    deployment_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Contract details
    contract_name VARCHAR(100) NOT NULL, -- e.g., 'SimpleEscrow'
    contract_address VARCHAR(255) UNIQUE NOT NULL, -- Deployed address
    network VARCHAR(50) NOT NULL DEFAULT 'base', -- Network name
    
    -- Deployment info
    deployer_address VARCHAR(255) NOT NULL, -- Who deployed it
    deployment_tx_hash VARCHAR(255) UNIQUE NOT NULL, -- Deployment transaction
    block_number BIGINT NOT NULL, -- Block number of deployment
    gas_used BIGINT, -- Gas consumed in deployment
    
    -- Configuration (at deployment time)
    backend_service_address VARCHAR(255) NOT NULL, -- Contract backend service
    fee_collector_address VARCHAR(255) NOT NULL, -- Fee collector address
    initial_protocol_fee_bps INTEGER NOT NULL DEFAULT 100, -- Initial fee (100 = 1%)
    
    -- Versioning
    contract_version VARCHAR(20) NOT NULL DEFAULT '1.0.0', -- Semantic version
    is_active BOOLEAN NOT NULL DEFAULT TRUE, -- Currently in use?
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deactivated_at TIMESTAMPTZ, -- When replaced by new version
    
    -- Constraints
    CONSTRAINT deployments_network_check CHECK (
        network IN ('base', 'base_sepolia', 'base_goerli', 'ethereum', 'polygon')
    ),
    CONSTRAINT deployments_fee_check CHECK (
        initial_protocol_fee_bps BETWEEN 0 AND 500 -- Max 5%
    )
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_deployments_active ON smart_contract_deployments(is_active);
CREATE INDEX IF NOT EXISTS idx_deployments_contract ON smart_contract_deployments(contract_name, network);
CREATE INDEX IF NOT EXISTS idx_deployments_created ON smart_contract_deployments(created_at DESC);

-- =====================================================
-- TABLE: blockchain_transactions
-- =====================================================
-- Purpose: Track all blockchain interactions with audit trail
-- Types: Escrow creation, payments, refunds, admin operations

CREATE TABLE IF NOT EXISTS blockchain_transactions (
    -- Identity
    transaction_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Transaction details
    tx_hash VARCHAR(255) UNIQUE NOT NULL, -- Blockchain transaction hash
    block_number BIGINT, -- Block containing the transaction
    block_hash VARCHAR(255), -- Block hash for verification
    transaction_index INTEGER, -- Position within block
    
    -- Operation details
    operation_type VARCHAR(50) NOT NULL, -- create_escrow, confirm_payment, refund_escrow, etc.
    escrow_id UUID REFERENCES escrows(escrow_id), -- Related escrow if applicable
    contract_address VARCHAR(255) NOT NULL, -- Contract that was called
    
    -- Financial tracking
    amount_wei VARCHAR(78), -- ETH amount transferred (as string to avoid overflow)
    amount_usd_cents BIGINT, -- USD equivalent in cents
    gas_used BIGINT, -- Gas consumed by transaction
    gas_price_wei VARCHAR(78), -- Gas price in wei
    gas_cost_usd_cents BIGINT, -- Cost in USD cents
    
    -- Status tracking
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending | confirmed | failed | replaced
    confirmations INTEGER DEFAULT 0, -- Number of block confirmations
    confirmed_at TIMESTAMPTZ, -- When confirmed on-chain
    
    -- Error tracking
    error_message TEXT, -- If transaction failed
    error_code VARCHAR(50), -- Categorized error type
    
    -- Request context
    requested_by_user_id UUID REFERENCES users(user_id), -- Who initiated
    payment_request_id UUID REFERENCES payment_requests(payment_request_id), -- Related payment
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT blockchain_operation_check CHECK (
        operation_type IN (
            'create_escrow', 'confirm_payment', 'refund_escrow',
            'update_backend_service', 'update_fee_collector', 
            'update_protocol_fee', 'emergency_withdraw'
        )
    ),
    CONSTRAINT blockchain_status_check CHECK (
        status IN ('pending', 'confirmed', 'failed', 'replaced')
    )
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_blockchain_tx_hash ON blockchain_transactions(tx_hash);
CREATE INDEX IF NOT EXISTS idx_blockchain_status ON blockchain_transactions(status);
CREATE INDEX IF NOT EXISTS idx_blockchain_operation ON blockchain_transactions(operation_type);
CREATE INDEX IF NOT EXISTS idx_blockchain_escrow ON blockchain_transactions(escrow_id);
CREATE INDEX IF NOT EXISTS idx_blockchain_created ON blockchain_transactions(created_at DESC);

-- =====================================================
-- TABLE: contract_events
-- =====================================================
-- Purpose: Track smart contract events for audit and monitoring
-- Events: EscrowCreated, PaymentConfirmed, EscrowRefunded, etc.

CREATE TABLE IF NOT EXISTS contract_events (
    -- Identity
    event_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Event details
    event_name VARCHAR(100) NOT NULL, -- e.g., 'EscrowCreated', 'PaymentConfirmed'
    contract_address VARCHAR(255) NOT NULL, -- Contract that emitted the event
    tx_hash VARCHAR(255) NOT NULL, -- Transaction that emitted the event
    block_number BIGINT NOT NULL, -- Block number
    log_index INTEGER NOT NULL, -- Position within transaction logs
    
    -- Event data (stored as JSON for flexibility)
    event_data JSONB NOT NULL, -- Complete event parameters
    escrow_id_hash VARCHAR(66), -- Hashed escrowId from event (for lookup)
    payment_id_hash VARCHAR(66), -- Hashed paymentId from event (for lookup)
    
    -- Key indexed fields (extracted from event_data for querying)
    sender_address VARCHAR(255), -- From EscrowCreated events
    beneficiary_address VARCHAR(255), -- From EscrowCreated events
    amount_wei VARCHAR(78), -- Amount from any payment event
    purpose VARCHAR(100), -- Purpose from EscrowCreated
    
    -- Timestamps
    block_timestamp TIMESTAMPTZ NOT NULL, -- When event occurred on-chain
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Foreign keys (if resolvable)
    escrow_id UUID REFERENCES escrows(escrow_id), -- Resolved escrow ID if found
    
    -- Constraints
    CONSTRAINT contract_events_unique UNIQUE(tx_hash, log_index)
);

-- Indexes for event queries
CREATE INDEX IF NOT EXISTS idx_events_name ON contract_events(event_name);
CREATE INDEX IF NOT EXISTS idx_events_contract ON contract_events(contract_address);
CREATE INDEX IF NOT EXISTS idx_events_tx_hash ON contract_events(tx_hash);
CREATE INDEX IF NOT EXISTS idx_events_block ON contract_events(block_number DESC);
CREATE INDEX IF NOT EXISTS idx_events_data ON contract_events USING GIN(event_data);
CREATE INDEX IF NOT EXISTS idx_events_escrow_hash ON contract_events(escrow_id_hash);

-- =====================================================
-- TABLE: escrow_blockchain_state
-- =====================================================
-- Purpose: Mirror key escrow state from blockchain for sync
-- Sync: Keep database in sync with contract state

CREATE TABLE IF NOT EXISTS escrow_blockchain_state (
    -- Identity
    state_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- References
    escrow_id UUID REFERENCES escrows(escrow_id) UNIQUE NOT NULL,
    contract_address VARCHAR(255) NOT NULL,
    
    -- Blockchain state (mirrored from contract)
    escrow_id_hash VARCHAR(66) NOT NULL, -- Keccak256 hash of escrowId
    sender_address VARCHAR(255) NOT NULL, -- Contract sender field
    beneficiary_address VARCHAR(255) NOT NULL, -- Contract beneficiary field
    total_amount_wei VARCHAR(78) NOT NULL, -- Contract totalAmount
    remaining_amount_wei VARCHAR(78) NOT NULL, -- Contract remainingAmount
    released_amount_wei VARCHAR(78) NOT NULL, -- Contract releasedAmount
    purpose VARCHAR(100) NOT NULL, -- Contract purpose
    expires_at_block BIGINT, -- Contract expiresAt (block timestamp)
    is_active BOOLEAN NOT NULL, -- Contract isActive field
    is_refunded BOOLEAN NOT NULL, -- Contract isRefunded field
    created_at_block BIGINT NOT NULL, -- Contract createdAt
    
    -- Sync tracking
    last_synced_block BIGINT NOT NULL, -- Block number when last synced
    last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sync_status VARCHAR(20) NOT NULL DEFAULT 'synced', -- synced | pending | error
    
    -- Timestamps
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT escrow_sync_status_check CHECK (
        sync_status IN ('synced', 'pending', 'error')
    )
);

-- Indexes for sync operations
CREATE INDEX IF NOT EXISTS idx_escrow_blockchain_contract ON escrow_blockchain_state(contract_address);
CREATE INDEX IF NOT EXISTS idx_escrow_blockchain_synced ON escrow_blockchain_state(last_synced_at);
CREATE INDEX IF NOT EXISTS idx_escrow_blockchain_block ON escrow_blockchain_state(last_synced_block);

-- =====================================================
-- VIEWS FOR COMMON QUERIES
-- =====================================================

-- Current active contract deployment
CREATE OR REPLACE VIEW active_contract_deployment AS
SELECT * FROM smart_contract_deployments 
WHERE is_active = TRUE 
ORDER BY created_at DESC 
LIMIT 1;

-- Recent blockchain transactions with details
CREATE OR REPLACE VIEW recent_blockchain_activity AS
SELECT 
    bt.*,
    e.escrow_id,
    u.privy_user_id as requester,
    er.invoice_number
FROM blockchain_transactions bt
LEFT JOIN escrows e ON bt.escrow_id = e.escrow_id
LEFT JOIN users u ON bt.requested_by_user_id = u.user_id
LEFT JOIN payment_requests pr ON bt.payment_request_id = pr.payment_request_id
LEFT JOIN expense_reports er ON pr.expense_report_id = er.expense_report_id
ORDER BY bt.created_at DESC;

-- Contract event summary by escrow
CREATE OR REPLACE VIEW escrow_event_summary AS
SELECT 
    escrow_id,
    COUNT(*) as total_events,
    COUNT(CASE WHEN event_name = 'EscrowCreated' THEN 1 END) as created_events,
    COUNT(CASE WHEN event_name = 'PaymentConfirmed' THEN 1 END) as payment_events,
    COUNT(CASE WHEN event_name = 'EscrowRefunded' THEN 1 END) as refund_events,
    MIN(block_timestamp) as first_event_at,
    MAX(block_timestamp) as last_event_at
FROM contract_events 
WHERE escrow_id IS NOT NULL
GROUP BY escrow_id;

-- =====================================================
-- TRIGGERS FOR AUTOMATIC UPDATES
-- =====================================================

-- Update blockchain transaction status when confirmed
CREATE OR REPLACE FUNCTION update_transaction_status()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'confirmed' AND OLD.status != 'confirmed' THEN
        NEW.updated_at = NOW();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_blockchain_status
    BEFORE UPDATE ON blockchain_transactions
    FOR EACH ROW
    EXECUTE FUNCTION update_transaction_status();

-- Update escrow blockchain state when events are processed
CREATE OR REPLACE FUNCTION update_escrow_blockchain_sync()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.escrow_id IS NOT NULL AND (NEW.event_name = 'PaymentConfirmed' OR NEW.event_name = 'EscrowRefunded') THEN
        UPDATE escrow_blockchain_state 
        SET last_synced_block = NEW.block_number,
            last_synced_at = NOW(),
            sync_status = 'pending'
        WHERE escrow_id = NEW.escrow_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_escrow_sync
    AFTER INSERT ON contract_events
    FOR EACH ROW
    EXECUTE FUNCTION update_escrow_blockchain_sync();

-- =====================================================
-- COMMENTS FOR DOCUMENTATION
-- =====================================================

COMMENT ON TABLE smart_contract_deployments IS 'Track all contract deployments with version control';
COMMENT ON TABLE blockchain_transactions IS 'Audit trail for all blockchain operations';
COMMENT ON TABLE contract_events IS 'Complete log of smart contract events for monitoring';
COMMENT ON TABLE escrow_blockchain_state IS 'Mirror of on-chain escrow state for database sync';

COMMENT ON COLUMN blockchain_transactions.amount_wei IS 'ETH amount stored as string to prevent overflow';
COMMENT ON COLUMN blockchain_transactions.gas_price_wei IS 'Gas price in wei stored as string';
COMMENT ON COLUMN contract_events.event_data IS 'Full event parameters stored as JSONB';
COMMENT ON COLUMN escrow_blockchain_state.sync_status IS 'synced | pending | error - indicates sync state';