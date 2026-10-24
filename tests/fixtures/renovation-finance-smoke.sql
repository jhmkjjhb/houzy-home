BEGIN;
DO $$
DECLARE m record;store uuid;pid uuid:=gen_random_uuid();token uuid:=gen_random_uuid();entry uuid:=gen_random_uuid();refund uuid:=gen_random_uuid();v jsonb;r jsonb;payload jsonb;
BEGIN
 SELECT id,store_id INTO m FROM profiles WHERE active=true AND role IN ('store_manager','regional_manager','general_manager','admin','superadmin') ORDER BY CASE WHEN role='store_manager' AND store_id IS NOT NULL THEN 0 ELSE 1 END LIMIT 1;
 IF m.id IS NULL THEN RAISE EXCEPTION 'No active manager available for isolated rollback check'; END IF;
 store:=m.store_id;IF store IS NULL THEN SELECT id INTO store FROM stores WHERE active=true LIMIT 1; END IF;
 INSERT INTO renovation_projects(id,store_id,created_by,contract_no,customer_name,customer_phone,address,state,customer_token,snapshot)
 VALUES(pid,store,m.id,'FINANCE-SMOKE-'||pid,'Synthetic rollback check','999000000000','Synthetic only','confirmed',token,jsonb_build_object('net',1000,'payments',jsonb_build_array(jsonb_build_object('name','Plan not paid','amount',1000))));
 PERFORM set_config('request.jwt.claim.sub',m.id::text,true);PERFORM set_config('role','authenticated',true);
 v:=renovation_payment_view(pid);IF (v#>>'{summary,paid}')::numeric<>0 OR v#>>'{summary,status}'<>'no_records' THEN RAISE EXCEPTION 'Contract plan incorrectly counted as paid'; END IF;
 payload:=jsonb_build_object('kind','receipt','amount',100,'method','bank_transfer','paid_on',(now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date,'reference','SYNTHETIC-RECEIPT','note','Internal test only');
 r:=renovation_payment_command(pid,0,'add',entry,payload);r:=renovation_payment_command(pid,0,'add',entry,payload);
 v:=renovation_payment_view(pid);IF jsonb_array_length(v->'entries')<>1 OR (v#>>'{summary,paid}')::numeric<>100 OR (v#>>'{summary,balance}')::numeric<>900 THEN RAISE EXCEPTION 'Receipt/retry balance failed'; END IF;
 r:=renovation_payment_command(pid,1,'add',refund,jsonb_build_object('kind','refund','amount',20,'method','bank_transfer','paid_on',(now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date,'reference','SYNTHETIC-REFUND'));
 PERFORM set_config('role','anon',true);PERFORM set_config('request.jwt.claim.sub','',true);
 v:=renovation_customer_payment_view(token);
 IF (v#>>'{summary,paid}')::numeric<>80 OR (v#>>'{summary,balance}')::numeric<>920 OR jsonb_array_length(v->'entries')<>2 THEN RAISE EXCEPTION 'Customer/staff balance mismatch'; END IF;
 IF v::text LIKE '%Internal test only%' OR v::text LIKE '%SYNTHETIC-RECEIPT%' OR v::text LIKE '%created_by%' THEN RAISE EXCEPTION 'Customer internal-data leak'; END IF;
 IF renovation_customer_payment_view(gen_random_uuid()) IS NOT NULL THEN RAISE EXCEPTION 'Invalid token allowed'; END IF;
 BEGIN
  PERFORM * FROM renovation_payments;
  RAISE EXCEPTION 'Anonymous ledger read allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 PERFORM set_config('role','none',true);
END;$$;
ROLLBACK;
SELECT 'PASS: production receipt, refund, idempotency, customer balance, private notes, anonymous table access; all fixture writes rolled back' AS result;
