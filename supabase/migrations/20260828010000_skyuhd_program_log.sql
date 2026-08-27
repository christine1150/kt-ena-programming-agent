-- Audience Intelligence Report Phase 1(2026-08-28, 계획서 J절 7번) — skyUHD 수기 업로드 프로그램
-- 로그 조회. skyUHD의 프로그램 단위(program_id is not null) 행은 target_id가 NULL이다(실측 확인,
-- 2026-08-27) — get_channel_daily_rating_trend 등 기존 RPC는 전부 `join targets t on t.id =
-- r.target_id`를 쓰기 때문에 skyUHD 프로그램 행이 전부 걸러진다. 타깃 조인 없이 channel_id +
-- program_id is not null만으로 조회하는 별도 함수가 필요하다.
--
-- get_channel_daily_rating_trend와 동일한 스타일(단일 SELECT, language sql, plpgsql 아님) —
-- RETURNS TABLE 컬럼명과 CTE 컬럼이 겹쳐 "ambiguous"가 나는 이 프로젝트의 반복된 실수를
-- 원천적으로 피한다.
create or replace function get_skyuhd_program_log(
  p_date_from date,
  p_date_to date
)
returns table (
  broadcast_date date,
  start_time time,
  canonical_name text,
  rating numeric
)
language sql
stable
as $$
  select
    r.broadcast_date,
    r.start_time,
    p.canonical_name,
    r.rating
  from ratings r
  join channels c on c.id = r.channel_id
  join programs p on p.id = r.program_id
  where c.code = 'SKYUHD'
    and r.program_id is not null
    and r.broadcast_date between p_date_from and p_date_to
  order by r.broadcast_date, r.start_time;
$$;
comment on function get_skyuhd_program_log is 'Audience Intelligence Report skyUHD 전용 — 수기 업로드 프로그램 단위 로그(target_id 없음이라 타깃 조인 불가, channel_id+program_id is not null만으로 조회). 편성일자·시작시각·프로그램명·시청률 4개 필드만 존재(순위·Share·Reach·시청시간은 이 소스에 없음).';
