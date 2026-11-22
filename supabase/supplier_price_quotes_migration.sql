-- Supplier cost quotation rounds. All access is mediated by the
-- supplier-price-quote Edge Function; browser clients cannot access these tables.
CREATE TABLE IF NOT EXISTS public.supplier_price_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  trade text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','awarded')),
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  closes_at timestamptz,
  awarded_invite_id uuid
);

CREATE TABLE IF NOT EXISTS public.supplier_price_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL REFERENCES public.supplier_price_rounds(id) ON DELETE CASCADE,
  supplier_name text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','submitted','withdrawn')),
  quote jsonb NOT NULL DEFAULT '[]'::jsonb,
  note text NOT NULL DEFAULT '',
  validity text NOT NULL DEFAULT '',
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.quote_company_costbook (
  item_id text PRIMARY KEY,
  item_type text NOT NULL CHECK (item_type IN ('项目单价','选材价差','瓷砖片价')),
  item_name text NOT NULL,
  unit text NOT NULL,
  material numeric(12,2) NOT NULL DEFAULT 0,
  auxiliary numeric(12,2) NOT NULL DEFAULT 0,
  labour numeric(12,2) NOT NULL DEFAULT 0,
  waste_pct numeric(8,3) NOT NULL DEFAULT 0,
  supplier_name text NOT NULL,
  source_round_id uuid REFERENCES public.supplier_price_rounds(id),
  updated_by uuid REFERENCES public.profiles(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.supplier_price_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_price_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_company_costbook ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.supplier_price_rounds, public.supplier_price_invites, public.quote_company_costbook FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS supplier_price_rounds_created_idx ON public.supplier_price_rounds(created_at DESC);
CREATE INDEX IF NOT EXISTS supplier_price_invites_round_idx ON public.supplier_price_invites(round_id);
