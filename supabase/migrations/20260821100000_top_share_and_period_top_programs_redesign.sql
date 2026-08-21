-- 사용자 지시(2026-08-21):
-- (1) "시청률 상위 콘텐츠 TOP 20에는 없지만 전체 점유율 1~5위인 콘텐츠가 있으면 별도로 명기"
--     — TOP20은 시청률 기준으로만 자르기 때문에, 점유율 상위인데 시청률 순위가 밀려 TOP20 밖에
--     있는 프로그램은 애초에 조회 결과에 존재하지 않는다. get_channel_top_programs와 동일한 필터로
--     점유율(avg_share) 기준 상위 N개만 별도로 뽑는 작은 함수를 새로 추가한다(큰 limit을 걸어
--     추측하는 대신, 필요한 정렬 기준으로 직접 쿼리 — 정확함을 보장).
-- (2) "선택기간 동기간 경쟁사 주요프로그램은 일회성 편성이 아니라 기간 내 총 경쟁사 프로그램
--     평균으로 높았던 것으로, 같은 채널에서 같은 프로그램이 두 번 이상 나오면 안 됨" —
--     get_competitor_period_top_programs를 "프로그램별 그 기간 평균 시청률"로 다시 설계한다
--     (기존엔 개별 방영일 단위 rating으로 정렬해 인기 프로그램이 여러 날짜로 중복 등장하고,
--     반짝 특별편성이 낮은 방영횟수로도 상위에 올라올 수 있었다).
drop function if exists get_channel_top_share_programs(text, text, date, int, int);

create function get_channel_top_share_programs(
  p_channel_code text,
  p_program_target_label text,
  p_as_of_date date,
  p_window_days int default 84,
  p_limit int default 5
)
returns table (
  program_name text,
  avg_rating numeric,
  avg_share numeric,
  air_count int
)
language sql
stable
as $$
  with base as (
    select p.canonical_name, r.rating, r.share
    from ratings r
    join channels c on c.id = r.channel_id
    left join targets t on t.id = r.target_id
    join programs p on p.id = r.program_id
    where c.code = p_channel_code and (t.label = p_program_target_label or r.target_id is null)
      and r.source_type in ('nielsen_daily', 'skyuhd') and r.program_id is not null and r.start_time is not null
      and r.rating is not null and r.share is not null
      and r.broadcast_date between (p_as_of_date - p_window_days + 1) and p_as_of_date
  )
  select
    canonical_name as program_name,
    round(avg(rating)::numeric, 5) as avg_rating,
    round(avg(share)::numeric, 4) as avg_share,
    count(*)::int as air_count
  from base
  group by canonical_name
  order by avg(share) desc
  limit p_limit;
$$;
comment on function get_channel_top_share_programs is 'TOP20(시청률 기준) 화면 아래 "TOP20에는 없지만 점유율은 상위인" 콘텐츠를 짚어주기 위한 보조 함수 — get_channel_top_programs와 동일한 필터, 정렬만 avg(share) desc로 바꿔 점유율 상위 N개(기본 5)를 직접 조회한다(2026-08-21).';

drop function if exists get_competitor_period_top_programs(text, text, date, date, int, int);

create or replace function get_competitor_period_top_programs(
  p_channel_code text,
  p_target_label text,
  p_date_from date,
  p_date_to date,
  p_channel_limit int default 5,
  p_program_limit int default 7
)
returns table (
  competitor_name text,
  channel_period_avg_rating numeric,
  channel_rank int,
  program_name text,
  program_avg_rating numeric,
  air_count int,
  typical_start_hour int
)
language plpgsql
stable
as $$
declare
  v_channel_id uuid;
  v_target_id uuid;
  v_resolved_target_id uuid;
begin
  select id into v_channel_id from channels where code = p_channel_code;
  if v_channel_id is null then
    raise exception '알 수 없는 채널 코드: %', p_channel_code;
  end if;

  select id into v_target_id from targets where label = p_target_label;

  v_resolved_target_id := v_target_id;
  if v_resolved_target_id is null or not exists (
    select 1 from competitor_ratings cr
    join competitors comp on comp.competitor_name = cr.competitor_name and comp.channel_id = v_channel_id
    where cr.target_id = v_resolved_target_id
      and cr.broadcast_date between p_date_from and p_date_to
  ) then
    select cr.target_id into v_resolved_target_id
    from competitor_ratings cr
    join competitors comp on comp.competitor_name = cr.competitor_name and comp.channel_id = v_channel_id
    where cr.broadcast_date between p_date_from and p_date_to
    group by cr.target_id
    order by count(*) desc
    limit 1;
  end if;

  return query
  with top_channels as (
    select cr.competitor_name, avg(cr.rating) as period_avg_rating,
      row_number() over (order by avg(cr.rating) desc) as rn
    from competitor_ratings cr
    join competitors comp on comp.competitor_name = cr.competitor_name and comp.channel_id = v_channel_id
    where cr.target_id = v_resolved_target_id
      and cr.source_type = 'nielsen_daily'
      and cr.broadcast_date between p_date_from and p_date_to
    group by cr.competitor_name
    order by period_avg_rating desc
    limit p_channel_limit
  ),
  -- 사용자 지시(2026-08-21): "일회성 편성 말고 해당 기간 총 경쟁사 프로그램 평균이 높았던 것" —
  -- 개별 방영일(broadcast_date) 단위가 아니라 competitor_name+program_name으로 묶어 그 기간
  -- 평균 시청률을 계산한다. group by 자체가 "같은 채널에서 같은 프로그램이 두 번 나오면 안 된다"는
  -- 요구를 자연히 만족시킨다(프로그램당 행 하나).
  program_avg as (
    select cp.competitor_name, cp.program_name,
      avg(cp.rating) as program_avg_rating,
      count(*)::int as air_count
    from competitor_program_ratings cp
    join channels c on c.id = cp.our_channel_id and c.code = p_channel_code
    join top_channels tc on tc.competitor_name = cp.competitor_name
    where cp.broadcast_date between p_date_from and p_date_to
      and cp.rating is not null
    group by cp.competitor_name, cp.program_name
  ),
  -- 여러 날 방영시간이 조금씩 다를 수 있어(±수 분) 가장 자주 시작한 "시(hour)"를 대표값으로 쓴다.
  hour_counts as (
    select cp.competitor_name, cp.program_name,
      (case when extract(hour from cp.start_time) < 2 then extract(hour from cp.start_time)::int + 24 else extract(hour from cp.start_time)::int end) as hr,
      count(*) as cnt
    from competitor_program_ratings cp
    join channels c on c.id = cp.our_channel_id and c.code = p_channel_code
    join top_channels tc on tc.competitor_name = cp.competitor_name
    where cp.broadcast_date between p_date_from and p_date_to
      and cp.rating is not null
    group by cp.competitor_name, cp.program_name, hr
  ),
  hour_mode as (
    select distinct on (competitor_name, program_name) competitor_name, program_name, hr
    from hour_counts
    order by competitor_name, program_name, cnt desc, hr
  )
  select
    tc.competitor_name,
    round(tc.period_avg_rating::numeric, 5),
    tc.rn::int,
    pa.program_name,
    round(pa.program_avg_rating::numeric, 5),
    pa.air_count,
    hm.hr
  from top_channels tc
  join program_avg pa on pa.competitor_name = tc.competitor_name
  left join hour_mode hm on hm.competitor_name = pa.competitor_name and hm.program_name = pa.program_name
  order by pa.program_avg_rating desc
  limit p_program_limit;
end;
$$;
comment on function get_competitor_period_top_programs is 'Page 2 COMPARED WITH?(기간 모드): 시청률 상위 등록 경쟁채널(기본 5개) 안에서, 프로그램별 "그 기간 평균 시청률"이 높은 순 상위 M개(기본 7)를 뽑는다(2026-08-21 재설계 — 개별 방영일 단위가 아니라 프로그램 단위 평균으로 바꿔 일회성 반짝 편성이 아니라 꾸준히 강했던 프로그램을 반영하고, group by로 같은 프로그램 중복 노출도 없앴다). 자사 타깃 라벨이 competitor_ratings 표기와 다르면 그 채널 경쟁채널들이 실제로 쓴 target_id로 자동 대체한다.';
