-- OPTIONAL: execute only in the approved target database after deploying/testing the mail function.
-- Create these secrets in Supabase Vault first, without committing their values:
--   fabrication_project_url: https://<APPROVED-PROJECT-REF>.supabase.co
--   fabrication_cron_secret: same value as Edge FABRICATION_CRON_SECRET
--   fabrication_publishable_key: project publishable key (or legacy anon key)
-- The Edge gateway must use verify_jwt=false; the handler verifies the dedicated secret.
-- Never put a service_role key into this schedule or the frontend.
do $$
begin
  if not exists(select 1 from pg_extension where extname='pg_cron') or
     not exists(select 1 from pg_extension where extname='pg_net') then
    raise exception 'Enable pg_cron and pg_net in the approved project first';
  end if;
  if (select count(*) from vault.decrypted_secrets where name in
      ('fabrication_project_url','fabrication_cron_secret','fabrication_publishable_key')) <> 3 then
    raise exception 'Configure the three named fabrication secrets in Vault first';
  end if;
  perform cron.schedule('avh-fabrication-mail','*/5 * * * *', $job$
    select net.http_post(
      url := rtrim((select decrypted_secret from vault.decrypted_secrets where name='fabrication_project_url'),'/')
        || '/functions/v1/fabrication-report-mail',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'apikey',(select decrypted_secret from vault.decrypted_secrets where name='fabrication_publishable_key'),
        'x-fabrication-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='fabrication_cron_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 10000
    );
  $job$);
end $$;
