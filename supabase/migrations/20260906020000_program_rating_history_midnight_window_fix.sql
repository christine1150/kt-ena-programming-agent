-- 자체 발견 버그 수정(2026-09-06) — 회차별 추이(get_program_rating_history)가 자정
-- 근처 시각(예: 짐쌀라비움 ENA Play 직재방 23:59)에서 항상 빈 결과를 내던 문제.
--
-- 기존 시간창 필터는 단순 BETWEEN이었다:
--   r.start_time between (p_expected_start_time - interval '10 minutes')
--                     and (p_expected_start_time + interval '10 minutes')
-- p_expected_start_time이 23:59:55이면 time 타입의 모듈로 연산으로
-- lo=23:49:55, hi=00:09:55가 되는데, BETWEEN은 lo<=hi를 전제하므로 lo>hi인 이
-- 구간은 무조건 거짓이 되어 실제로 그 시간대에 데이터가 있어도 0건이 나온다
-- (직접 SQL로 재현 확인: `(time '23:59:55'-10분) <= (time '23:59:55'+10분)` = false).
--
-- get_original_content_daily/get_original_content_weekly_review는 처음부터 자정을
-- 넘나드는 이런 경우를 위해 원형 거리(circular distance, least(절대차, 86400-절대차))
-- 방식을 쓰고 있었다 — 이 함수만 안 그랬다. 같은 방식으로 통일한다(반환 타입·컬럼
-- 변경 없음, 순수 버그 수정이라 이 함수를 쓰는 모든 화면에 안전하게 적용됨).
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
  with day_map(label, iso) as (
    values ('월',1),('화',2),('수',3),('목',4),('금',5),('토',6),('일',7)
  ),
  home as (
    select distinct p2.channel_id, fc.broadcast_time, dm.iso as dow_iso
    from featured_content fc
    join programs p2 on p2.id = fc.program_id
    join lateral unnest(fc.broadcast_day_of_week) as wd(label) on true
    join day_map dm on dm.label = wd.label
    where replace(p2.canonical_name, ' ', '') = replace(p_canonical_name, ' ', '')
      and fc.broadcast_time is not null
  )
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
              and (
                not exists (select 1 from home)
                or exists (
                  select 1 from home h
                  where h.channel_id = r2.channel_id
                    and h.dow_iso = extract(isodow from r2.broadcast_date)::int
                    and least(
                          abs(extract(epoch from (r2.start_time - h.broadcast_time))),
                          86400 - abs(extract(epoch from (r2.start_time - h.broadcast_time)))
                        ) <= 600
                )
              )
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
    and least(
          abs(extract(epoch from (r.start_time - p_expected_start_time))),
          86400 - abs(extract(epoch from (r.start_time - p_expected_start_time)))
        ) <= 600 -- ±10분(자정 넘나드는 시각도 원형 거리로 정확히 처리)
    and t.label in ('수도권 2049', '전국 유료가구')
  order by c.code, r.broadcast_date;
$$;
