-- 사용자 지시: ENA/ENA Play/ENA Drama는 KPI가 "수도권 2049"이지만, 최근 12주 평균 대비
-- 유료가구(전국) 시청률·점유율에서 유의미하게 기여한 프로그램이 있으면 인사이트에 함께
-- 표시한다 — 2049 타깃만 보면 놓치는 "가구 단위로는 강한 콘텐츠"를 잡아내기 위함.
create or replace function get_channel_household_top_program(
  p_channel_code text,
  p_as_of_date date,
  p_window_days int default 84 -- 12주
)
returns table (
  today_top_program text,
  today_top_rating numeric,
  today_top_share numeric,
  today_top_start_time time,
  baseline_avg_rating numeric,
  baseline_avg_share numeric,
  baseline_days int
)
language sql
stable
as $$
  with today_top as (
    select p.canonical_name, r.rating, r.share, r.start_time
    from ratings r
    join channels c on c.id = r.channel_id
    join targets t on t.id = r.target_id
    join programs p on p.id = r.program_id
    where c.code = p_channel_code and t.label = '전국 유료가구'
      and r.source_type = 'nielsen_daily' and r.program_id is not null
      and r.broadcast_date = p_as_of_date and r.rating is not null
    order by r.rating desc
    limit 1
  ),
  baseline as (
    select avg(r.rating) as avg_rating, avg(r.share) as avg_share, count(*) as days
    from ratings r
    join channels c on c.id = r.channel_id
    join targets t on t.id = r.target_id
    join programs p on p.id = r.program_id, today_top tt
    where c.code = p_channel_code and t.label = '전국 유료가구'
      and r.source_type = 'nielsen_daily'
      and replace(p.canonical_name, ' ', '') = replace(tt.canonical_name, ' ', '')
      and r.broadcast_date between (p_as_of_date - p_window_days) and (p_as_of_date - 1)
      and r.rating is not null
  )
  select
    tt.canonical_name as today_top_program,
    round(tt.rating::numeric, 5) as today_top_rating,
    round(tt.share::numeric, 4) as today_top_share,
    tt.start_time as today_top_start_time,
    round(b.avg_rating::numeric, 5) as baseline_avg_rating,
    round(b.avg_share::numeric, 4) as baseline_avg_share,
    b.days::int as baseline_days
  from today_top tt
  left join baseline b on true;
$$;
comment on function get_channel_household_top_program is 'Page 1 채널별 인사이트 보강(ENA/ENA Play/ENA Drama 전용): 오늘 전국 유료가구 타깃 기준 최고 시청률 프로그램과, 그 프로그램 자체의 최근 12주(84일) 유료가구 평균 대비 편차. 2049 타깃 기준 1위 프로그램과 다를 수 있어 별도로 확인한다.';
