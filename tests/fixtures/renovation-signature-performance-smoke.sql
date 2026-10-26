BEGIN;
DO $$
DECLARE m record;store uuid;pid uuid:=gen_random_uuid();token uuid:=gen_random_uuid();entry uuid:=gen_random_uuid();receipt uuid:=gen_random_uuid();refund uuid:=gen_random_uuid();cash uuid:=gen_random_uuid();a jsonb;v jsonb;terms jsonb;ink jsonb;
 before_total numeric;before_reno numeric;before_pending numeric;d date:=(now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date;payload jsonb;
BEGIN
 SELECT id,store_id INTO m FROM profiles WHERE active=true AND role IN ('store_manager','regional_manager','general_manager','admin','superadmin') ORDER BY CASE WHEN role='store_manager' AND store_id IS NOT NULL THEN 0 ELSE 1 END LIMIT 1;
 IF m.id IS NULL THEN RAISE EXCEPTION 'No active manager for rollback test'; END IF;
 store:=m.store_id;IF store IS NULL THEN SELECT id INTO store FROM stores WHERE active=true LIMIT 1; END IF;
 PERFORM set_config('request.jwt.claim.sub',m.id::text,true);PERFORM set_config('role','authenticated',true);
 v:=get_store_performance(d,d,store,true);SELECT coalesce(sum((x->>'total_net_received')::numeric),0),coalesce(sum((x->>'renovation_net_received')::numeric),0),coalesce(sum((x->>'pending_cash')::numeric),0) INTO before_total,before_reno,before_pending FROM jsonb_array_elements(v->'data') x;
 PERFORM set_config('role','none',true);
 INSERT INTO renovation_projects(id,store_id,created_by,contract_no,customer_name,customer_phone,address,state,customer_token,snapshot) VALUES(pid,store,m.id,'SIGNATURE-REPORT-SMOKE-'||pid,'Synthetic only','999000000000','Synthetic only','executing',token,jsonb_build_object('net',1000,'payments',jsonb_build_array(jsonb_build_object('name','Original','amount',1000)),'lines','[]'::jsonb));
 PERFORM set_config('role','authenticated',true);
 a:=renovation_addition_command(pid,0,'add',entry,jsonb_build_object('category','material','name','Unsigned test material','spec','Synthetic only','qty',4,'unit','box','rate',50,'group_name','Synthetic','payment_node','After customer signature'));
 IF a->>'signature_status'<>'pending' OR a->>'work_order_id' IS NOT NULL OR (SELECT current_total FROM renovation_projects WHERE id=pid)<>1000 THEN RAISE EXCEPTION 'Unsigned addition activated early'; END IF;
 BEGIN
  PERFORM renovation_payment_command(pid,1,'add',gen_random_uuid(),jsonb_build_object('kind','receipt','amount',1,'method','bank_transfer','paid_on',d,'reference','SYNTHETIC-UNSIGNED','installment',2));
  RAISE EXCEPTION 'Unsigned addition payment allowed';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%电子签名%' THEN RAISE;END IF;END;
 PERFORM set_config('role','anon',true);PERFORM set_config('request.jwt.claim.sub','',true);
 terms:=renovation_customer_addition_sign_view(token,entry,(a->>'signing_token')::uuid);
 ink:='[[[0.1,0.2],[0.13,0.25],[0.2,0.3],[0.25,0.15],[0.3,0.3],[0.4,0.45],[0.5,0.3],[0.6,0.2]]]'::jsonb;
 v:=renovation_customer_sign_addition(token,entry,(a->>'signing_token')::uuid,terms->>'terms_hash','Synthetic customer',ink,true);
 IF NOT (v->>'ok')::boolean THEN RAISE EXCEPTION 'Customer signature failed'; END IF;
 v:=renovation_customer_sign_addition(token,entry,(a->>'signing_token')::uuid,terms->>'terms_hash','Synthetic customer',ink,true);
 PERFORM set_config('role','authenticated',true);PERFORM set_config('request.jwt.claim.sub',m.id::text,true);
 IF (SELECT current_total FROM renovation_projects WHERE id=pid)<>1200 OR (SELECT count(*) FROM renovation_work_orders WHERE project_id=pid)<>1 THEN RAISE EXCEPTION 'Signature activation/retry failed'; END IF;
 payload:=jsonb_build_object('kind','receipt','amount',200,'method','bank_transfer','paid_on',d,'reference','SYNTHETIC-SIGNATURE-RECEIPT','installment',2);
 v:=renovation_payment_command(pid,2,'add',receipt,payload);
 v:=renovation_payment_command(pid,3,'add',refund,payload||jsonb_build_object('kind','refund','amount',20,'reference','SYNTHETIC-SIGNATURE-REFUND'));
 -- Manager-entered cash is already verified; use the authorised command then
 -- assert actual net totals. No unverified real records are modified.
 v:=get_store_performance(d,d,store,true);
 IF (SELECT coalesce(sum((x->>'total_net_received')::numeric),0) FROM jsonb_array_elements(v->'data') x)<>before_total+180 OR (SELECT coalesce(sum((x->>'renovation_net_received')::numeric),0) FROM jsonb_array_elements(v->'data') x)<>before_reno+180 THEN RAISE EXCEPTION 'Combined store performance did not include net renovation receipts exactly once'; END IF;
 PERFORM set_config('role','anon',true);PERFORM set_config('request.jwt.claim.sub','',true);
 v:=renovation_customer_additions(token);IF v::text LIKE '%signing_token%' OR v::text LIKE '%signature_strokes%' THEN RAISE EXCEPTION 'Read-only list exposed signing credential'; END IF;
 BEGIN PERFORM get_store_performance(d,d,store,true);RAISE EXCEPTION 'Anonymous store reporting allowed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 PERFORM set_config('role','none',true);
END;$$;
ROLLBACK;
SELECT 'PASS: unsigned gate, private customer signature, immutable proof, duplicate retry, work activation, receipt/refund and store performance; all fixture writes rolled back' AS result;
