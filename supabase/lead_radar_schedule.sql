-- Daily lead radar run at 07:00 Malaysia time (23:00 UTC the day before).
-- Run AFTER lead_radar_migration.sql and after deploying the lead-radar Edge Function.
-- Before running: replace PASTE_THE_SAME_SECRET_AS_RADAR_CRON_SECRET below with the value you
-- set as the function secret RADAR_CRON_SECRET. Do not commit the real value. Re-runnable.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM vault.secrets WHERE name='lead_radar_cron_secret') THEN
  PERFORM vault.update_secret((SELECT id FROM vault.secrets WHERE name='lead_radar_cron_secret'),'PASTE_THE_SAME_SECRET_AS_RADAR_CRON_SECRET');
 ELSE
  PERFORM vault.create_secret('PASTE_THE_SAME_SECRET_AS_RADAR_CRON_SECRET','lead_radar_cron_secret');
 END IF;
 IF EXISTS(SELECT 1 FROM cron.job WHERE jobname='lead-radar-daily') THEN PERFORM cron.unschedule('lead-radar-daily'); END IF;
END $$;
SELECT cron.schedule('lead-radar-daily','0 23 * * *',$job$
 SELECT net.http_post(
  url:='https://csabbxiijzghooppayae.supabase.co/functions/v1/lead-radar',
  headers:=jsonb_build_object('Content-Type','application/json','x-radar-secret',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='lead_radar_cron_secret')),
  body:='{}'::jsonb,
  timeout_milliseconds:=300000);
$job$);
-- Check: SELECT jobname,schedule,active FROM cron.job WHERE jobname='lead-radar-daily';
-- Stop:  SELECT cron.unschedule('lead-radar-daily');
