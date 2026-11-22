-- Keep main-material procurement and construction bids independently attributable.
ALTER TABLE public.quote_company_costbook
  ADD COLUMN IF NOT EXISTS material_supplier_name text,
  ADD COLUMN IF NOT EXISTS work_supplier_name text,
  ADD COLUMN IF NOT EXISTS material_source_round_id uuid REFERENCES public.supplier_price_rounds(id),
  ADD COLUMN IF NOT EXISTS work_source_round_id uuid REFERENCES public.supplier_price_rounds(id),
  ADD COLUMN IF NOT EXISTS material_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS work_updated_at timestamptz;
