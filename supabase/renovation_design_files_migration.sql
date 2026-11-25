-- renovation_design_files_migration.sql
-- 2026-11-25 整装项目「设计图纸」：店员上传效果图 / 施工图；改图时上传新版替换，旧版留底。
-- 现场页（内部监理登录后 / 外部监理验证码通过后 12 小时内）能看到每张图的最新版。
-- 文件存在 renovation-fulfillment 桶的 <项目>/design/ 下（PDF、JPG、PNG、WEBP，单个 ≤20MB）。
-- 依赖：renovation_site_supervision_migration.sql、renovation_phase_site_migration.sql 已运行。
-- 可重复执行。运行：Supabase SQL Editor → 粘贴全部 → Run

CREATE TABLE IF NOT EXISTS public.renovation_design_files (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id uuid NOT NULL REFERENCES public.renovation_projects(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('render','drawing')),
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 80),
 path text NOT NULL UNIQUE,
 mime text,
 size_bytes bigint,
 version int NOT NULL DEFAULT 1,
 replaces uuid REFERENCES public.renovation_design_files(id),
 superseded_at timestamptz,
 removed_at timestamptz,
 uploaded_by uuid DEFAULT auth.uid(),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS renovation_design_files_project ON public.renovation_design_files(project_id,created_at);
ALTER TABLE public.renovation_design_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.renovation_design_files FROM anon;
REVOKE INSERT,UPDATE,DELETE ON public.renovation_design_files FROM authenticated;
GRANT SELECT ON public.renovation_design_files TO authenticated;
DROP POLICY IF EXISTS reno_design_files_read ON public.renovation_design_files;
CREATE POLICY reno_design_files_read ON public.renovation_design_files FOR SELECT TO authenticated
 USING(EXISTS(SELECT 1 FROM renovation_projects p WHERE p.id=project_id AND _reno_access(p.store_id,p.created_by)));

-- 店员上传：<项目>/design/<随机名>
DROP POLICY IF EXISTS reno_design_upload ON storage.objects;
CREATE POLICY reno_design_upload ON storage.objects FOR INSERT TO authenticated
 WITH CHECK(bucket_id='renovation-fulfillment' AND split_part(name,'/',2)='design' AND EXISTS(
  SELECT 1 FROM renovation_projects p WHERE p.id::text=split_part(name,'/',1) AND _reno_access(p.store_id,p.created_by)));

-- 监理看图：只能看登记过、没删除的设计文件，而且是自己正在管的工地（外部监理要在验证码有效期内）
CREATE OR REPLACE FUNCTION public._reno_design_readable(p_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM renovation_design_files f JOIN renovation_site_supervisors s ON s.project_id=f.project_id
  WHERE f.path=p_name AND f.removed_at IS NULL AND s.active
   AND ((s.kind='internal' AND s.profile_id=auth.uid()) OR (s.kind='external' AND s.verified_until>now())));
$$;
REVOKE ALL ON FUNCTION public._reno_design_readable(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._reno_design_readable(text) TO anon,authenticated;
DROP POLICY IF EXISTS reno_design_site_read ON storage.objects;
CREATE POLICY reno_design_site_read ON storage.objects FOR SELECT TO anon,authenticated
 USING(bucket_id='renovation-fulfillment' AND split_part(name,'/',2)='design' AND public._reno_design_readable(name));

-- 登记 / 换新版 / 删除。p_data：{kind,title,path,mime,size,replaces?} 或 {remove_id}
CREATE OR REPLACE FUNCTION public.renovation_design_file_save(p_project uuid,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p renovation_projects; old renovation_design_files; f renovation_design_files; v_path text:=p_data->>'path';
BEGIN
 SELECT * INTO p FROM renovation_projects WHERE id=p_project;
 IF NOT FOUND OR NOT _reno_access(p.store_id,p.created_by) THEN RAISE EXCEPTION '没有这个整装项目的权限' USING ERRCODE='42501'; END IF;
 IF p_data ? 'remove_id' THEN
  UPDATE renovation_design_files SET removed_at=now() WHERE id=(p_data->>'remove_id')::uuid AND project_id=p.id AND removed_at IS NULL AND superseded_at IS NULL RETURNING * INTO f;
  IF NOT FOUND THEN RAISE EXCEPTION '这张图已经删除或已有新版'; END IF;
  RETURN jsonb_build_object('ok',true,'removed',f.id);
 END IF;
 IF coalesce(p_data->>'kind','') NOT IN ('render','drawing') THEN RAISE EXCEPTION '请选择是效果图还是施工图'; END IF;
 IF v_path IS NULL OR split_part(v_path,'/',1)<>p.id::text OR split_part(v_path,'/',2)<>'design'
  OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='renovation-fulfillment' AND name=v_path) THEN RAISE EXCEPTION '文件还没上传好，请重新选择'; END IF;
 IF p_data ? 'replaces' THEN
  SELECT * INTO old FROM renovation_design_files WHERE id=(p_data->>'replaces')::uuid AND project_id=p.id AND removed_at IS NULL AND superseded_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '要替换的图已经有新版或已删除，请刷新'; END IF;
  UPDATE renovation_design_files SET superseded_at=now() WHERE id=old.id;
 END IF;
 INSERT INTO renovation_design_files(project_id,kind,title,path,mime,size_bytes,version,replaces)
 VALUES(p.id,coalesce(old.kind,p_data->>'kind'),coalesce(nullif(btrim(p_data->>'title'),''),old.title),v_path,p_data->>'mime',nullif(p_data->>'size','')::bigint,
  coalesce(old.version,0)+1,old.id) RETURNING * INTO f;
 RETURN jsonb_build_object('ok',true,'id',f.id,'version',f.version);
END $$;
REVOKE ALL ON FUNCTION public.renovation_design_file_save(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.renovation_design_file_save(uuid,jsonb) TO authenticated;

-- 现场页数据：在原来的基础上加 design（每张图的最新版）
CREATE OR REPLACE FUNCTION public._reno_site_payload(p_project uuid,p_sup uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object(
  'project',jsonb_build_object('id',p.id,'contract_no',p.contract_no,'address',p.address,'handover_on',p.handover_on,'state',p.state,
   'phase_plan',coalesce(p.phase_plan,'{}'::jsonb),'phase_setup',coalesce(p.phase_setup,'{}'::jsonb),'phase_locked',p.phase_baseline_locked_at IS NOT NULL),
  'supervisor',(SELECT jsonb_build_object('id',s.id,'name',s.name,'kind',s.kind) FROM renovation_site_supervisors s WHERE s.id=p_sup),
  'today',(now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date,
  'work_orders',coalesce((SELECT jsonb_agg(jsonb_build_object('id',w.id,'group_name',regexp_replace(w.group_name,'^增项-[0-9a-fA-F-]{36} · ?','增项 · '),'assignee',w.assignee,
    'planned_start',w.planned_start,'planned_end',w.planned_end,
    'items',coalesce((SELECT jsonb_agg(jsonb_build_object('line_id',i.line_id,'name',i.name,'spec',i.spec,'qty',i.qty,'unit',i.unit,'kind',i.kind,'stage',i.stage,'issue',i.issue_note,
       'expected_on',(SELECT b.expected_on FROM renovation_purchase_batches b WHERE b.id=i.batch_id),'arrived_on',i.arrived_on,'done_on',i.done_on) ORDER BY i.line_id)
      FROM renovation_work_items i WHERE i.work_order_id=w.id AND i.stage<>'cancelled'),'[]'::jsonb)) ORDER BY w.planned_start NULLS LAST,w.group_name)
   FROM renovation_work_orders w WHERE w.project_id=p.id AND w.cancelled_at IS NULL),'[]'::jsonb),
  'entries',coalesce((SELECT jsonb_agg(jsonb_build_object('id',e.id,'kind',e.kind,'on_date',e.on_date,'note',e.note,'work_order_id',e.work_order_id,'photo_count',jsonb_array_length(e.photos),
    'data',e.data,'status',e.status,'mine',e.supervisor_id=p_sup,'created_at',e.created_at) ORDER BY e.created_at DESC)
   FROM (SELECT * FROM renovation_site_entries WHERE project_id=p.id AND (on_date>=(now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date-45 OR status='open') ORDER BY created_at DESC LIMIT 200) e),'[]'::jsonb),
  'design',coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.id,'kind',f.kind,'title',f.title,'path',f.path,'mime',f.mime,'version',f.version,'created_at',f.created_at)
    ORDER BY f.kind DESC,f.title,f.created_at)
   FROM renovation_design_files f WHERE f.project_id=p.id AND f.removed_at IS NULL AND f.superseded_at IS NULL),'[]'::jsonb))
 FROM renovation_projects p WHERE p.id=p_project;
$$;
REVOKE ALL ON FUNCTION public._reno_site_payload(uuid,uuid) FROM PUBLIC,anon,authenticated;
