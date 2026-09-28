-- 실측 확인(2026-09-28): 90분 시간창으로 넓힌 직후 <니돈내산>(일 20:30) baseline이
-- sample_count=8로 나왔다 — 그 저녁대(19:50 <엑스 더 리그> + 21시대 다른 프로그램)에 주당
-- 두 프로그램이 창에 걸려 "최근 4주"인데도 행 수가 8이 됐다. 화면이 이 값을 "동시간대 최근
-- N주 평균"이라고 표시하므로 N은 "몇 주 표본인지"여야지 "몇 개 방영분을 평균냈는지"가 아니다
-- — count(*)를 count(distinct broadcast_date)로 바꿔 실제 주(일자) 수만 세도록 고친다
-- (avg_rating은 그대로 모든 방영분을 평균해 둔다 — 표본이 늘수록 더 안정적인 baseline).
create or replace function get_program_slot_recent_avg(
  p_channel_code text,
  p_target_label text,
  p_as_of_date date,
  p_start_time time,
  p_weeks int default 4
)
returns table (
  avg_rating numeric,
  sample_count int
)
language sql
stable
as $$
  select
    round(avg(r.rating)::numeric, 5) as avg_rating,
    count(distinct r.broadcast_date)::int as sample_count
  from ratings r
  join channels c on c.id = r.channel_id
  join targets t on t.id = r.target_id
  where c.code = p_channel_code and t.label = p_target_label
    and r.source_type in ('nielsen_daily', 'skyuhd') and r.program_id is not null
    and r.broadcast_date between (p_as_of_date - (p_weeks * 7)) and (p_as_of_date - 1)
    and r.rating is not null
    and r.start_time is not null
    and extract(isodow from r.broadcast_date) = extract(isodow from p_as_of_date)
    and abs(
      (case when extract(hour from r.start_time) < 2 then extract(epoch from r.start_time) + 24 * 3600 else extract(epoch from r.start_time) end)
      -
      (case when extract(hour from p_start_time) < 2 then extract(epoch from p_start_time) + 24 * 3600 else extract(epoch from p_start_time) end)
    ) <= 5400
$$;
comment on function get_program_slot_recent_avg is '프로그램 자체의 방영 이력이 없거나 부족할 때(예: 1회차 신규 편성) "최근 성적 대비"의 baseline으로 쓴다 — 같은 채널·같은 타깃·같은 요일에서 목표 시각과 90분 이내로 방영된(정시 경계로 가르지 않음) 최근 p_weeks주간의 평균 시청률(프로그램명 무관). sample_count는 방영분 행 수가 아니라 실제 주(방영일) 수.';
