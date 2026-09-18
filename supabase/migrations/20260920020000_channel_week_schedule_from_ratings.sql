-- 사용자 지시(2026-09-20): "편성표를 올려주지 않더라도 DB에 있는 내용으로 편성표와 시간,
-- 시청률을 알고 있으니 직접 편성표를 그릴 수 있지 않니?" — 관리자 화면의 "편성표 검토"는
-- 지금까지 업로드된 program_schedule_grid가 있어야만 뭔가를 보여줬다. ratings 테이블에 이미
-- 프로그램별 실제 방영 구간(start_time~end_time)과 시청률이 있으므로, 업로드가 없어도 그
-- 데이터만으로 그 주의 편성표를 재구성할 수 있다. 다만 부제·회차·본방/재방 태그처럼 원본
-- 편성표 파일에만 있는 정보는 DB에 없으므로(programs.episode_number는 Nielsen 파일에서
-- 채워지지 않아 항상 null로 확인됨, 2026-09-20 실측) 업로드가 있으면 그쪽을 우선한다 — 이
-- 함수는 업로드가 없을 때의 폴백 재구성 전용이다.
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
comment on function get_channel_week_schedule is '관리자 "편성표 검토" 화면에서 업로드된 편성표가 없는 주차의 폴백 — ratings의 실제 방영 구간(start_time~end_time)과 시청률을 그대로 프로그램 단위 목록으로 반환한다(부제·회차 정보 없음, 값 추정 없음).';
