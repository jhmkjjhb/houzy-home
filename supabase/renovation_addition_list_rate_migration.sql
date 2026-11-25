-- renovation_addition_list_rate_migration.sql
-- 2026-11-25 增项单显示打折：店员手填「原价单价」和「折后单价」，签署页、客户档案、后台都显示「原价 → 折后」。
-- 金额仍按 数量 × 折后单价 计算；原价只用于显示。没填原价的增项照旧，已发出的签署链接不受影响。
-- 待签的增项可以补填 / 修改原价（已签、已作废的不能改）。
-- 依赖：renovation_prorate_installments_migration.sql 已运行。可重复执行。运行：Supabase SQL Editor → 粘贴全部 → Run

ALTER TABLE public.renovation_additions ADD COLUMN IF NOT EXISTS list_rate numeric(14,2);
DO $$BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='renovation_additions_list_rate_ok') THEN
  ALTER TABLE public.renovation_additions ADD CONSTRAINT renovation_additions_list_rate_ok CHECK(list_rate IS NULL OR (list_rate>rate AND list_rate<=100000000));
 END IF;
END$$;

-- 签署内容：有原价时多带 list_rate / list_amount（没填原价的增项内容不变，旧链接不用重签）
CREATE OR REPLACE FUNCTION public._reno_addition_terms(p_addition uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('addition_id',a.id,'contract_no',p.contract_no,'address',p.address,'category',a.category,'name',a.name,
 'spec',a.spec,'qty',a.qty,'unit',a.unit,'rate',a.rate,'amount',a.amount,'payment_node',CASE WHEN a.signature_status='pending' AND a.voided_at IS NULL AND _reno_prorate_preview(p.id,a.amount) IS NOT NULL THEN '按合同比例并入未付清的各期' ELSE a.payment_node END,
 'payment_plan',CASE WHEN a.signature_status='pending' AND a.voided_at IS NULL THEN _reno_prorate_preview(p.id,a.amount) END,
 'original_total',coalesce((p.snapshot->>'net')::numeric,0),'current_total',p.current_total,'after_sign_total',p.current_total+a.amount,
 'warranty_note','新增项目质保范围及期限待双方补充确认，不自动沿用其他产品质保')
 ||CASE WHEN a.list_rate IS NOT NULL THEN jsonb_build_object('list_rate',a.list_rate,'list_amount',round(a.qty*a.list_rate,2)) ELSE '{}'::jsonb END
 FROM renovation_additions a JOIN renovation_projects p ON p.id=a.project_id WHERE a.id=p_addition;
$$;
REVOKE ALL ON FUNCTION public._reno_addition_terms(uuid) FROM PUBLIC;

-- 客户档案里的增项列表也带原价
CREATE OR REPLACE FUNCTION public.renovation_customer_additions(p_token uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'category',a.category,'name',a.name,'spec',a.spec,'qty',a.qty,'unit',a.unit,'rate',a.rate,
 'amount',a.amount,'list_rate',a.list_rate,'payment_node',a.payment_node,'signature_status',a.signature_status,'signed_at',a.signed_at,'signer_name',a.signer_name,
 'signature_hash',a.signature_hash,'voided',a.voided_at IS NOT NULL) ORDER BY a.created_at,a.id),'[]'::jsonb)
 FROM renovation_projects p JOIN renovation_additions a ON a.project_id=p.id WHERE p.customer_token=p_token AND p.state<>'draft';
$$;
REVOKE ALL ON FUNCTION public.renovation_customer_additions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renovation_customer_additions(uuid) TO anon,authenticated;

-- 店员给待签增项填 / 改 / 清除原价（p_list_rate 为 NULL 表示不显示打折）
CREATE OR REPLACE FUNCTION public.renovation_addition_list_rate(p_addition uuid,p_list_rate numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a renovation_additions%ROWTYPE;p renovation_projects%ROWTYPE;
BEGIN
 SELECT * INTO a FROM renovation_additions WHERE id=p_addition FOR UPDATE;
 SELECT * INTO p FROM renovation_projects WHERE id=a.project_id;
 IF a.id IS NULL OR NOT _reno_access(p.store_id,p.created_by) THEN RAISE EXCEPTION '无此项目权限' USING ERRCODE='42501'; END IF;
 IF a.voided_at IS NOT NULL OR a.signature_status<>'pending' THEN RAISE EXCEPTION '只有待客户签署的增项可以改原价'; END IF;
 IF p_list_rate IS NOT NULL AND (p_list_rate<=a.rate OR p_list_rate>100000000 OR p_list_rate<>round(p_list_rate,2)) THEN RAISE EXCEPTION '原价须高于折后单价，最多2位小数'; END IF;
 UPDATE renovation_additions SET list_rate=p_list_rate WHERE id=a.id RETURNING * INTO a;
 INSERT INTO renovation_audit(project_id,actor,action,payload) VALUES(a.project_id,auth.uid(),'addition_list_rate',jsonb_build_object('addition_id',a.id,'list_rate',a.list_rate,'rate',a.rate));
 RETURN to_jsonb(a);
END $$;
REVOKE ALL ON FUNCTION public.renovation_addition_list_rate(uuid,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.renovation_addition_list_rate(uuid,numeric) TO authenticated;
