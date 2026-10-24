BEGIN;
DO $$
DECLARE m record;store uuid;pid uuid:=gen_random_uuid();token uuid:=gen_random_uuid();workid uuid:=gen_random_uuid();matid uuid:=gen_random_uuid();lateid uuid:=gen_random_uuid();receipt uuid:=gen_random_uuid();v jsonb;r jsonb;payload jsonb;original jsonb;
BEGIN
 SELECT id,store_id INTO m FROM profiles WHERE active=true AND role IN ('store_manager','regional_manager','general_manager','admin','superadmin') ORDER BY CASE WHEN role='store_manager' AND store_id IS NOT NULL THEN 0 ELSE 1 END LIMIT 1;
 IF m.id IS NULL THEN RAISE EXCEPTION 'No active manager for rollback check'; END IF;
 store:=m.store_id;IF store IS NULL THEN SELECT id INTO store FROM stores WHERE active=true LIMIT 1; END IF;
 original:=jsonb_build_object('net',1000,'discount',0,'payments',jsonb_build_array(jsonb_build_object('name','Deposit','amount',500),jsonb_build_object('name','Handover','amount',500)),'lines',jsonb_build_array(jsonb_build_object('id','BASE','name','Original scope','spec','Base','qty',1,'unit','lot','rate',1000,'kind','work','group','Base','warranties','[]'::jsonb)));
 INSERT INTO renovation_projects(id,store_id,created_by,contract_no,customer_name,customer_phone,address,state,customer_token,snapshot)
 VALUES(pid,store,m.id,'ADDITIONS-SMOKE-'||pid,'Synthetic rollback check','999000000000','Synthetic only','executing',token,original);
 PERFORM set_config('request.jwt.claim.sub',m.id::text,true);PERFORM set_config('role','authenticated',true);
 payload:=jsonb_build_object('category','work','name','Additional installation','spec','Synthetic only','qty',2,'unit','lot','rate',100,'group_name','Synthetic extra','payment_node','Addition confirmation');
 r:=renovation_addition_command(pid,0,'add',workid,payload);r:=renovation_addition_command(pid,0,'add',workid,payload);
 v:=renovation_addition_view(pid);IF (v->>'total')::numeric<>1200 OR (v->>'additions_total')::numeric<>200 OR jsonb_array_length(v->'entries')<>1 THEN RAISE EXCEPTION 'Addition total or retry failed'; END IF;
 r:=renovation_addition_command(pid,1,'add',matid,payload||jsonb_build_object('category','material','name','Additional material','qty',4,'rate',25));
 v:=renovation_addition_view(pid);IF (v->>'total')::numeric<>1300 OR jsonb_array_length(v->'lines')<>3 OR v#>>'{lines,2,kind}'<>'stock' THEN RAISE EXCEPTION 'Material total or scope failed'; END IF;
 r:=renovation_payment_command(pid,2,'add',receipt,jsonb_build_object('kind','receipt','amount',200,'installment',3,'method','bank_transfer','paid_on',(now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date,'reference','SYNTHETIC-ADDITION-RECEIPT'));
 v:=renovation_payment_view(pid);IF (v#>>'{summary,total}')::numeric<>1300 OR (v#>>'{summary,balance}')::numeric<>1100 OR (v#>>'{installments,0,percentage}')::numeric<>50 OR (v#>>'{installments,2,balance}')::numeric<>0 THEN RAISE EXCEPTION 'Addition/payment integration failed'; END IF;
 BEGIN
  PERFORM renovation_addition_command(pid,3,'void',workid,jsonb_build_object('reason','Paid addition cannot be voided'));
  RAISE EXCEPTION 'Paid addition incorrectly voided';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%有已收%' THEN RAISE; END IF;
 END;
 r:=renovation_addition_command(pid,3,'void',matid,jsonb_build_object('reason','Synthetic correction'));
 r:=renovation_addition_command(pid,4,'add',lateid,payload||jsonb_build_object('category','material','name','Replacement material','qty',1,'rate',50));
 IF (r->>'installment')::integer<>5 THEN RAISE EXCEPTION 'Voided node number reused'; END IF;
 IF (SELECT snapshot FROM renovation_projects WHERE id=pid)<>original THEN RAISE EXCEPTION 'Original signed snapshot modified'; END IF;
 IF (SELECT count(*) FROM renovation_work_orders WHERE project_id=pid)<>3 THEN RAISE EXCEPTION 'Added work orders missing or duplicated'; END IF;
 PERFORM set_config('role','anon',true);PERFORM set_config('request.jwt.claim.sub','',true);
 v:=renovation_customer_view(token);IF (v->>'net')::numeric<>1250 OR (v->>'original_net')::numeric<>1000 OR jsonb_array_length(v->'lines')<>3 OR (v->>'scope_revision')::integer<>4 THEN RAISE EXCEPTION 'Customer added scope or total failed'; END IF;
 v:=renovation_customer_payment_view(token);IF (v#>>'{summary,balance}')::numeric<>1050 OR (v->>'scope_revision')::integer<>4 THEN RAISE EXCEPTION 'Customer balance/scope sync failed'; END IF;
 BEGIN PERFORM * FROM renovation_additions;RAISE EXCEPTION 'Anonymous addition table access allowed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 PERFORM set_config('role','none',true);
END;$$;
ROLLBACK;
SELECT 'PASS: work and material additions, totals, signed snapshot, execution orders, billing nodes, receipts, void safeguards, customer sync and anonymous RLS; all fixture writes rolled back' AS result;
