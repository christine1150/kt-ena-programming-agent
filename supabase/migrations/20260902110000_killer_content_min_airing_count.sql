-- 사용자 지시(2026-09-02): "1페이지 최하단 <채널별 킬러 컨텐츠>의 경우, 5회 미만으로 편성된
-- 컨텐츠는 목록에서 제외. 현재 1회 편성된 것도 상위에 올라와 있어서 혼동을 줄 수 있음"
-- 원인: get_channel_killer_content_daypart의 top_programs CTE가 최근 28일 창에서 avg_rating만
-- 보고 정렬해 top p_limit(3)개를 뽑았는데, 편성 횟수(airing_count)에 대한 최소 표본 기준이
-- 없었다 — 창 안에 1회만 편성됐는데 그 1회 시청률이 높으면 "킬러 콘텐츠" 상위에 올라왔다.
-- 이 프로젝트의 다른 "표본 부족" 처리 관례(TOP20의 "편성 5회 미만 참고용" 분리 등)와 같은
-- 최소 표본 기준(5회)을 top_programs 선정 단계에 having절로 추가 — 계산 로직 자체(avg_rating,
-- daypart 강세/약세, 점유율/가구 비교)는 전혀 바꾸지 않고, 순위에 오를 후보만 좁힌다.
drop function if exists get_channel_killer_content_daypart(text, text, date, int, int);

create function get_channel_killer_content_daypart(
  p_channel_code text,
  p_program_target_label text,
  p_as_of_date date,
  p_window_days int default 28,
  p_limit int default 3
)
returns table (
  canonical_name text,
  avg_rating numeric,
  airing_count bigint,
  best_daypart text,
  best_daypart_avg numeric,
  worst_daypart text,
  worst_daypart_avg numeric,
  avg_share numeric,
  channel_avg_share_baseline numeric,
  household_avg_rating numeric,
  household_baseline_avg_rating numeric
)
language sql
stable
as $$
  with window_rows as (
    select p.canonical_name, r.rating, r.share,
      (case
        when (case when extract(hour from r.start_time) < 2 then extract(hour from r.start_time)::int + 24 else extract(hour from r.start_time)::int end) between 2 and 8 then '새벽'
        when (case when extract(hour from r.start_time) < 2 then extract(hour from r.start_time)::int + 24 else extract(hour from r.start_time)::int end) between 9 and 13 then '오전'
        when (case when extract(hour from r.start_time) < 2 then extract(hour from r.start_time)::int + 24 else extract(hour from r.start_time)::int end) between 14 and 18 then '오후'
        else '저녁_심야'
      end) as daypart
    from ratings r
    join channels c on c.id = r.channel_id
    left join targets t on t.id = r.target_id
    join programs p on p.id = r.program_id
    where c.code = p_channel_code and (t.label = p_program_target_label or r.target_id is null)
      and r.source_type in ('nielsen_daily', 'skyuhd') and r.program_id is not null and r.start_time is not null
      and r.rating is not null
      and r.broadcast_date between (p_as_of_date - p_window_days) and p_as_of_date
  ),
  top_programs as (
    select canonical_name, avg(rating) as avg_rating, count(*) as airing_count, avg(share) as avg_share
    from window_rows
    group by canonical_name
    having count(*) >= 5
    order by avg_rating desc
    limit p_limit
  ),
  daypart_stats as (
    select w.canonical_name, w.daypart, avg(w.rating) as avg_rating, count(*) as n
    from window_rows w
    join top_programs tp on tp.canonical_name = w.canonical_name
    group by w.canonical_name, w.daypart
  ),
  channel_share_baseline as (
    select avg(share) as avg_share from window_rows
  ),
  household_window_rows as (
    select p.canonical_name, r.rating
    from ratings r
    join channels c on c.id = r.channel_id
    join targets t on t.id = r.target_id
    join programs p on p.id = r.program_id
    where c.code = p_channel_code and t.label = '전국 유료가구'
      and p_program_target_label <> '전국 유료가구'
      and r.source_type in ('nielsen_daily', 'skyuhd') and r.program_id is not null
      and r.rating is not null
      and r.broadcast_date between (p_as_of_date - p_window_days) and p_as_of_date
  ),
  household_baseline as (
    select avg(rating) as avg_rating from household_window_rows
  )
  select
    tp.canonical_name,
    round(tp.avg_rating::numeric, 5) as avg_rating,
    tp.airing_count,
    best.daypart as best_daypart,
    round(best.avg_rating::numeric, 5) as best_daypart_avg,
    worst.daypart as worst_daypart,
    round(worst.avg_rating::numeric, 5) as worst_daypart_avg,
    round(tp.avg_share::numeric, 4) as avg_share,
    round(csb.avg_share::numeric, 4) as channel_avg_share_baseline,
    round(hw.avg_rating::numeric, 5) as household_avg_rating,
    round(hb.avg_rating::numeric, 5) as household_baseline_avg_rating
  from top_programs tp
  left join lateral (
    select daypart, avg_rating from daypart_stats ds where ds.canonical_name = tp.canonical_name order by avg_rating desc limit 1
  ) best on true
  left join lateral (
    select daypart, avg_rating from daypart_stats ds
    where ds.canonical_name = tp.canonical_name and ds.n >= 2 and ds.daypart <> best.daypart
    order by avg_rating asc
    limit 1
  ) worst on true
  left join channel_share_baseline csb on true
  left join lateral (
    select avg(rating) as avg_rating from household_window_rows hwr where replace(hwr.canonical_name, ' ', '') = replace(tp.canonical_name, ' ', '')
  ) hw on true
  left join household_baseline hb on true
  order by tp.avg_rating desc;
$$;
comment on function get_channel_killer_content_daypart is 'Page 1 채널별 킬러 콘텐츠용: 최근 4주 평균 상위 프로그램(창 내 편성 5회 이상만 후보, 2026-09-02 수정)의 daypart(새벽/오전/오후/저녁심야)별 강세·약세 + 점유율(채널 평균 대비)·유료가구 시청률(채널 평균 대비, KPI가 이미 유료가구인 채널은 NULL) 참고값. worst는 daypart가 2개 이상 있고 best와 다를 때만 채워진다.';
