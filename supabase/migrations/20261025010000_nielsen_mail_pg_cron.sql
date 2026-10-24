-- 닐슨 일일 메일 아침 확인을 DB 안 스케줄러(pg_cron + pg_net)로 옮긴다(2026-10-25 사용자 승인).
-- 이유: Vercel 크론은 시각이 '7시대 어느 때'로만 지켜지고, 감시 크론이 자기 자신을 이어 붙이는 방식은
--   Vercel 재귀 호출 제한(HTTP 508, 약 5회)에 막혀 07:29 시작 기준 07:48에 끊겼다(10/24·10/25 메일 지연).
-- 방식: KST 07:35~08:55 사이 5분마다 기존 /api/cron/fetch-nielsen-mail 을 호출한다. 호출끼리 이어 붙지 않는다.
--   같은 메일을 여러 번 읽어도 mail_ingestion_log(message_id)로 중복 적재되지 않는다.
-- 인증: 호출에 쓰는 CRON_SECRET 은 Supabase Vault(이름 cron_secret)에만 두며 이 파일에는 값이 없다.
-- pg_cron 은 UTC 기준: 22:35~22:55 = KST 07:35~07:55, 23:00~23:55 = KST 08:00~08:55.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create or replace function public.call_nielsen_mail_fetch()
returns bigint
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  secret text;
  req_id bigint;
begin
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'cron_secret' limit 1;
  if secret is null then
    raise warning 'cron_secret 이 Vault 에 없어 닐슨 메일 확인을 건너뜁니다';
    return null;
  end if;
  select net.http_get(
    url := 'https://kt-ena-programming-agent.vercel.app/api/cron/fetch-nielsen-mail',
    headers := jsonb_build_object('Authorization', 'Bearer ' || secret),
    timeout_milliseconds := 120000
  ) into req_id;
  return req_id;
end;
$$;

revoke all on function public.call_nielsen_mail_fetch() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule(jobname) from cron.job where jobname in ('nielsen-mail-kst0735-0755', 'nielsen-mail-kst0800-0855');
end $$;

select cron.schedule('nielsen-mail-kst0735-0755', '35-55/5 22 * * *', $$select public.call_nielsen_mail_fetch()$$);
select cron.schedule('nielsen-mail-kst0800-0855', '0-55/5 23 * * *', $$select public.call_nielsen_mail_fetch()$$);
