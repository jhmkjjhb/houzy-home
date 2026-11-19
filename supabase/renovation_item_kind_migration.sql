-- 子单清单项改「定制 / 现货」：合同导入时材料默认都算定制，成品（卫浴、瓷砖等）不需要业主签名和工厂确认。
-- 只能在下单之前改；正在等业主签名的项要先撤销确认单。改动记入历史。依赖 renovation_fulfillment_migration.sql。可重复运行。
CREATE OR REPLACE FUNCTION public.renovation_item_kind_set(p_id uuid,p_work_order uuid,p_line_ids jsonb,p_kind text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p renovation_projects%ROWTYPE;n integer;bad text;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION '请登录后重试'; END IF;
 SELECT * INTO p FROM renovation_projects WHERE id=p_id FOR UPDATE;
 IF p.id IS NULL OR NOT _reno_access(p.store_id,p.created_by) THEN RAISE EXCEPTION '无此项目权限'; END IF;
 IF p.state<>'executing' THEN RAISE EXCEPTION '项目当前不可修改'; END IF;
 IF p_kind NOT IN ('custom','stock') THEN RAISE EXCEPTION '只能改为定制或现货'; END IF;
 IF p_line_ids IS NULL OR jsonb_typeof(p_line_ids)<>'array' OR jsonb_array_length(p_line_ids)=0 THEN RAISE EXCEPTION '请先勾选要修改的清单项'; END IF;
 IF NOT EXISTS(SELECT 1 FROM renovation_work_orders WHERE id=p_work_order AND project_id=p_id AND cancelled_at IS NULL) THEN RAISE EXCEPTION '子订单不存在或已作废'; END IF;
 SELECT string_agg(i.name,'、') INTO bad FROM renovation_work_items i
  WHERE i.work_order_id=p_work_order AND p_line_ids ? i.line_id AND (i.kind NOT IN ('custom','stock') OR i.stage NOT IN ('pending','confirmed'));
 IF bad IS NOT NULL THEN RAISE EXCEPTION '已下单的项或施工 / 赠品不能改：%',bad; END IF;
 SELECT string_agg(i.name,'、') INTO bad FROM renovation_work_items i
  WHERE i.work_order_id=p_work_order AND p_line_ids ? i.line_id AND EXISTS(SELECT 1 FROM renovation_custom_confirmations c
   WHERE c.work_order_id=p_work_order AND c.status IN ('pending','paper_review') AND c.line_ids ? i.line_id);
 IF bad IS NOT NULL THEN RAISE EXCEPTION '这些项正在等业主签名，请先撤销确认单再改：%',bad; END IF;
 -- 改成现货：可以直接下单；改成定制：要重新走业主签名
 UPDATE renovation_work_items SET kind=p_kind,stage=CASE WHEN p_kind='custom' THEN 'pending' ELSE stage END,confirmation_id=CASE WHEN p_kind='custom' THEN NULL ELSE confirmation_id END,updated_at=now()
  WHERE work_order_id=p_work_order AND p_line_ids ? line_id AND kind<>p_kind;
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n=0 THEN RAISE EXCEPTION '勾选的项已经是这个类型'; END IF;
 INSERT INTO renovation_audit(project_id,actor,action,payload) VALUES(p_id,auth.uid(),'fulfillment_kind_changed',jsonb_build_object('work_order_id',p_work_order,'line_ids',p_line_ids,'kind',p_kind,'changed',n));
 RETURN jsonb_build_object('ok',true,'changed',n);
END $$;
REVOKE ALL ON FUNCTION public.renovation_item_kind_set(uuid,uuid,jsonb,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.renovation_item_kind_set(uuid,uuid,jsonb,text) TO authenticated;

-- 下单时「厂家单号」改为选填：工厂往往下单后才给单号，可以之后在「下单记录 → 更正这条记录」里补上。
DO $patch$
DECLARE d text;
BEGIN
 d:=pg_get_functiondef('public.renovation_fulfillment_command(uuid,integer,text,jsonb)'::regprocedure);
 IF position('定制单请填写厂家单号' IN d)>0 THEN
  d:=replace(d,$x$IF order_no='' AND EXISTS(SELECT 1 FROM renovation_work_items WHERE id=ANY(picked) AND kind='custom') THEN RAISE EXCEPTION '定制单请填写厂家单号'; END IF;$x$,'');
  IF position('定制单请填写厂家单号' IN d)>0 THEN RAISE EXCEPTION '没找到「定制单必须填厂家单号」这一行，未修改。请把这条信息发给技术人员。'; END IF;
  EXECUTE d;
 END IF;
END $patch$;
