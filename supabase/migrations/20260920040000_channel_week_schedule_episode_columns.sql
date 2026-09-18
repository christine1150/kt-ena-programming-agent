-- 사용자 지시(2026-09-20): "OLIFE는 네이버 메일함을 통해서나 직접 업로드를 통해서 회차와
-- 부제 정보를 획득할 수 있거나, 획득한 것들이 많아. 그것들도 편성표에 반영해줘." —
-- ratings.episode_number/episode_subtitle은 이미 OLIFE EPG(일일운행표) 매칭으로 채워지고
-- 있는 컬럼이다(2026-08-21 도입, 메일 자동 수집 + 수동 업로드 두 경로 모두 같은 컬럼을
-- 채움). DB 재구성 함수가 이 값을 함께 반환하도록 확장한다 — 새 매칭 로직이 아니라 이미
-- 있는 값을 그대로 노출하는 것뿐이다.
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
  rating numeric,
  episode_number int,
  episode_subtitle text
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
    r.rating,
    r.episode_number,
    r.episode_subtitle
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
comment on function get_channel_week_schedule is '관리자 "편성표 검토"/Page 2 "이번 주 실제 편성표 보기"의 DB 재구성 기본 데이터 — ratings의 실제 방영 구간(start_time~end_time)·시청률·program_id에 더해, EPG 매칭으로 이미 채워진 episode_number/episode_subtitle(현재 OLIFE)도 함께 반환한다. program_id는 업로드된 편성표의 matched_program_id와 대조해 회차·부제 정보를 덧붙이는 데 쓰인다(scheduleGridSource.ts).';
