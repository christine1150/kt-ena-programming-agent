-- 개발 단위 14번: Page 1 종합 대시보드용 SQL 함수.
-- 이달의 목표 달성 캘린더 히트맵(DESIGN.md Page1 ②)에 쓸 "그 달 매일의 달성률"을 계산한다.
-- 공식은 기존 get_target_achievement와 동일 (실제÷목표×100), 하루 단위로 반복 계산만 다르다.
create or replace function get_monthly_achievement_calendar(
  p_channel_code text,
  p_year int,
  p_month int
)
returns table (
  broadcast_date date,
  actual_rating numeric,
  target_rating numeric,
  achievement_pct numeric
)
language plpgsql
stable
as $$
declare
  v_channel_id uuid;
  v_primary_target text;
  v_target_id uuid;
  v_target_rating numeric;
  v_month_start date;
  v_month_end date;
begin
  select c.id, c.primary_target into v_channel_id, v_primary_target
  from channels c where c.code = p_channel_code;
  if v_channel_id is null then
    raise exception '알 수 없는 채널 코드: %', p_channel_code;
  end if;

  select tg.target_rating into v_target_rating
  from target_goals tg where tg.channel_id = v_channel_id and tg.year = p_year;

  select t.id into v_target_id from targets t where t.label = v_primary_target;
  if v_target_id is null then
    select t.id into v_target_id from targets t where t.label = replace(v_primary_target, '개인', '');
  end if;

  v_month_start := make_date(p_year, p_month, 1);
  v_month_end := (v_month_start + interval '1 month' - interval '1 day')::date;

  return query
  select
    r.broadcast_date,
    r.rating,
    v_target_rating,
    round((r.rating / nullif(v_target_rating, 0)) * 100, 1)
  from ratings r
  where r.channel_id = v_channel_id
    and r.target_id = v_target_id
    and r.source_type = 'nielsen_daily'
    and r.program_id is null
    and r.broadcast_date between v_month_start and v_month_end
  order by r.broadcast_date;
end;
$$;
comment on function get_monthly_achievement_calendar is '월간 목표 달성률 캘린더 — 그 달 매일의 실제 시청률·달성률(%). Page 1 히트맵용';
