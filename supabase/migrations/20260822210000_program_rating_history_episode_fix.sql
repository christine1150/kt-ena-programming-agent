-- 사용자 지시(2026-08-22): "본방송 시청률 추이 그래프 하단에 회차를 반드시 적어달라" — 실측
-- 확인 결과 get_program_rating_history가 ratings.episode_number를 그대로 읽고 있었는데, 이
-- 컬럼은 OLIFE EPG(일일운행표) 매칭으로만 채워지는 값이라(CLAUDE.md 기록) ENA류(예: 나는SOLO)
-- 는 전부 NULL이었다 — 회차 번호가 필요한 프로그램은 이미 다른 경로(get_episode_number,
-- program_episode_counters seed 기반)로 계산하고 있으므로 그 로직을 그대로 재사용해 채운다.
-- ratings.episode_number가 있으면(OLIFE) 그 값을 우선하고, 없으면 seed 기반으로 계산한다.
create or replace function get_program_rating_history(
  p_canonical_name text,
  p_expected_start_time time,
  p_as_of_date date,
  p_window_days int default 84
)
returns table (
  channel_code text,
  broadcast_date date,
  episode_number int,
  target_label text,
  rating numeric
)
language sql
stable
as $$
  select
    c.code,
    r.broadcast_date,
    coalesce(
      r.episode_number,
      case
        when pec.seed_episode_number is not null and r.broadcast_date >= pec.seed_broadcast_date then
          pec.seed_episode_number + (
            select count(distinct r2.broadcast_date)
            from ratings r2
            join programs p2 on p2.id = r2.program_id
            where r2.source_type = 'nielsen_daily' and r2.program_id is not null
              and r2.broadcast_date > pec.seed_broadcast_date and r2.broadcast_date <= r.broadcast_date
              and replace(p2.canonical_name, ' ', '') = replace(pec.canonical_name, ' ', '')
          )::int
        else null
      end
    ) as episode_number,
    t.label,
    r.rating
  from ratings r
  join channels c on c.id = r.channel_id
  join programs p on p.id = r.program_id
  join targets t on t.id = r.target_id
  left join program_episode_counters pec on replace(pec.canonical_name, ' ', '') = replace(p.canonical_name, ' ', '')
  where replace(p.canonical_name, ' ', '') = replace(p_canonical_name, ' ', '')
    and r.source_type = 'nielsen_daily'
    and r.rating is not null
    and r.broadcast_date between (p_as_of_date - p_window_days) and p_as_of_date
    and r.start_time between (p_expected_start_time - interval '10 minutes') and (p_expected_start_time + interval '10 minutes')
    and t.label in ('수도권 2049', '전국 유료가구')
  order by c.code, r.broadcast_date;
$$;
comment on function get_program_rating_history is '주요 콘텐츠 리뷰(Page 1) 본방송 시청률 추이 꺾은선 그래프용 — 프로그램명(공백 무시)+본방 시간(±10분) 기준으로 채널 구분 없이 시계열을 반환. episode_number는 ratings.episode_number(OLIFE EPG 매칭)를 우선하고 없으면 program_episode_counters seed 기반으로 계산(get_episode_number과 동일 로직).';
