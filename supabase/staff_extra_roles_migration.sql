-- staff_extra_roles_migration.sql
-- 2026-11-27 人员「兼任」与个人看板：
--  1) 每个人一个主职位（profiles.role，决定能看哪些门店和订单）+ 兼任（profiles.extra_roles）：公司财务、施工监理。
--  2) 只有总经理及以上能改职位和兼任（员工不能给自己加权限）。
--  3) 总经理、公司财务、管理员可以打开某个人的综合看板（按月：开单、整装、报价、监理、请款、审批付款、最近动态）。
-- 依赖：renovation_expenses_migration.sql、renovation_supervisor_candidates_patch_migration.sql、renovation_phase_setup_migration.sql。
-- 可重复运行。运行：Supabase SQL Editor → 粘贴全部 → Run

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS extra_roles text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_extra_roles_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_extra_roles_check CHECK (extra_roles <@ ARRAY['finance','supervisor']::text[]);

-- 只有总经理及以上（或在 SQL 后台）能改职位 / 兼任
CREATE OR REPLACE FUNCTION public._guard_profile_roles()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF (NEW.role IS DISTINCT FROM OLD.role OR NEW.extra_roles IS DISTINCT FROM OLD.extra_roles)
  AND auth.uid() IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM profiles WHERE id=auth.uid() AND active AND role IN ('general_manager','admin','superadmin')) THEN
  RAISE EXCEPTION '只有总经理或管理员能修改职位' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_profile_roles ON public.profiles;
CREATE TRIGGER guard_profile_roles BEFORE UPDATE OF role, extra_roles ON public.profiles
 FOR EACH ROW EXECUTE FUNCTION public._guard_profile_roles();

-- 兼任公司财务：和主职位是财务一样能付款、看利润
CREATE OR REPLACE FUNCTION public._is_finance()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM profiles p WHERE p.id=auth.uid() AND p.active
  AND (p.role IN ('finance','general_manager','admin','superadmin') OR coalesce(to_jsonb(p)->'extra_roles','[]'::jsonb) ? 'finance'));
$$;
REVOKE ALL ON FUNCTION public._is_finance() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public._is_finance() TO authenticated;

-- 兼任施工监理：出现在「指定监理」名单里，被指定的工地能调整施工计划
CREATE OR REPLACE FUNCTION public.renovation_supervisor_candidates()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM profiles WHERE id=auth.uid() AND coalesce(active,true) AND role IN ('staff','store_manager','regional_manager','general_manager','admin','superadmin')) THEN RAISE EXCEPTION '请登录后重试'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',u.id,'name',u.name,'phone',coalesce(u.phone,''),
   'sites',(SELECT count(*) FROM renovation_site_supervisors s JOIN renovation_projects p ON p.id=s.project_id WHERE s.profile_id=u.id AND s.active AND p.state IN ('confirmed','executing'))) ORDER BY u.name)
  FROM profiles u WHERE (u.role='supervisor' OR 'supervisor'=ANY(u.extra_roles)) AND coalesce(u.active,true)),'[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.renovation_supervisor_candidates() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.renovation_supervisor_candidates() TO authenticated;

CREATE OR REPLACE FUNCTION public._reno_plan_editor(p_project uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM renovation_projects p WHERE p.id=p_project AND _reno_access(p.store_id,p.created_by))
  OR EXISTS(SELECT 1 FROM renovation_site_supervisors s JOIN profiles f ON f.id=s.profile_id
   WHERE s.project_id=p_project AND s.active AND s.kind='internal' AND s.profile_id=auth.uid() AND f.active=true AND (f.role='supervisor' OR 'supervisor'=ANY(f.extra_roles))) $$;
REVOKE ALL ON FUNCTION public._reno_plan_editor(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public._reno_plan_editor(uuid) TO authenticated;

-- 个人综合看板。p_month 是这个月任意一天（默认本月）。只有总经理、公司财务（含兼任）、管理员能看。
CREATE OR REPLACE FUNCTION public.staff_person_overview(p_user uuid,p_month date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE m0 date:=date_trunc('month',coalesce(p_month,(now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date))::date;m1 date;u profiles%ROWTYPE;
BEGIN
 IF NOT public._is_finance() THEN RAISE EXCEPTION '只有总经理、公司财务和管理员能看个人看板' USING ERRCODE='42501'; END IF;
 m1:=(m0+interval '1 month')::date;
 SELECT * INTO u FROM profiles WHERE id=p_user;
 IF u.id IS NULL THEN RAISE EXCEPTION '找不到这个人'; END IF;
 RETURN jsonb_build_object(
  'month',to_char(m0,'YYYY-MM'),
  'person',jsonb_build_object('id',u.id,'name',u.name,'phone',u.phone,'role',u.role,'extra_roles',to_jsonb(u.extra_roles),'active',u.active,
    'store',(SELECT name FROM stores WHERE id=u.store_id),'region',u.region),
  -- 普通订单：本月开单（按开单日期，不含取消）、本月收款（这个人开的单在本月收到的钱）、还在进行的单
  'goods',jsonb_build_object(
    'created',(SELECT count(*) FROM orders o WHERE o.staff_id=u.id AND o.status<>'cancelled' AND (o.created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date>=m0 AND (o.created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date<m1),
    'open',(SELECT count(*) FROM orders o WHERE o.staff_id=u.id AND o.status NOT IN ('completed','closed','cancelled'))),
  'goods_amount',coalesce((SELECT jsonb_object_agg(cur,amt) FROM (
    SELECT upper(coalesce(nullif(to_jsonb(o)->>'currency',''),'MYR')) cur,sum(o.amount) amt FROM orders o
    WHERE o.staff_id=u.id AND o.status<>'cancelled' AND (o.created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date>=m0 AND (o.created_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date<m1 GROUP BY 1) q),'{}'::jsonb),
  'goods_received',coalesce((SELECT jsonb_object_agg(cur,amt) FROM (
    SELECT upper(coalesce(nullif(to_jsonb(o)->>'currency',''),'MYR')) cur,sum(pp.amount) amt FROM orders o JOIN order_payments pp ON pp.order_id=o.id
    WHERE o.staff_id=u.id AND nullif(to_jsonb(pp)->>'voided_at','') IS NULL AND (pp.paid_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date>=m0 AND (pp.paid_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date<m1 GROUP BY 1) q),'{}'::jsonb),
  -- 整装：本月签约（签约日期在本月）、在施工的单、本月收款
  'renovation',jsonb_build_object(
    'signed',(SELECT count(*) FROM renovation_projects p WHERE p.created_by=u.id AND p.state<>'draft' AND nullif(p.snapshot->>'signed_on','')::date>=m0 AND nullif(p.snapshot->>'signed_on','')::date<m1),
    'signed_amount',coalesce((SELECT sum(p.current_total) FROM renovation_projects p WHERE p.created_by=u.id AND p.state<>'draft' AND nullif(p.snapshot->>'signed_on','')::date>=m0 AND nullif(p.snapshot->>'signed_on','')::date<m1),0),
    'active',(SELECT count(*) FROM renovation_projects p WHERE p.created_by=u.id AND p.state IN ('confirmed','executing')),
    'drafts',(SELECT count(*) FROM renovation_projects p WHERE p.created_by=u.id AND p.state='draft'),
    'received',coalesce((SELECT sum(CASE WHEN r.kind='receipt' THEN r.amount ELSE -r.amount END) FROM renovation_payments r JOIN renovation_projects p ON p.id=r.project_id
      WHERE p.created_by=u.id AND r.voided_at IS NULL AND r.paid_on>=m0 AND r.paid_on<m1),0)),
  -- 报价：本月发给客户的链接、客户打开次数；云端保存的报价（每人最多 3 份）本月改过几份
  'quotes',jsonb_build_object(
    'links',(SELECT count(*) FROM quote_shares s WHERE s.owner_id=u.id AND s.created_at>=m0 AND s.created_at<m1),
    'opened',(SELECT count(*) FROM quote_shares s WHERE s.owner_id=u.id AND s.created_at>=m0 AND s.created_at<m1 AND s.view_count>0),
    'views',coalesce((SELECT sum(view_count) FROM quote_shares s WHERE s.owner_id=u.id AND s.created_at>=m0 AND s.created_at<m1),0),
    'saved',(SELECT count(*) FROM quote_cloud_slots q WHERE q.owner_id=u.id AND q.updated_at>=m0 AND q.updated_at<m1)),
  -- 施工监理：负责中的工地、本月记了几天日志、未解决的问题
  'supervision',jsonb_build_object(
    'sites',(SELECT count(*) FROM renovation_site_supervisors s JOIN renovation_projects p ON p.id=s.project_id WHERE s.profile_id=u.id AND s.active AND p.state IN ('confirmed','executing')),
    'log_days',(SELECT count(DISTINCT e.on_date) FROM renovation_site_entries e JOIN renovation_site_supervisors s ON s.id=e.supervisor_id WHERE s.profile_id=u.id AND e.kind='log' AND e.on_date>=m0 AND e.on_date<m1),
    'entries',(SELECT count(*) FROM renovation_site_entries e JOIN renovation_site_supervisors s ON s.id=e.supervisor_id WHERE s.profile_id=u.id AND e.on_date>=m0 AND e.on_date<m1),
    'open_issues',(SELECT count(*) FROM renovation_site_entries e JOIN renovation_site_supervisors s ON s.id=e.supervisor_id WHERE s.profile_id=u.id AND e.kind='issue' AND e.status='open')),
  -- 请款：本月提交（按币种）、待批准、被退回
  'expenses',jsonb_build_object(
    'count',(SELECT count(*) FROM renovation_expenses x WHERE x.created_by=u.id AND x.created_at>=m0 AND x.created_at<m1 AND x.status<>'void'),
    'amount',coalesce((SELECT jsonb_object_agg(currency,amt) FROM (SELECT currency,sum(amount) amt FROM renovation_expenses x WHERE x.created_by=u.id AND x.created_at>=m0 AND x.created_at<m1 AND x.status IN ('pending','approved','paid') GROUP BY 1) q),'{}'::jsonb),
    'pending',(SELECT count(*) FROM renovation_expenses x WHERE x.created_by=u.id AND x.status='pending'),
    'rejected',(SELECT count(*) FROM renovation_expenses x WHERE x.created_by=u.id AND x.status='rejected' AND x.created_at>=m0 AND x.created_at<m1)),
  -- 审批 / 付款：本月批准别人的请款、本月付出去的钱
  'approvals',jsonb_build_object(
    'approved',(SELECT count(*) FROM renovation_expenses x WHERE x.approved_by=u.id AND x.created_by<>u.id AND x.approved_at>=m0 AND x.approved_at<m1),
    'paid',(SELECT count(*) FROM renovation_expenses x WHERE x.paid_by=u.id AND x.paid_at>=m0 AND x.paid_at<m1),
    'paid_amount',coalesce((SELECT jsonb_object_agg(currency,amt) FROM (SELECT currency,sum(amount) amt FROM renovation_expenses x WHERE x.paid_by=u.id AND x.paid_at>=m0 AND x.paid_at<m1 GROUP BY 1) q),'{}'::jsonb)),
  -- 最近动态：订单进度、整装操作、请款，合在一起取最近 20 条
  'recent',coalesce((SELECT jsonb_agg(a ORDER BY a->>'at' DESC) FROM (
    SELECT * FROM (
     SELECT jsonb_build_object('at',l.created_at,'kind','order','text','订单 '||o.order_no||' → '||l.status||coalesce(' · '||nullif(left(l.notes,60),''),'')) a,l.created_at t
      FROM order_logs l JOIN orders o ON o.id=l.order_id WHERE l.operator_id=u.id
     UNION ALL
     SELECT jsonb_build_object('at',a.created_at,'kind','renovation','text','整装 '||p.contract_no||' · '||a.action),a.created_at
      FROM renovation_audit a JOIN renovation_projects p ON p.id=a.project_id WHERE a.actor=u.id
     UNION ALL
     SELECT jsonb_build_object('at',x.created_at,'kind','expense','text','请款 '||x.payee||' '||x.currency||' '||x.amount),x.created_at
      FROM renovation_expenses x WHERE x.created_by=u.id
    ) r ORDER BY t DESC LIMIT 20) q),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.staff_person_overview(uuid,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.staff_person_overview(uuid,date) TO authenticated;

-- 人员名单（给财务页面的「人员看板」用）：只有总经理、公司财务、管理员能看
CREATE OR REPLACE FUNCTION public.staff_people_list()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT public._is_finance() THEN RAISE EXCEPTION '只有总经理、公司财务和管理员能看' USING ERRCODE='42501'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'role',p.role,'extra_roles',to_jsonb(p.extra_roles),'active',p.active,'store',s.name)
   ORDER BY p.active DESC,s.name NULLS LAST,p.name)
  FROM profiles p LEFT JOIN stores s ON s.id=p.store_id WHERE p.role NOT IN ('customer','supplier','logistics')),'[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.staff_people_list() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.staff_people_list() TO authenticated;
