-- Add external_id column for deduplicating synced platform sales
ALTER TABLE sales ADD COLUMN IF NOT EXISTS external_id TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS item_title TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS item_image_url TEXT;

-- Unique constraint for dedup: one external order per user per platform
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_external_id
  ON sales(user_id, platform, external_id)
  WHERE external_id IS NOT NULL;
