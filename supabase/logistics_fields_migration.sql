-- Add logistics tracking fields to orders
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS logistics_profile_id UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS ship_time  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS eta_time   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ship_notes TEXT;
