CREATE TABLE IF NOT EXISTS public.registrations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID,
  type          TEXT NOT NULL CHECK (type IN ('staff','supplier','logistics')),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  name          TEXT NOT NULL,
  phone         TEXT NOT NULL,
  email         TEXT NOT NULL,
  store_id      UUID REFERENCES public.stores(id),
  employee_no   TEXT,
  department    TEXT,
  position_title TEXT,
  company_name  TEXT,
  credit_code   TEXT,
  address       TEXT,
  products      TEXT,
  reject_reason TEXT,
  reviewed_by   UUID,
  reviewed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Add store_id if table already exists (safe to run multiple times)
ALTER TABLE public.registrations ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES public.stores(id);

-- Grant table access to Supabase roles (required for RLS to work)
GRANT INSERT ON public.registrations TO anon;
GRANT INSERT ON public.registrations TO authenticated;
GRANT SELECT ON public.registrations TO authenticated;
GRANT UPDATE ON public.registrations TO authenticated;

ALTER TABLE public.registrations ENABLE ROW LEVEL SECURITY;

-- Drop old policies to avoid conflicts on re-run
DROP POLICY IF EXISTS "reg_insert" ON public.registrations;
DROP POLICY IF EXISTS "reg_select" ON public.registrations;
DROP POLICY IF EXISTS "reg_update" ON public.registrations;

CREATE POLICY "reg_insert" ON public.registrations FOR INSERT WITH CHECK (true);
CREATE POLICY "reg_select" ON public.registrations FOR SELECT USING (
  auth.uid() IS NOT NULL AND (
    auth.uid() = user_id OR
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  )
);
CREATE POLICY "reg_update" ON public.registrations FOR UPDATE USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);
