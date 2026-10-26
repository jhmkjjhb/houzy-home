-- Cost amounts are supplied separately through a private seed; never commit them.
BEGIN;
CREATE TABLE IF NOT EXISTS public.quote_painting_prices(
 code text PRIMARY KEY,name text NOT NULL,name_en text NOT NULL,category text NOT NULL CHECK(category IN ('wall','metal','prep')),
 unit text NOT NULL CHECK(unit IN ('sf','set')),cost_low numeric(14,4) NOT NULL CHECK(cost_low>=0 AND cost_low<1000000),
 cost_high numeric(14,4) NOT NULL CHECK(cost_high>=cost_low AND cost_high<1000000),markup_percent numeric(8,3) NOT NULL CHECK(markup_percent>=0 AND markup_percent<=1000),
 open_high boolean NOT NULL DEFAULT false,active boolean NOT NULL DEFAULT true,updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.quote_painting_cost_access(
 profile_id uuid PRIMARY KEY REFERENCES public.profiles(id),granted_by uuid NOT NULL REFERENCES public.profiles(id),created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.quote_painting_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_painting_cost_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.quote_painting_prices,public.quote_painting_cost_access FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public._quote_painting_can_cost(p_manage boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM profiles p WHERE p.id=auth.uid() AND p.active=true AND
  CASE WHEN p_manage THEN p.role IN ('general_manager','admin','superadmin')
  ELSE p.role IN ('store_manager','regional_manager','general_manager','admin','superadmin') OR
   (p.role='staff' AND EXISTS(SELECT 1 FROM quote_painting_cost_access a WHERE a.profile_id=p.id)) END);
$$;
REVOKE ALL ON FUNCTION public._quote_painting_can_cost(boolean) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.quote_painting_catalog()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('code',code,'name',name,'name_en',name_en,'category',category,'unit',unit,
  'low',round(cost_low*(1+markup_percent/100),2),'mid',round((cost_low+cost_high)/2*(1+markup_percent/100),2),
  'high',round(cost_high*(1+markup_percent/100),2),'open_high',open_high,'updated_at',updated_at) ORDER BY category,code),'[]'::jsonb)
 FROM quote_painting_prices WHERE active=true;
$$;
REVOKE ALL ON FUNCTION public.quote_painting_catalog() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.quote_painting_catalog() TO anon,authenticated;
CREATE OR REPLACE FUNCTION public.quote_painting_costs()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT _quote_painting_can_cost() THEN RAISE EXCEPTION '无真实成本查看权限，请联系管理员授权' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('can_manage',_quote_painting_can_cost(true),'rows',coalesce((SELECT jsonb_agg(jsonb_build_object(
 'code',code,'name',name,'unit',unit,'cost_low',cost_low,'cost_high',cost_high,'markup_percent',markup_percent,'open_high',open_high) ORDER BY category,code)
 FROM quote_painting_prices WHERE active=true),'[]'::jsonb));
END;$$;
REVOKE ALL ON FUNCTION public.quote_painting_costs() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.quote_painting_costs() TO authenticated;
CREATE OR REPLACE FUNCTION public.quote_painting_access_list()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT _quote_painting_can_cost(true) THEN RAISE EXCEPTION '仅管理层可配置成本权限' USING ERRCODE='42501';END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'allowed',a.profile_id IS NOT NULL) ORDER BY p.name,p.id)
 FROM profiles p LEFT JOIN quote_painting_cost_access a ON a.profile_id=p.id WHERE p.active=true AND p.role='staff'),'[]'::jsonb);
END;$$;
REVOKE ALL ON FUNCTION public.quote_painting_access_list() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.quote_painting_access_list() TO authenticated;
CREATE OR REPLACE FUNCTION public.quote_painting_set_access(p_profile uuid,p_allowed boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT _quote_painting_can_cost(true) THEN RAISE EXCEPTION '仅管理层可配置成本权限' USING ERRCODE='42501';END IF;
 IF p_allowed IS NULL OR NOT EXISTS(SELECT 1 FROM profiles WHERE id=p_profile AND active=true AND role='staff') THEN RAISE EXCEPTION '请选择有效在职员工';END IF;
 IF p_allowed THEN INSERT INTO quote_painting_cost_access(profile_id,granted_by) VALUES(p_profile,auth.uid()) ON CONFLICT(profile_id) DO UPDATE SET granted_by=auth.uid(),created_at=now();
 ELSE DELETE FROM quote_painting_cost_access WHERE profile_id=p_profile;END IF;
END;$$;
REVOKE ALL ON FUNCTION public.quote_painting_set_access(uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.quote_painting_set_access(uuid,boolean) TO authenticated;
CREATE OR REPLACE FUNCTION public.quote_painting_site_rate(p_code text,p_cost numeric)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result numeric;
BEGIN
 IF NOT _quote_painting_can_cost() THEN RAISE EXCEPTION '现场成本核价须有成本查看权限' USING ERRCODE='42501';END IF;
 IF p_cost IS NULL OR p_cost::text IN ('NaN','Infinity','-Infinity') OR p_cost<=0 OR p_cost>1000000 THEN RAISE EXCEPTION '请输入有效现场单位成本';END IF;
 SELECT round(p_cost*(1+markup_percent/100),2) INTO result FROM quote_painting_prices WHERE code=p_code AND active=true;
 IF result IS NULL THEN RAISE EXCEPTION '项目未启用';END IF;RETURN result;
END;$$;
REVOKE ALL ON FUNCTION public.quote_painting_site_rate(text,numeric) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.quote_painting_site_rate(text,numeric) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
