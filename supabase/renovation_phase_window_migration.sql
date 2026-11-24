-- 新增工序「铝窗拆装」（window）：同一班人拆旧窗装新窗一次做完，排在泥水之前（泥水再塞缝批荡，JGJ 214-2010 第 7.3.2 条）。
-- 已保存过「水电」旧计划的项目不变，铝窗仍在「台面门窗玻璃」里。
-- 依赖 renovation_phase_tile_migration.sql。可重复运行。
CREATE OR REPLACE FUNCTION public._reno_phase_name(k text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE k WHEN 'window' THEN '铝窗拆装' WHEN 'prep' THEN '拆除保护' WHEN 'plumb' THEN '水路预埋' WHEN 'elec' THEN '电路预埋' WHEN 'fix_plumb' THEN '水路安装' WHEN 'fix_elec' THEN '电路安装' WHEN 'hardware' THEN '五金窗帘' WHEN 'mep' THEN '水电' WHEN 'masonry' THEN '泥水' WHEN 'tile' THEN '铺瓷砖' WHEN 'ceiling' THEN '天花木作' WHEN 'paint' THEN '油漆'
  WHEN 'cabinet' THEN '定制柜安装' WHEN 'fit' THEN '台面门窗玻璃' WHEN 'fixture' THEN '洁具灯具设备' WHEN 'clean' THEN '清洁交付' ELSE k END $$;

CREATE OR REPLACE FUNCTION public._reno_phase_merge(old jsonb,p_plan jsonb,OUT merged jsonb,OUT changes jsonb) LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE k text;v jsonb;s date;e date;
 keys constant text[]:=ARRAY['window','prep','plumb','elec','mep','masonry','tile','ceiling','paint','cabinet','fit','fix_plumb','fix_elec','hardware','fixture','clean'];
BEGIN
 IF p_plan IS NULL OR jsonb_typeof(p_plan)<>'object' THEN RAISE EXCEPTION '计划格式不对'; END IF;
 merged:=coalesce(old,'{}'::jsonb);changes:='[]'::jsonb;
 FOR k,v IN SELECT * FROM jsonb_each(p_plan) LOOP
  IF NOT k=ANY(keys) THEN RAISE EXCEPTION '不认识的工序：%',k; END IF;
  IF v IS NULL OR jsonb_typeof(v)='null' THEN
   IF merged ? k THEN changes:=changes||jsonb_build_array(jsonb_build_object('phase',k,'before_start',merged->k->>'start','before_end',merged->k->>'end','start',NULL,'end',NULL));END IF;
   merged:=merged-k;CONTINUE;
  END IF;
  BEGIN s:=(v->>'start')::date;e:=(v->>'end')::date; EXCEPTION WHEN others THEN RAISE EXCEPTION '工序日期格式不对'; END;
  IF s IS NULL OR e IS NULL OR e<s OR s<DATE '2020-01-01' OR e>DATE '2099-12-31' OR e-s>366 THEN RAISE EXCEPTION '工序日期不对：结束不能早于开始，单道工序最长一年'; END IF;
  IF (merged->k->>'start') IS DISTINCT FROM s::text OR (merged->k->>'end') IS DISTINCT FROM e::text THEN
   changes:=changes||jsonb_build_array(jsonb_build_object('phase',k,'before_start',merged->k->>'start','before_end',merged->k->>'end','start',s,'end',e));
  END IF;
  merged:=merged||jsonb_build_object(k,jsonb_build_object('start',s,'end',e));
 END LOOP;
END $$;
