-- Migration: Add daily_spend table
-- This ensures the table exists even if it wasn't in the initial schema

CREATE TABLE IF NOT EXISTS daily_spend (
    recipient_id UUID NOT NULL REFERENCES recipients(recipient_id) ON DELETE CASCADE,
    spend_date DATE NOT NULL DEFAULT CURRENT_DATE,
    daily_limit_usd_cents BIGINT NOT NULL DEFAULT 50000,
    spent_today_usd_cents BIGINT NOT NULL DEFAULT 0,
    remaining_today_usd_cents BIGINT NOT NULL,
    transaction_count INT NOT NULL DEFAULT 0,
    last_transaction_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (recipient_id, spend_date),
    CONSTRAINT daily_spend_amounts_positive CHECK (
        daily_limit_usd_cents > 0 AND
        spent_today_usd_cents >= 0 AND
        remaining_today_usd_cents >= 0
    ),
    CONSTRAINT daily_spend_balance_equation CHECK (
        daily_limit_usd_cents = spent_today_usd_cents + remaining_today_usd_cents
    )
);

CREATE INDEX IF NOT EXISTS idx_daily_spend_recipient ON daily_spend(recipient_id);
CREATE INDEX IF NOT EXISTS idx_daily_spend_date ON daily_spend(spend_date DESC);