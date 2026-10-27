-- Lead radar runs every 2 hours from 08:00 to 22:00 Malaysia time (00:00-14:00 UTC).
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
 IF EXISTS(SELECT 1 FROM cron.job WHERE jobname='lead-radar-classify') THEN PERFORM cron.unschedule('lead-radar-classify'); END IF;
END $$;
SELECT cron.schedule('lead-radar-daily','0 0-14/2 * * *',$job$
 SELECT net.http_post(
  url:='https://csabbxiijzghooppayae.supabase.co/functions/v1/lead-radar',
  headers:=jsonb_build_object('Content-Type','application/json','x-radar-secret',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='lead_radar_cron_secret')),
  body:='{}'::jsonb,
  timeout_milliseconds:=300000);
$job$);
-- Follow-up 20 minutes after each run: one run may not analyse every new post within the time limit; this only analyses what is left (no search credits).
SELECT cron.schedule('lead-radar-classify','20 0-14/2 * * *',$job$
 SELECT net.http_post(
  url:='https://csabbxiijzghooppayae.supabase.co/functions/v1/lead-radar',
  headers:=jsonb_build_object('Content-Type','application/json','x-radar-secret',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='lead_radar_cron_secret')),
  body:='{"mode":"classify"}'::jsonb,
  timeout_milliseconds:=300000);
$job$);
-- Check: SELECT jobname,schedule,active FROM cron.job WHERE jobname LIKE 'lead-radar%';
-- Stop:  SELECT cron.unschedule('lead-radar-daily'); SELECT cron.unschedule('lead-radar-classify');
