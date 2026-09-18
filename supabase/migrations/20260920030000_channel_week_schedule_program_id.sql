-- 사용자 지시(2026-09-20): "기본적으로 DB 기반으로 구성하되, 업로드된 편성표가 매치되는
-- 회차나 부제가 있으면 그것만 덧붙이는 형태로 로직을 수정하자" — 정확한 시작~종료 시각·
-- 시청률은 항상 ratings 기반 DB 재구성에서 가져오고(빈틈 없음이 보장됨), 업로드 파일에 있는
-- 회차·부제·본방/재방 태그 표기는 그 방영 인스턴스가 실제로 매칭될 때만 덧붙인다.
-- program_schedule_grid.matched_program_id와 이 DB 재구성 행의 program_id가 같은지로
-- 매칭한다(이미 match_schedule_grid_ratings가 업로드 시점에 계산해 둔 값을 그대로 재사용 —
-- 새로 fuzzy 매칭을 만들지 않음). 그러려면 이 함수가 program_id를 함께 반환해야 한다.
drop function if exists get_channel_week_schedule(text, text, date);
create function get_channel_week_schedule(
  p_channel_code text,
  p_program_target_label text,
  p_week_start date
)
returns table (
  dow int,
  broadcast_date date,
  start_time time,
  end_time time,
  program_id uuid,
  canonical_name text,
  rating numeric
)
language sql
stable
as $$
  select distinct on (r.broadcast_date, r.start_time)
    extract(isodow from r.broadcast_date)::int as dow,
    r.broadcast_date,
    r.start_time,
    r.end_time,
    r.program_id,
    p.canonical_name,
    r.rating
  from ratings r
  join channels c on c.id = r.channel_id
  left join targets t on t.id = r.target_id
  join programs p on p.id = r.program_id
  where c.code = p_channel_code and (t.label = p_program_target_label or r.target_id is null)
    and r.source_type in ('nielsen_daily', 'skyuhd') and r.program_id is not null and r.start_time is not null
    and r.rating is not null
    and r.broadcast_date between p_week_start and (p_week_start + 6)
  order by r.broadcast_date, r.start_time, r.id;
$$;
comment on function get_channel_week_schedule is '관리자 "편성표 검토"/Page 2 "이번 주 실제 편성표 보기"의 DB 재구성 기본 데이터 — ratings의 실제 방영 구간(start_time~end_time)·시청률·program_id를 그대로 반환한다. program_id는 업로드된 편성표의 matched_program_id와 대조해 회차·부제 정보를 덧붙이는 데 쓰인다(scheduleGridSource.ts).';
