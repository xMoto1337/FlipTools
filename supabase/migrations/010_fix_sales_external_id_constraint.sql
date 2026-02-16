-- Drop the partial unique index (doesn't work with PostgREST upsert)
DROP INDEX IF EXISTS idx_sales_external_id;

-- Create a proper unique constraint instead
-- NULL external_ids are treated as distinct in PostgreSQL, so manual sales won't conflict
ALTER TABLE sales ADD CONSTRAINT sales_user_platform_external_id_unique
  UNIQUE (user_id, platform, external_id);
