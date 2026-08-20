-- Page 2 기간 설정 전면 개편(사용자 지시, 2026-08-20): 우측 상단 기간 설정에서 "단일 일자"뿐 아니라
-- "YYYY-MM-DD ~ YYYY-MM-DD" 범위(하루~1년 이상 전체)도 고를 수 있게 하고, 그 선택에 따라 오늘의
-- 브리핑부터 COMPARED WITH?(경쟁사 분석)까지 화면 대부분이 실제로 재계산되도록 SQL 쪽을 보강한다.
--
-- 설계 판단: 모든 함수를 "기간 평균" 버전으로 새로 만들지 않고, 이미 있던 함수 중 하루 단위로
-- 고정돼 있던 것만 p_date_from(선택)을 추가해 "기간이면 평균, 없으면(=단일 일자) 기존과 100% 동일"
-- 하도록 확장했다 — 기존 단일 일자 동작을 절대 깨지 않기 위함. WHY?(원인 추적)/기회 탐지/Fit Score처럼
-- 이미 "기준일 하나 + 자체 trailing window"로 설계된 함수는 그대로 두고 기준일(p_as_of_date)을
-- 선택한 기간의 마지막 날짜로 넘기는 것만 프런트에서 바꾼다(이 함수들은 원래도 "그 시점까지의 추세"를
-- 보는 것이라 굳이 새로 바꿀 필요가 없음). 반대로 "오늘 시간대별 경쟁 프로그램"(동시간대 페어링 비교)은
-- 여러 날을 억지로 합치면 의미가 흐려져서(같은 시간대에 며칠치 프로그램이 뒤섞여 표시됨) 그대로
-- 마지막 날짜(date_to) 기준 단일 일자로 유지하고, 화면 문구에 그 사실을 명시한다.

-- 0) daypart(새벽/오전/오후/저녁·심야) 판정 — get_channel_daypart_opportunity 등에서 반복되던
--    CASE 식을 함수로 뽑아 새 함수들에서 재사용한다(기존 함수는 그대로 두고 건드리지 않음).
create or replace function daypart_of(p_start_time time)
returns text
language sql
immutable
as $$
  select case
    when (case when extract(hour from p_start_time) < 2 then extract(hour from p_start_time)::int + 24 else extract(hour from p_start_time)::int end) between 2 and 8 then '새벽'
    when (case when extract(hour from p_start_time) < 2 then extract(hour from p_start_time)::int + 24 else extract(hour from p_start_time)::int end) between 9 and 13 then '오전'
    when (case when extract(hour from p_start_time) < 2 then extract(hour from p_start_time)::int + 24 else extract(hour from p_start_time)::int end) between 14 and 18 then '오후'
    else '저녁_심야'
  end
$$;
comment on function daypart_of is '방송 시작시각(02~26시 관행 포함)을 새벽/오전/오후/저녁_심야 4구간으로 분류';

-- 1) 선택 기간 요약 — WHAT HAPPENED?/HOW DEEPLY?의 기간 범위 버전. 기간 평균, 직전 동일 길이
--    기간 대비 등락, 최근 12주(기본) 평균 대비 등락, 기간 중 최고/최저 날짜를 한 번에 낸다.
--    date_from=date_to(단일 일자)여도 그대로 동작한다(그 하루의 값 = "평균").
create or replace function get_rating_period_report(
  p_channel_code text,
  p_target_label text,
  p_date_from date,
  p_date_to date,
  p_baseline_days int default 84
)
returns table (
  days_with_data bigint,
  avg_rating numeric,
  avg_share numeric,
  avg_reach numeric,
  avg_time_spent_seconds numeric,
  avg_time_spent_share numeric,
  prior_period_avg_rating numeric,
  prior_period_change_pct numeric,
  baseline_avg_rating numeric,
  baseline_change_pct numeric,
  best_date date,
  best_rating numeric,
  worst_date date,
  worst_rating numeric
)
language sql
stable
as $$
  with period as (
    select * from get_rating_summary(p_channel_code, p_target_label, p_date_from, p_date_to)
  ),
  prior as (
    select avg_rating as prior_avg
    from get_rating_summary(
      p_channel_code, p_target_label,
      p_date_from - (p_date_to - p_date_from + 1), p_date_from - 1
    )
  ),
  baseline as (
    select avg_rating as baseline_avg
    from get_rating_summary(p_channel_code, p_target_label, p_date_from - p_baseline_days, p_date_from - 1)
  ),
  extremes as (
    select r.broadcast_date, r.rating,
      row_number() over (order by r.rating desc) as rn_best,
      row_number() over (order by r.rating asc) as rn_worst
    from ratings r
    join channels c on c.id = r.channel_id
    join targets t on t.id = r.target_id
    where c.code = p_channel_code and t.label = p_target_label
      and r.source_type = 'nielsen_daily' and r.program_id is null
      and r.broadcast_date between p_date_from and p_date_to
      and r.rating is not null
  )
  select
    period.days_with_data,
    round(period.avg_rating::numeric, 5),
    round(period.avg_share::numeric, 4),
    round(period.avg_reach::numeric, 4),
    round(period.avg_time_spent_seconds::numeric, 1),
    round(period.avg_time_spent_share::numeric, 4),
    round(prior.prior_avg::numeric, 5),
    pct_change(period.avg_rating, prior.prior_avg),
    round(baseline.baseline_avg::numeric, 5),
    pct_change(period.avg_rating, baseline.baseline_avg),
    (select broadcast_date from extremes where rn_best = 1),
    (select round(rating::numeric, 5) from extremes where rn_best = 1),
    (select broadcast_date from extremes where rn_worst = 1),
    (select round(rating::numeric, 5) from extremes where rn_worst = 1)
  from period, prior, baseline;
$$;
comment on function get_rating_period_report is 'Page 2 기간 범위 선택 시 WHAT HAPPENED?/HOW DEEPLY?/브리핑에 쓰는 기간 요약: 기간 평균, 직전 동일 길이 기간 대비, 최근 12주 평균 대비, 기간 중 최고/최저일. date_from=date_to(단일 일자)에서도 정상 동작.';

-- 2) 02~26시 그래프 프로그램명 — 기존엔 하루(p_date)만 됐는데, 기간 범위에서도 "그 시간대에
--    무엇이 방영됐는지" 목록을 보여줄 수 있도록 p_date_from~p_date_to로 확장한다.
--    OUT 파라미터 구성은 그대로지만 인자 이름(p_date → p_date_from/p_date_to)이 바뀌므로 drop 필요.
drop function if exists get_hourly_program_titles(text, text, date);

create function get_hourly_program_titles(
  p_channel_code text,
  p_target_label text,
  p_date_from date,
  p_date_to date
)
returns table (
  broadcast_hour int,
  program_names text
)
language sql
stable
as $$
  select
    (case when extract(hour from r.start_time) < 2 then extract(hour from r.start_time)::int + 24 else extract(hour from r.start_time)::int end) as broadcast_hour,
    string_agg(distinct p.canonical_name, ' / ' order by p.canonical_name) as program_names
  from ratings r
  join channels c on c.id = r.channel_id
  join targets t on t.id = r.target_id
  join programs p on p.id = r.program_id
  where c.code = p_channel_code and t.label = p_target_label
    and r.source_type = 'nielsen_daily' and r.program_id is not null and r.start_time is not null
    and r.broadcast_date between p_date_from and p_date_to
  group by broadcast_hour
  order by broadcast_hour;
$$;
comment on function get_hourly_program_titles is 'Page 2 02~26시 그래프: 선택 기간(단일 일자면 그날) 동안 각 시간대에 방영된 프로그램명(여러 날/여러 개면 " / "로 이어붙임).';

-- 3) COMPARED WITH? 경쟁채널 랭킹 — p_date_from을 추가해, 기간이면 순위/시청률을 기간 평균으로,
--    baseline(12주)은 p_date_from 이전으로 계산(선택 기간과 baseline이 겹치지 않도록 —
--    daypart_opportunity에서 겪었던 "최근 구간을 전체 평균에 이중 포함" 버그를 처음부터 피함).
--    p_date_from을 안 주면(기존 호출) d_from=d_to=p_as_of_date로 완전히 기존과 동일하게 동작한다.
--    Postgres는 파라미터 목록이 다르면 "create or replace"를 오버로드(별도 함수)로 취급해
--    PostgREST가 함수를 하나로 특정 못 하는 문제가 생긴다 — 기존 4개 인자 버전을 먼저 지운다.
drop function if exists get_competitor_insight_report(text, text, date, int);

create or replace function get_competitor_insight_report(
  p_channel_code text,
  p_target_label text,
  p_as_of_date date,
  p_baseline_days int default 84,
  p_date_from date default null
)
returns table (
  competitor_name text,
  today_rank int,
  today_rating numeric,
  baseline_avg_rating numeric,
  delta_pct numeric,
  top_program_name text,
  top_program_start_time time,
  top_program_rating numeric
)
language sql
stable
as $$
  with bounds as (
    select coalesce(p_date_from, p_as_of_date) as d_from, p_as_of_date as d_to
  ),
  period_rows as (
    select cr.competitor_name, avg(cr.rating) as period_rating, min(cr.rank) as best_rank
    from competitor_ratings cr
    join targets t on t.id = cr.target_id
    join channels c on c.code = p_channel_code
    join competitors comp on comp.competitor_name = cr.competitor_name and comp.channel_id = c.id
    cross join bounds b
    where t.label = p_target_label
      and cr.source_type = 'nielsen_daily'
      and cr.broadcast_date between b.d_from and b.d_to
    group by cr.competitor_name
  ),
  baseline as (
    select cr.competitor_name, avg(cr.rating) as avg_rating
    from competitor_ratings cr
    join targets t on t.id = cr.target_id
    join channels c on c.code = p_channel_code
    join competitors comp on comp.competitor_name = cr.competitor_name and comp.channel_id = c.id
    cross join bounds b
    where t.label = p_target_label
      and cr.source_type = 'nielsen_daily'
      and cr.broadcast_date between (b.d_from - p_baseline_days) and (b.d_from - 1)
    group by cr.competitor_name
  ),
  top_program as (
    select distinct on (cp.competitor_name) cp.competitor_name, cp.program_name, cp.start_time, cp.rating
    from competitor_program_ratings cp
    join channels c on c.id = cp.our_channel_id
    cross join bounds b
    where c.code = p_channel_code
      and cp.broadcast_date between b.d_from and b.d_to
      and cp.rating is not null
    order by cp.competitor_name, cp.rating desc
  )
  select
    pr.competitor_name,
    pr.best_rank as today_rank,
    round(pr.period_rating::numeric, 5) as today_rating,
    round(bl.avg_rating::numeric, 5) as baseline_avg_rating,
    pct_change(pr.period_rating, bl.avg_rating) as delta_pct,
    tp.program_name as top_program_name,
    tp.start_time as top_program_start_time,
    round(tp.rating::numeric, 5) as top_program_rating
  from period_rows pr
  left join baseline bl on bl.competitor_name = pr.competitor_name
  left join top_program tp on tp.competitor_name = pr.competitor_name
  order by pr.best_rank asc nulls last;
$$;
comment on function get_competitor_insight_report is 'Page 2 COMPARED WITH? 보고서용: 등록 경쟁채널을 순위 순으로, 최근 12주 평균 대비 등락과 최고 성적 프로그램(시간대)까지 제공. p_date_from을 주면 그 기간 평균/최고순위로 집계(baseline은 p_date_from 이전으로 겹치지 않게 계산), 안 주면 p_as_of_date 하루만.';

-- 4) COMPARED WITH? 시장 전체 TOP N — 기존엔 하루만 됐는데, 기간이면 그 기간 안에서 시청률이
--    가장 높았던 방영 인스턴스 TOP N을 그대로 보여준다(날짜별로 묶지 않고 개별 방영 기준 랭킹).
--    반환 컬럼에 broadcast_date를 추가했고 인자도 늘어나 기존 버전을 먼저 지운다.
drop function if exists get_competitor_top_programs(text, date, int);

create or replace function get_competitor_top_programs(
  p_channel_code text,
  p_as_of_date date,
  p_limit int default 5,
  p_date_from date default null
)
returns table (
  competitor_name text,
  program_name text,
  start_time time,
  end_time time,
  rating numeric,
  broadcast_date date
)
language sql
stable
as $$
  select cp.competitor_name, cp.program_name, cp.start_time, cp.end_time, cp.rating, cp.broadcast_date
  from competitor_program_ratings cp
  join channels c on c.id = cp.our_channel_id
  where c.code = p_channel_code
    and cp.broadcast_date between coalesce(p_date_from, p_as_of_date) and p_as_of_date
    and cp.rating is not null
  order by cp.rating desc
  limit p_limit;
$$;
comment on function get_competitor_top_programs is 'Page 2 COMPARED WITH?: 등록 경쟁채널들의 시청률 상위 프로그램 TOP N(시장 전체 동향 참고용). p_date_from을 주면 그 기간 전체에서, 안 주면 p_as_of_date 하루에서 고른다.';

-- 5) 신규 섹션 — 최근 12주 월~일 × daypart(새벽/오전/오후/저녁·심야) 강세/약세 히트맵.
--    skyUHD처럼 매일 갱신되지 않는 채널도 12주 누적으로 보면 패턴을 볼 수 있다(사용자 지시).
create or replace function get_channel_dow_daypart_pattern(
  p_channel_code text,
  p_program_target_label text,
  p_as_of_date date,
  p_window_days int default 84
)
returns table (
  dow int,
  dow_label text,
  daypart text,
  avg_rating numeric,
  sample_count int
)
language sql
stable
as $$
  with base as (
    select
      extract(isodow from r.broadcast_date)::int as dow,
      daypart_of(r.start_time) as daypart,
      r.rating
    from ratings r
    join channels c on c.id = r.channel_id
    join targets t on t.id = r.target_id
    where c.code = p_channel_code and t.label = p_program_target_label
      and r.source_type = 'nielsen_daily' and r.program_id is not null and r.start_time is not null
      and r.rating is not null
      and r.broadcast_date between (p_as_of_date - p_window_days + 1) and p_as_of_date
  ),
  grid as (
    select dow.d as dow, dp.p as daypart
    from generate_series(1, 7) as dow(d)
    cross join unnest(array['새벽', '오전', '오후', '저녁_심야']) as dp(p)
  )
  select
    g.dow,
    (array['월', '화', '수', '목', '금', '토', '일'])[g.dow] as dow_label,
    g.daypart,
    round(avg(b.rating)::numeric, 5) as avg_rating,
    count(b.rating)::int as sample_count
  from grid g
  left join base b on b.dow = g.dow and b.daypart = g.daypart
  group by g.dow, g.daypart
  order by g.dow, array_position(array['새벽', '오전', '오후', '저녁_심야'], g.daypart);
$$;
comment on function get_channel_dow_daypart_pattern is 'Page 2 신규 섹션(주간 강세 시간대): 최근 12주(기본 84일) 월~일 × daypart 조합별 평균 시청률 — 표본 없는 칸은 avg_rating NULL/sample_count 0.';

-- 6) 신규 섹션 — 최근 12주 시청률 상위 콘텐츠 TOP N(기본 20개). 프로그램별 평균 시청률 순.
create or replace function get_channel_top_programs(
  p_channel_code text,
  p_program_target_label text,
  p_as_of_date date,
  p_window_days int default 84,
  p_limit int default 20
)
returns table (
  program_name text,
  avg_rating numeric,
  air_count int,
  top_daypart text,
  most_common_start_hour int
)
language sql
stable
as $$
  with base as (
    select
      p.canonical_name,
      r.rating,
      daypart_of(r.start_time) as daypart,
      (case when extract(hour from r.start_time) < 2 then extract(hour from r.start_time)::int + 24 else extract(hour from r.start_time)::int end) as hr
    from ratings r
    join channels c on c.id = r.channel_id
    join targets t on t.id = r.target_id
    join programs p on p.id = r.program_id
    where c.code = p_channel_code and t.label = p_program_target_label
      and r.source_type = 'nielsen_daily' and r.program_id is not null and r.start_time is not null
      and r.rating is not null
      and r.broadcast_date between (p_as_of_date - p_window_days + 1) and p_as_of_date
  ),
  daypart_counts as (
    select canonical_name, daypart, count(*) as cnt
    from base
    group by canonical_name, daypart
  ),
  daypart_mode as (
    select distinct on (canonical_name) canonical_name, daypart
    from daypart_counts
    order by canonical_name, cnt desc, daypart
  ),
  hour_counts as (
    select canonical_name, hr, count(*) as cnt
    from base
    group by canonical_name, hr
  ),
  hour_mode as (
    select distinct on (canonical_name) canonical_name, hr
    from hour_counts
    order by canonical_name, cnt desc, hr
  )
  select
    b.canonical_name as program_name,
    round(avg(b.rating)::numeric, 5) as avg_rating,
    count(*)::int as air_count,
    dm.daypart as top_daypart,
    hm.hr as most_common_start_hour
  from base b
  left join daypart_mode dm on dm.canonical_name = b.canonical_name
  left join hour_mode hm on hm.canonical_name = b.canonical_name
  group by b.canonical_name, dm.daypart, hm.hr
  order by avg(b.rating) desc
  limit p_limit;
$$;
comment on function get_channel_top_programs is 'Page 2 신규 섹션(TOP 콘텐츠): 최근 12주(기본 84일) 평균 시청률 상위 프로그램 목록(기본 20개) — 프로그램별 평균 시청률·방영횟수·주 daypart·주 방영시간(최빈값).';
