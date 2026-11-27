-- quote_share_migration.sql
-- 2026-11-27 报价器「发客户看」链接：
--  员工从报价器生成链接，只存「按空间包价」的快照（没有数量、单价），客户打开要输入手机后 4 位；
--  链接有有效期，员工可随时停用；同一链接连续输错 5 次锁 15 分钟。
-- 依赖：customer_visibility_migration.sql（_is_active_staff）。可重复执行。
-- 运行：Supabase SQL Editor → 粘贴全部 → Run

CREATE TABLE IF NOT EXISTS public.quote_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  customer_name text NOT NULL CHECK (length(btrim(customer_name)) BETWEEN 1 AND 80),
  phone_mask text NOT NULL,
  phone_last4 text NOT NULL CHECK (phone_last4 ~ '^[0-9]{4}$'),
  payload jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  failed_checks int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  view_count int NOT NULL DEFAULT 0,
  last_opened_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS quote_shares_owner ON public.quote_shares(owner_id, created_at DESC);

ALTER TABLE public.quote_shares ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.quote_shares FROM PUBLIC, anon, authenticated;
-- 员工只能看自己发的链接（列表用；不含客户验证用的后 4 位）
GRANT SELECT (id, token, customer_name, phone_mask, expires_at, revoked_at, view_count, last_opened_at, created_at, payload) ON public.quote_shares TO authenticated;
DROP POLICY IF EXISTS quote_shares_owner_read ON public.quote_shares;
CREATE POLICY quote_shares_owner_read ON public.quote_shares FOR SELECT TO authenticated
  USING (owner_id = auth.uid() AND public._is_active_staff(1));

-- 员工生成链接：p_data = {customer_name, phone, days, payload:{plans:[…]}} → {id, token, expires_at}
CREATE OR REPLACE FUNCTION public.quote_share_create(p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_name text := btrim(coalesce(p_data->>'customer_name', ''));
  v_digits text := regexp_replace(coalesce(p_data->>'phone', ''), '\D', '', 'g');
  v_days int := coalesce(nullif(p_data->>'days', '')::int, 7);
  v_payload jsonb := p_data->'payload';
  s public.quote_shares;
BEGIN
  IF auth.uid() IS NULL OR NOT public._is_active_staff(1) THEN
    RAISE EXCEPTION 'Employee login required' USING ERRCODE = '42501';
  END IF;
  IF v_name = '' OR length(v_name) > 80 THEN RAISE EXCEPTION '请先填写客户姓名'; END IF;
  IF length(v_digits) < 6 THEN RAISE EXCEPTION '请先填写客户手机号（客户要用后 4 位打开链接）'; END IF;
  IF v_days NOT BETWEEN 1 AND 60 THEN RAISE EXCEPTION '有效期要在 1–60 天之间'; END IF;
  IF v_payload IS NULL OR jsonb_typeof(v_payload) <> 'object' OR jsonb_typeof(v_payload->'plans') <> 'array'
     OR jsonb_array_length(v_payload->'plans') NOT BETWEEN 1 AND 10 THEN
    RAISE EXCEPTION '请至少选一个方案';
  END IF;
  IF octet_length(v_payload::text) > 512 * 1024 THEN RAISE EXCEPTION '方案内容太大'; END IF;
  INSERT INTO public.quote_shares(owner_id, customer_name, phone_mask, phone_last4, payload, expires_at)
  VALUES (auth.uid(), v_name, left(v_digits, 3) || repeat('*', greatest(length(v_digits) - 7, 2)) || right(v_digits, 4), right(v_digits, 4),
          v_payload, now() + make_interval(days => v_days))
  RETURNING * INTO s;
  RETURN jsonb_build_object('id', s.id, 'token', s.token, 'expires_at', s.expires_at);
END $$;
REVOKE ALL ON FUNCTION public.quote_share_create(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.quote_share_create(jsonb) TO authenticated;

-- 员工停用自己发的链接
CREATE OR REPLACE FUNCTION public.quote_share_revoke(p_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public._is_active_staff(1) THEN
    RAISE EXCEPTION 'Employee login required' USING ERRCODE = '42501';
  END IF;
  UPDATE public.quote_shares SET revoked_at = now() WHERE id = p_id AND owner_id = auth.uid() AND revoked_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION '这个链接已经停用或不是你发的'; END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.quote_share_revoke(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.quote_share_revoke(uuid) TO authenticated;

-- 客户打开：链接 id + token + 手机后 4 位。不对就计次，连续错 5 次锁 15 分钟。
-- 返回 {status: ok|bad_code|locked|expired|revoked}；ok 时带客户名、打码电话（水印用）和方案快照
CREATE OR REPLACE FUNCTION public.quote_share_open(p_id uuid, p_token uuid, p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s public.quote_shares; v_left int;
BEGIN
  SELECT * INTO s FROM public.quote_shares WHERE id = p_id AND token = p_token FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF s.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('status', 'revoked'); END IF;
  IF s.expires_at <= now() THEN RETURN jsonb_build_object('status', 'expired'); END IF;
  IF s.locked_until IS NOT NULL AND s.locked_until > now() THEN
    RETURN jsonb_build_object('status', 'locked', 'until', s.locked_until);
  END IF;
  IF coalesce(btrim(p_code), '') IS DISTINCT FROM s.phone_last4 THEN
    v_left := greatest(0, 4 - s.failed_checks);
    UPDATE public.quote_shares SET failed_checks = CASE WHEN s.failed_checks + 1 >= 5 THEN 0 ELSE s.failed_checks + 1 END,
      locked_until = CASE WHEN s.failed_checks + 1 >= 5 THEN now() + interval '15 minutes' ELSE NULL END
    WHERE id = s.id;
    IF s.failed_checks + 1 >= 5 THEN RETURN jsonb_build_object('status', 'locked', 'until', now() + interval '15 minutes'); END IF;
    RETURN jsonb_build_object('status', 'bad_code', 'left', v_left);
  END IF;
  UPDATE public.quote_shares SET failed_checks = 0, locked_until = NULL, view_count = view_count + 1, last_opened_at = now() WHERE id = s.id;
  RETURN jsonb_build_object('status', 'ok', 'customer_name', s.customer_name, 'phone_mask', s.phone_mask,
    'expires_at', s.expires_at, 'payload', s.payload);
END $$;
REVOKE ALL ON FUNCTION public.quote_share_open(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.quote_share_open(uuid, uuid, text) TO anon, authenticated;
