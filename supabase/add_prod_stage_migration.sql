-- Add production stage column so supplier progress syncs to staff portal
ALTER TABLE orders ADD COLUMN IF NOT EXISTS prod_stage TEXT;
