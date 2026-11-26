-- quote_cloud_images_migration.sql
-- 2026-11-26 整单报价器自动同步：平面图和房间照片存到云端私有文件夹 quote-images/<员工账号>/<内容编号>.jpg
-- 只有上传的那个员工账号能读写自己的图片（和「我的云端报价」一样按账号隔开）。
-- 依赖：quote_cloud_slots_migration.sql 已运行（_is_active_staff）。
-- 可重复执行。运行：Supabase SQL Editor → 粘贴全部 → Run

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 VALUES('quote-images','quote-images',false,5242880,ARRAY['image/jpeg','image/png','image/webp']) ON CONFLICT(id) DO NOTHING;
UPDATE storage.buckets SET public=false,file_size_limit=5242880,allowed_mime_types=ARRAY['image/jpeg','image/png','image/webp'] WHERE id='quote-images';

DROP POLICY IF EXISTS quote_images_read ON storage.objects;
CREATE POLICY quote_images_read ON storage.objects FOR SELECT TO authenticated
 USING(bucket_id='quote-images' AND split_part(name,'/',1)=auth.uid()::text AND public._is_active_staff(1));

DROP POLICY IF EXISTS quote_images_upload ON storage.objects;
CREATE POLICY quote_images_upload ON storage.objects FOR INSERT TO authenticated
 WITH CHECK(bucket_id='quote-images' AND split_part(name,'/',1)=auth.uid()::text AND public._is_active_staff(1));
