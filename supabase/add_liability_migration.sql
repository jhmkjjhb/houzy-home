-- Supplement order liability tracking
ALTER TABLE orders ADD COLUMN IF NOT EXISTS liability_party TEXT;   -- 'supplier' | 'store' | 'shared'
ALTER TABLE orders ADD COLUMN IF NOT EXISTS loss_amount     NUMERIC;
