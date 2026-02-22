-- Add cross-platform listing fields: brand, size, color, shipping_weight, condition_notes
-- These fields are required or recommended by Poshmark, Mercari, Depop, Etsy, eBay, Facebook Marketplace

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS brand TEXT,
  ADD COLUMN IF NOT EXISTS size TEXT,
  ADD COLUMN IF NOT EXISTS color TEXT,
  ADD COLUMN IF NOT EXISTS shipping_weight NUMERIC(8, 2),
  ADD COLUMN IF NOT EXISTS condition_notes TEXT;

COMMENT ON COLUMN listings.brand IS 'Item brand (required: Poshmark, Mercari; recommended: eBay, Etsy, Depop)';
COMMENT ON COLUMN listings.size IS 'Item size (required: Poshmark clothing; recommended: Depop, Mercari clothing)';
COMMENT ON COLUMN listings.color IS 'Primary color (required: Poshmark; recommended: Etsy)';
COMMENT ON COLUMN listings.shipping_weight IS 'Shipping weight in ounces (used for calculated shipping on eBay, Mercari)';
COMMENT ON COLUMN listings.condition_notes IS 'Detailed condition description / defect notes (useful for all platforms)';
