-- renovation_design_share_migration.sql
-- 2026-11-25 设计图纸第 2 批：
--  1) 店员给施工师傅 / 厂家发「看图链接」，不用验证码，打开就能看这个项目所有图纸的最新版；
--     项目竣工验收后自动失效，店员也可随时停用。
--  2) 业主在自己的整装档案页（客户链接）能看效果图的最新版（打开时放行 2 小时）。
-- 依赖：renovation_design_files_migration.sql 已运行。
-- 可重复执行。运行：Supabase SQL Editor → 粘贴全部 → Run

CREATE TABLE IF NOT EXISTS public.renovation_design_shares (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id uuid NOT NULL REFERENCES public.renovation_projects(id) ON DELETE CASCADE,
 kind text NOT NULL DEFAULT 'share' CHECK(kind IN ('share','owner')),
 label text CHECK(label IS NULL OR length(btrim(label)) BETWEEN 1 AND 60),
 token uuid NOT NULL DEFAULT gen_random_uuid(),
 access_code text CHECK(access_code IS NULL OR access_code ~ '^[0-9]{4}$'),
 failed_checks int NOT NULL DEFAULT 0,
 verified_until timestamptz,
 opened_at timestamptz,
 revoked_at timestamptz,
 created_by uuid DEFAULT auth.uid(),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS renovation_design_shares_owner ON public.renovation_design_shares(project_id) WHERE kind='owner';
CREATE INDEX IF NOT EXISTS renovation_design_shares_project ON public.renovation_design_shares(project_id,created_at);
ALTER TABLE public.renovation_design_shares ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.renovation_design_shares FROM anon;
REVOKE INSERT,UPDATE,DELETE ON public.renovation_design_shares FROM authenticated;
GRANT SELECT ON public.renovation_design_shares TO authenticated;
DROP POLICY IF EXISTS reno_design_shares_read ON public.renovation_design_shares;
CREATE POLICY reno_design_shares_read ON public.renovation_design_shares FOR SELECT TO authenticated
 USING(kind='share' AND EXISTS(SELECT 1 FROM renovation_projects p WHERE p.id=project_id AND _reno_access(p.store_id,p.created_by)));

-- 谁能读图：① 本工地监理（原规则）② 看图链接验证码有效期内：本项目各图最新版 ③ 业主打开档案后 2 小时内：本项目效果图最新版
CREATE OR REPLACE FUNCTION public._reno_design_readable(p_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM renovation_design_files f JOIN renovation_site_supervisors s ON s.project_id=f.project_id
  WHERE f.path=p_name AND f.removed_at IS NULL AND s.active
   AND ((s.kind='internal' AND s.profile_id=auth.uid()) OR (s.kind='external' AND s.verified_until>now())))
 OR EXISTS(SELECT 1 FROM renovation_design_files f JOIN renovation_design_shares a ON a.project_id=f.project_id
  WHERE f.path=p_name AND f.removed_at IS NULL AND f.superseded_at IS NULL AND a.revoked_at IS NULL AND a.verified_until>now()
   AND (a.kind='share' OR f.kind='render')
   AND (a.kind='owner' OR EXISTS(SELECT 1 FROM renovation_projects p WHERE p.id=f.project_id AND p.state<>'accepted')));
$$;
REVOKE ALL ON FUNCTION public._reno_design_readable(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._reno_design_readable(text) TO anon,authenticated;

CREATE OR REPLACE FUNCTION public._reno_design_current(p_project uuid,p_render_only boolean)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',f.id,'kind',f.kind,'title',f.title,'path',f.path,'mime',f.mime,'version',f.version,'created_at',f.created_at)
   ORDER BY f.kind DESC,f.title,f.created_at),'[]'::jsonb)
 FROM renovation_design_files f WHERE f.project_id=p_project AND f.removed_at IS NULL AND f.superseded_at IS NULL AND (NOT p_render_only OR f.kind='render');
$$;
REVOKE ALL ON FUNCTION public._reno_design_current(uuid,boolean) FROM PUBLIC,anon,authenticated;

-- 店员：新建看图链接 {label} → {id,token}；停用 {revoke_id}
CREATE OR REPLACE FUNCTION public.renovation_design_share_save(p_project uuid,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p renovation_projects; a renovation_design_shares; v_label text:=btrim(coalesce(p_data->>'label',''));
BEGIN
 SELECT * INTO p FROM renovation_projects WHERE id=p_project;
 IF NOT FOUND OR NOT _reno_access(p.store_id,p.created_by) THEN RAISE EXCEPTION '没有这个整装项目的权限' USING ERRCODE='42501'; END IF;
 IF p_data ? 'revoke_id' THEN
  UPDATE renovation_design_shares SET revoked_at=now(),verified_until=NULL WHERE id=(p_data->>'revoke_id')::uuid AND project_id=p.id AND kind='share' AND revoked_at IS NULL RETURNING * INTO a;
  IF NOT FOUND THEN RAISE EXCEPTION '这个链接已经停用'; END IF;
  RETURN jsonb_build_object('ok',true,'revoked',a.id);
 END IF;
 IF v_label='' OR length(v_label)>60 THEN RAISE EXCEPTION '请写给谁看（例如：木工 张师傅、橱柜厂）'; END IF;
 IF p.state='accepted' THEN RAISE EXCEPTION '项目已竣工验收，看图链接不再开放'; END IF;
 INSERT INTO renovation_design_shares(project_id,kind,label) VALUES(p.id,'share',v_label) RETURNING * INTO a;
 RETURN jsonb_build_object('ok',true,'id',a.id,'token',a.token);
END $$;
REVOKE ALL ON FUNCTION public.renovation_design_share_save(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.renovation_design_share_save(uuid,jsonb) TO authenticated;

-- 师傅 / 厂家打开看图链接：不用验证码；没停用、项目没竣工验收就能看，每次打开放行 12 小时读文件。返回各图最新版（不含价格、业主电话）
DROP FUNCTION IF EXISTS public.renovation_design_share_open(uuid,uuid,text);
CREATE OR REPLACE FUNCTION public.renovation_design_share_open(p_id uuid,p_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a renovation_design_shares; p renovation_projects;
BEGIN
 SELECT * INTO a FROM renovation_design_shares WHERE id=p_id AND token=p_token AND kind='share' FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF a.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('status','revoked'); END IF;
 SELECT * INTO p FROM renovation_projects WHERE id=a.project_id;
 IF p.state='accepted' THEN RETURN jsonb_build_object('status','finished'); END IF;
 UPDATE renovation_design_shares SET verified_until=now()+interval '12 hours',opened_at=now() WHERE id=a.id;
 RETURN jsonb_build_object('status','ok','label',a.label,'contract_no',p.contract_no,'address',p.address,'files',_reno_design_current(p.id,false));
END $$;
REVOKE ALL ON FUNCTION public.renovation_design_share_open(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renovation_design_share_open(uuid,uuid) TO anon,authenticated;

-- 业主档案页：用客户链接读效果图最新版，放行 2 小时
CREATE OR REPLACE FUNCTION public.renovation_customer_design(p_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p renovation_projects; v jsonb;
BEGIN
 SELECT * INTO p FROM renovation_projects WHERE customer_token=p_token AND state<>'draft';
 IF NOT FOUND THEN RETURN '[]'::jsonb; END IF;
 v:=_reno_design_current(p.id,true);
 IF jsonb_array_length(v)>0 THEN
  INSERT INTO renovation_design_shares(project_id,kind,verified_until,opened_at) VALUES(p.id,'owner',now()+interval '2 hours',now())
  ON CONFLICT (project_id) WHERE kind='owner' DO UPDATE SET verified_until=excluded.verified_until,opened_at=excluded.opened_at;
 END IF;
 RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.renovation_customer_design(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renovation_customer_design(uuid) TO anon,authenticated;
