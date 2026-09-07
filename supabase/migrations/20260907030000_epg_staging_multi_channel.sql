-- 사용자 지시(2026-09-07): "네이버 메일 EPG 등록이 OLIFE로만 되어있는데... ENA, ENA Play,
-- ENA Drama, ENA Story, OLIFE, ONCE 모두 지원하도록" — olife_epg_staging이 지금까지 OLIFE
-- 전용으로만 쓰여 channel_id 컬럼 자체가 없었다(날짜+시작시각+프로그램명+출처만으로 구분).
-- 여러 채널의 EPG를 같은 날짜에 동시에 저장하면 채널 구분이 없어 서로 다른 채널의 방영분이
-- 뒤섞여 매칭될 위험이 있다 — channel_id를 추가하고 유니크 제약에도 포함시킨다.
alter table olife_epg_staging add column if not exists channel_id uuid references channels(id);

-- 기존 데이터는 전부 OLIFE 전용으로 쌓인 것이므로 그대로 OLIFE로 백필한다.
update olife_epg_staging
set channel_id = (select id from channels where code = 'OLIFE')
where channel_id is null;

alter table olife_epg_staging alter column channel_id set not null;

alter table olife_epg_staging drop constraint if exists olife_epg_staging_date_time_name_source_key;

-- add constraint에는 if not exists가 없어 DO 블록으로 감싼다 — 이 마이그레이션은 배포 전
-- Supabase Management API로 먼저 직접 실행해 검증한 뒤 db push로 이력에 기록하는 이번
-- 세션의 관례를 따르므로, db push 시점에 제약이 이미 존재해도 안전하게 재실행된다.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'olife_epg_staging'::regclass
      and conname = 'olife_epg_staging_date_channel_time_name_source_key'
  ) then
    alter table olife_epg_staging add constraint olife_epg_staging_date_channel_time_name_source_key
      unique (broadcast_date, channel_id, start_time, program_name_raw, source);
  end if;
end $$;
