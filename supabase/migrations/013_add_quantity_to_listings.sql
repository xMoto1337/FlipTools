-- Add quantity column to listings
ALTER TABLE listings ADD COLUMN IF NOT EXISTS quantity INT DEFAULT 1;

-- Existing rows get quantity = 1 (already handled by DEFAULT 1)
