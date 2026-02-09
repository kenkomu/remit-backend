-- Add optional link from recipient to their own user account (Option B)
--
-- Existing rows remain valid with user_id = NULL (unclaimed).
-- Once a recipient claims their account, we set recipients.user_id to the
-- authenticated users.user_id.

ALTER TABLE recipients
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(user_id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS recipients_unique_user_id
  ON recipients(user_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_recipients_user_id
  ON recipients(user_id);
