BEGIN;
DO $$
DECLARE m record;store uuid;pid uuid:=gen_random_uuid();token uuid:=gen_random_uuid();first_entry uuid:=gen_random_uuid();second_entry uuid:=gen_random_uuid();legacy_entry uuid:=gen_random_uuid();v jsonb;r jsonb;payload jsonb;
BEGIN
 SELECT id,store_id INTO m FROM profiles WHERE active=true AND role IN ('store_manager','regional_manager','general_manager','admin','superadmin') ORDER BY CASE WHEN role='store_manager' AND store_id IS NOT NULL THEN 0 ELSE 1 END LIMIT 1;
 IF m.id IS NULL THEN RAISE EXCEPTION 'No active manager for rollback check'; END IF;
 store:=m.store_id;IF store IS NULL THEN SELECT id INTO store FROM stores WHERE active=true LIMIT 1; END IF;
 INSERT INTO renovation_projects(id,store_id,created_by,contract_no,customer_name,customer_phone,address,state,customer_token,snapshot)
 VALUES(pid,store,m.id,'INSTALMENT-SMOKE-'||pid,'Synthetic rollback check','999000000000','Synthetic only','confirmed',token,
 jsonb_build_object('net',171000,'payments',jsonb_build_array(jsonb_build_object('name','Deposit','amount',42750),jsonb_build_object('name','Electrical inspection','amount',68400),jsonb_build_object('name','Tile inspection','amount',51300),jsonb_build_object('name','Handover','amount',8550))));
 PERFORM set_config('request.jwt.claim.sub',m.id::text,true);PERFORM set_config('role','authenticated',true);
 payload:=jsonb_build_object('kind','receipt','amount',30000,'installment',2,'method','bank_transfer','paid_on',(now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date,'reference','SYNTHETIC-INSTALMENT-A');
 r:=renovation_payment_command(pid,0,'add',first_entry,payload);r:=renovation_payment_command(pid,0,'add',first_entry,payload);
 v:=renovation_payment_view(pid);
 IF (v#>>'{installments,1,paid}')::numeric<>30000 OR (v#>>'{installments,1,balance}')::numeric<>38400 OR (v#>>'{installments,1,percentage}')::numeric<>40 OR jsonb_array_length(v->'entries')<>1 THEN RAISE EXCEPTION 'First split or idempotency failed'; END IF;
 r:=renovation_payment_command(pid,1,'add',second_entry,payload||jsonb_build_object('amount',38400,'reference','SYNTHETIC-INSTALMENT-B'));
 v:=renovation_payment_view(pid);
 IF (v#>>'{installments,1,paid}')::numeric<>68400 OR (v#>>'{installments,1,balance}')::numeric<>0 OR jsonb_array_length(v->'entries')<>2 THEN RAISE EXCEPTION 'Second split failed'; END IF;
 BEGIN
  PERFORM renovation_payment_command(pid,2,'add',gen_random_uuid(),payload||jsonb_build_object('amount',1,'reference','SYNTHETIC-INSTALMENT-OVER'));
  RAISE EXCEPTION 'Instalment overpayment incorrectly allowed';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%该期收款超过%' THEN RAISE; END IF;
 END;
 r:=renovation_payment_command(pid,2,'add',legacy_entry,(payload-'installment')||jsonb_build_object('amount',500,'reference','SYNTHETIC-INSTALMENT-LEGACY'));
 r:=renovation_payment_command(pid,3,'assign',legacy_entry,jsonb_build_object('installment',3,'reason','Match incoming transfer slip'));
 PERFORM set_config('role','anon',true);PERFORM set_config('request.jwt.claim.sub','',true);
 v:=renovation_customer_payment_view(token);
 IF (v#>>'{summary,paid}')::numeric<>68900 OR (v#>>'{installments,1,balance}')::numeric<>0 OR (v#>>'{installments,2,paid}')::numeric<>500 OR jsonb_array_length(v->'entries')<>3 THEN RAISE EXCEPTION 'Customer allocation sync failed'; END IF;
 IF v::text LIKE '%SYNTHETIC-INSTALMENT%' OR v::text LIKE '%Match incoming transfer slip%' THEN RAISE EXCEPTION 'Private transfer details leaked'; END IF;
 PERFORM set_config('role','none',true);
END;$$;
ROLLBACK;
SELECT 'PASS: period percentages, 30000+38400 split, duplicate retry, overpayment rejection, staff allocation and customer sync; all fixture writes rolled back' AS result;
