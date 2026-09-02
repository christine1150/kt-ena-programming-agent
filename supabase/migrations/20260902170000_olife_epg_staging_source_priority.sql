-- 사용자 지시(2026-09-02): "앞으로도 EPG 올리는 곳에 편성표가 올라가면 닐슨 데이터와 비교해서
-- 활용해주세요... EPG가 있으면 EPG를 1순위로 사용해주시고, 없으면 편성표에 있는 부제를
-- 활용해주시기 바랍니다." — "일일운행표"(EPG, 행 1개=방영 1건)와 "주간 편성표"(2D 달력 그리드,
-- 새 파서 src/lib/olifeWeeklySchedule.ts)를 같은 olife_epg_staging에 담되, 출처를 구분해
-- 날짜별로 EPG가 있으면 EPG만, 없으면 편성표만 쓰도록 우선순위를 둔다.
alter table olife_epg_staging
  add column if not exists source text not null default 'daily_epg'
    check (source in ('daily_epg', 'weekly_schedule'));
comment on column olife_epg_staging.source is '이 행의 출처 — daily_epg(일일운행표, 실제 방영 확정 정보)가 weekly_schedule(주간 편성표, 사전 편성 계획)보다 우선한다. applyOlifeEpgForDate가 날짜별로 daily_epg 행이 하나라도 있으면 그 날짜는 daily_epg만 쓰고, weekly_schedule은 daily_epg가 전혀 없는 날짜에만 폴백으로 쓴다.';

-- 기존 유니크 제약(broadcast_date, start_time, program_name_raw)에 source를 포함시켜, 같은
-- 시각·같은 프로그램이 두 출처(EPG/편성표) 모두에 있어도 서로 덮어쓰지 않고 공존하게 한다.
-- 자동 생성된 제약 이름이 컬럼명 길이 때문에 예측과 다를 수 있어(실측 확인:
-- "..._program_name_ra_key") 이름을 하드코딩하지 않고 pg_constraint에서 찾아 지운다.
do $$
declare c_name text;
begin
  select conname into c_name from pg_constraint
    where conrelid = 'olife_epg_staging'::regclass and contype = 'u';
  if c_name is not null then
    execute format('alter table olife_epg_staging drop constraint %I', c_name);
  end if;
end $$;
alter table olife_epg_staging add constraint olife_epg_staging_date_time_name_source_key
  unique (broadcast_date, start_time, program_name_raw, source);
