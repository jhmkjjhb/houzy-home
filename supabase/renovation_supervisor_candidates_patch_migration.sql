-- 「施工监理」标签：列出公司所有施工监理账号，并显示每人正在管几个工地。可重复运行。
-- 员工指定内部监理时可选的账号：角色是「施工监理」的在职账号（员工不能直接读账号表）
CREATE OR REPLACE FUNCTION public.renovation_supervisor_candidates()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM profiles WHERE id=auth.uid() AND coalesce(active,true) AND role IN ('staff','store_manager','regional_manager','general_manager','admin','superadmin')) THEN RAISE EXCEPTION '请登录后重试'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',u.id,'name',u.name,'phone',coalesce(u.phone,''),
   'sites',(SELECT count(*) FROM renovation_site_supervisors s JOIN renovation_projects p ON p.id=s.project_id WHERE s.profile_id=u.id AND s.active AND p.state IN ('confirmed','executing'))) ORDER BY u.name)
  FROM profiles u WHERE u.role='supervisor' AND coalesce(u.active,true)),'[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.renovation_supervisor_candidates() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.renovation_supervisor_candidates() TO authenticated;
