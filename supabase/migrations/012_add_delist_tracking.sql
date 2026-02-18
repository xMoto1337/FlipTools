-- Add delist tracking columns to listings and create audit log table

-- Track which platform sold the item and when
ALTER TABLE listings ADD COLUMN IF NOT EXISTS sold_on_platform TEXT;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS sold_at TIMESTAMPTZ;

-- GIN index on platforms JSONB for fast lookups (find all listings on a given platform)
CREATE INDEX IF NOT EXISTS idx_listings_platforms ON listings USING GIN (platforms);

-- Audit log for auto-delist actions
CREATE TABLE IF NOT EXISTS auto_delist_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID REFERENCES listings(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  sold_on_platform TEXT NOT NULL,
  delisted_from_platform TEXT NOT NULL,
  external_id TEXT,
  status TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'failed', 'skipped')),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_delist_log_listing ON auto_delist_log(listing_id);
CREATE INDEX idx_delist_log_created ON auto_delist_log(created_at DESC);

-- RLS: users can read their own delist logs
ALTER TABLE auto_delist_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own delist logs"
  ON auto_delist_log FOR SELECT
  USING (auth.uid() = user_id);

-- Service role needs to insert delist logs (from edge function)
-- No INSERT policy for auth.uid() — edge function uses service role which bypasses RLS
