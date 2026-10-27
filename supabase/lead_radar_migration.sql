-- Lead radar: public renovation-demand posts found by search, classified by AI,
-- handled manually by staff. Isolated from orders, contracts and customers.
-- Only the Edge Function (service role) writes posts and runs; staff change
-- status through lead_radar_mark. Re-runnable.
BEGIN;
CREATE OR REPLACE FUNCTION public._radar_level()
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce((SELECT CASE role WHEN 'staff' THEN 1 WHEN 'store_manager' THEN 2 WHEN 'regional_manager' THEN 3
  WHEN 'general_manager' THEN 4 WHEN 'admin' THEN 4 WHEN 'superadmin' THEN 5 ELSE 0 END
  FROM profiles WHERE id=auth.uid() AND active=true),0);
$$;
REVOKE ALL ON FUNCTION public._radar_level() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public._radar_level() TO authenticated;

CREATE TABLE IF NOT EXISTS public.lead_radar_queries(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 query text NOT NULL UNIQUE CHECK(length(trim(query)) BETWEEN 3 AND 200),
 lang text NOT NULL CHECK(lang IN ('en','zh','ms')),
 active boolean NOT NULL DEFAULT true,
 created_by uuid REFERENCES public.profiles(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.lead_radar_runs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 started_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 trigger text NOT NULL CHECK(trigger IN ('schedule','manual')),
 triggered_by uuid REFERENCES public.profiles(id),
 status text NOT NULL DEFAULT 'running' CHECK(status IN ('running','ok','partial','failed')),
 queries_run integer NOT NULL DEFAULT 0,
 results_seen integer NOT NULL DEFAULT 0,
 new_items integer NOT NULL DEFAULT 0,
 demand_items integer NOT NULL DEFAULT 0,
 search_credits integer NOT NULL DEFAULT 0,
 ai_input_tokens integer NOT NULL DEFAULT 0,
 ai_output_tokens integer NOT NULL DEFAULT 0,
 errors jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE TABLE IF NOT EXISTS public.lead_radar_items(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 url text NOT NULL,
 url_key text NOT NULL UNIQUE,
 title text NOT NULL DEFAULT '',
 snippet text NOT NULL DEFAULT '',
 platform text NOT NULL DEFAULT 'web',
 query text NOT NULL DEFAULT '',
 run_id uuid REFERENCES public.lead_radar_runs(id) ON DELETE SET NULL,
 found_at timestamptz NOT NULL DEFAULT now(),
 published_hint text,
 date_verified boolean NOT NULL DEFAULT false,
 label text NOT NULL DEFAULT 'pending' CHECK(label IN ('pending','demand','ad','irrelevant','out_of_area')),
 score integer CHECK(score BETWEEN 0 AND 100),
 confidence numeric(3,2) CHECK(confidence BETWEEN 0 AND 1),
 service text CHECK(service IN ('full_house','kitchen','wardrobe','bathroom','aluminium','other')),
 area text,
 lang text,
 keywords text[] NOT NULL DEFAULT '{}',
 reason text,
 suggested_reply text,
 invites_contact boolean NOT NULL DEFAULT false,
 posted_contact text,
 status text NOT NULL DEFAULT 'new' CHECK(status IN ('new','replied','contacted','invalid','won')),
 handled_by uuid REFERENCES public.profiles(id),
 handled_by_name text, -- staff cannot read colleagues' profiles, so the name is copied here
 handled_at timestamptz,
 note text CHECK(length(note)<=500),
 analyzed_at timestamptz,
 model text,
 -- A number from a post is kept only when the poster asked contractors to contact them.
 CONSTRAINT lead_radar_contact_needs_invite CHECK(posted_contact IS NULL OR invites_contact)
);
CREATE INDEX IF NOT EXISTS lead_radar_items_feed_idx ON public.lead_radar_items(label,status,score DESC,found_at DESC);

ALTER TABLE public.lead_radar_queries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_radar_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_radar_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lead_radar_queries,public.lead_radar_runs,public.lead_radar_items FROM anon,authenticated;
GRANT SELECT ON public.lead_radar_queries,public.lead_radar_runs,public.lead_radar_items TO authenticated;
GRANT INSERT,UPDATE,DELETE ON public.lead_radar_queries TO authenticated;
DROP POLICY IF EXISTS radar_queries_read ON public.lead_radar_queries;
CREATE POLICY radar_queries_read ON public.lead_radar_queries FOR SELECT TO authenticated USING(public._radar_level()>=1);
DROP POLICY IF EXISTS radar_queries_manage ON public.lead_radar_queries;
CREATE POLICY radar_queries_manage ON public.lead_radar_queries FOR ALL TO authenticated USING(public._radar_level()>=4) WITH CHECK(public._radar_level()>=4);
DROP POLICY IF EXISTS radar_runs_read ON public.lead_radar_runs;
CREATE POLICY radar_runs_read ON public.lead_radar_runs FOR SELECT TO authenticated USING(public._radar_level()>=1);
DROP POLICY IF EXISTS radar_items_read ON public.lead_radar_items;
CREATE POLICY radar_items_read ON public.lead_radar_items FOR SELECT TO authenticated USING(public._radar_level()>=1);

CREATE OR REPLACE FUNCTION public.lead_radar_mark(p_item uuid,p_status text,p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE i lead_radar_items%ROWTYPE;
BEGIN
 IF public._radar_level()<1 THEN RAISE EXCEPTION '请使用员工账号登录'; END IF;
 IF p_status IS NULL OR p_status NOT IN ('new','replied','contacted','invalid','won') THEN RAISE EXCEPTION '处理状态无效'; END IF;
 IF length(coalesce(p_note,''))>500 THEN RAISE EXCEPTION '备注最多500字'; END IF;
 SELECT * INTO i FROM lead_radar_items WHERE id=p_item FOR UPDATE;
 IF i.id IS NULL THEN RAISE EXCEPTION '找不到这条需求'; END IF;
 -- Using a number the poster left is allowed once, and only when they invited contractors to call.
 IF p_status='contacted' AND (NOT i.invites_contact OR i.posted_contact IS NULL) THEN RAISE EXCEPTION '这条帖子没有邀请承包商联系，请到原帖回复'; END IF;
 IF p_status='contacted' AND i.status IN ('contacted','won') THEN RAISE EXCEPTION '已经联系过这位客户，请勿重复联系'; END IF;
 UPDATE lead_radar_items SET status=p_status,handled_by=CASE WHEN p_status='new' THEN NULL ELSE auth.uid() END,
  handled_by_name=CASE WHEN p_status='new' THEN NULL ELSE (SELECT name FROM profiles WHERE id=auth.uid()) END,
  handled_at=CASE WHEN p_status='new' THEN NULL ELSE now() END,note=coalesce(nullif(trim(p_note),''),note)
  WHERE id=p_item RETURNING * INTO i;
 RETURN jsonb_build_object('id',i.id,'status',i.status,'handled_by',i.handled_by,'handled_by_name',i.handled_by_name,'handled_at',i.handled_at,'note',i.note);
END;$$;
REVOKE ALL ON FUNCTION public.lead_radar_mark(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.lead_radar_mark(uuid,text,text) TO authenticated;

-- Manual runs are limited to general managers and above.
CREATE OR REPLACE FUNCTION public.lead_radar_can_run()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT public._radar_level()>=4; $$;
REVOKE ALL ON FUNCTION public.lead_radar_can_run() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.lead_radar_can_run() TO authenticated;

-- Personal data minimisation: unconverted posts are removed after 90 days.
CREATE OR REPLACE FUNCTION public.lead_radar_purge()
RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 WITH gone AS (DELETE FROM lead_radar_items WHERE status<>'won' AND found_at<now()-interval '90 days' RETURNING 1)
 SELECT count(*)::integer FROM gone;
$$;
REVOKE ALL ON FUNCTION public.lead_radar_purge() FROM PUBLIC,anon,authenticated;

INSERT INTO public.lead_radar_queries(query,lang) VALUES
 ('looking for renovation contractor Johor Bahru','en'),
 ('recommend contractor JB house renovation','en'),
 ('kitchen cabinet contractor Johor Bahru recommend','en'),
 ('built-in wardrobe JB recommend','en'),
 ('just got keys condo JB renovation','en'),
 ('bathroom renovation JB contractor recommend','en'),
 ('interior designer Johor Bahru recommend','en'),
 ('aluminium kitchen cabinet JB','en'),
 ('renovate JB house from Singapore','en'),
 ('Iskandar Puteri renovation contractor','en'),
 ('新山 装修 推荐','zh'),
 ('新山 橱柜 推荐 师傅','zh'),
 ('新山 收楼 装修','zh'),
 ('新山 衣柜 定做 推荐','zh'),
 ('新山 装修公司 求推荐','zh'),
 ('cari kontraktor renovate rumah Johor Bahru','ms'),
 ('kontraktor kabinet dapur JB','ms'),
 ('nak renovate rumah baru JB','ms'),
 ('recommend kontraktor Johor Bahru','ms'),
 ('ubah suai rumah Johor Bahru','ms')
ON CONFLICT(query) DO NOTHING;
NOTIFY pgrst,'reload schema';
COMMIT;
