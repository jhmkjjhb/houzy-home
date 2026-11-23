-- 子单固定总天数：比如橱柜「设计 + 定做 + 安装」共 45 天，从开始设计下单那天算起到装好。
-- 施工计划按这个天数倒推：工厂定做天数 = 总天数 − 现场安装天数，算出最晚哪天必须开始设计下单。
-- 依赖 renovation_schedule_migration.sql。可重复运行。
ALTER TABLE public.renovation_work_orders ADD COLUMN IF NOT EXISTS fixed_days integer CHECK(fixed_days IS NULL OR fixed_days BETWEEN 1 AND 365);

CREATE OR REPLACE FUNCTION public.renovation_work_order_days_save(p_work_order uuid,p_days integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE w renovation_work_orders%ROWTYPE;p renovation_projects%ROWTYPE;who text;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION '请登录后重试'; END IF;
 SELECT * INTO w FROM renovation_work_orders WHERE id=p_work_order AND cancelled_at IS NULL FOR UPDATE;
 IF w.id IS NULL THEN RAISE EXCEPTION '子单不存在'; END IF;
 SELECT * INTO p FROM renovation_projects WHERE id=w.project_id;
 IF NOT _reno_access(p.store_id,p.created_by) THEN RAISE EXCEPTION '无此项目权限'; END IF;
 IF p.state NOT IN ('confirmed','executing') THEN RAISE EXCEPTION '项目当前不可修改施工计划'; END IF;
 IF p_days IS NOT NULL AND (p_days<1 OR p_days>365) THEN RAISE EXCEPTION '天数要在 1 到 365 之间'; END IF;
 IF w.fixed_days IS NOT DISTINCT FROM p_days THEN RETURN jsonb_build_object('ok',true,'changed',false); END IF;
 UPDATE renovation_work_orders SET fixed_days=p_days WHERE id=w.id;
 SELECT name INTO who FROM profiles WHERE id=auth.uid();
 INSERT INTO renovation_audit(project_id,actor,action,payload) VALUES(p.id,auth.uid(),'work_order_days_saved',
  jsonb_build_object('work_order_id',w.id,'name',w.group_name,'before',w.fixed_days,'days',p_days,'by',coalesce(who,'')));
 RETURN jsonb_build_object('ok',true,'changed',true);
END $$;
REVOKE ALL ON FUNCTION public.renovation_work_order_days_save(uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.renovation_work_order_days_save(uuid,integer) TO authenticated;
