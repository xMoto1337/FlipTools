-- Add 'etsy' to platform_connections CHECK constraint
-- and add last_sale_check column for cron tracking

-- Drop and recreate the CHECK constraint to include 'etsy'
ALTER TABLE platform_connections DROP CONSTRAINT IF EXISTS platform_connections_platform_check;
ALTER TABLE platform_connections ADD CONSTRAINT platform_connections_platform_check
  CHECK (platform IN ('ebay', 'depop', 'etsy'));

-- Track when we last checked each connection for new sales (used by auto-delist cron)
ALTER TABLE platform_connections ADD COLUMN IF NOT EXISTS last_sale_check TIMESTAMPTZ;
