-- 버그 수정: get_competitor_insight_report가 자사 타깃 라벨(matched_target_label, 예:
-- "수도권 2049")로 competitor_ratings를 곧바로 조회했는데, competitor_ratings의 라벨은
-- §1.1 랭킹 시트 표기("개인2049")를 쓴다 — ENA/ENA Drama/ENA Play는 두 표기가 달라(기존에
-- get_competitive_pressure에서 이미 겪고 고친 문제, 20260819120000 참고) 결과가 항상
-- 0건이었다. 같은 동의어 폴백 로직을 그대로 적용한다.
create or replace function get_competitor_insight_report(
  p_channel_code text,
  p_target_label text,
  p_as_of_date date,
  p_baseline_days int default 84
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
language plpgsql
stable
as $$
declare
  v_channel_id uuid;
  v_target_id uuid;
  v_competitor_target_id uuid;
  v_alias_label text;
begin
  select id into v_channel_id from channels where code = p_channel_code;
  if v_channel_id is null then
    raise exception '알 수 없는 채널 코드: %', p_channel_code;
  end if;

  select id into v_target_id from targets where label = p_target_label;

  -- 1차: 자사 타깃 라벨과 정확히 같은 라벨로 경쟁채널 데이터가 있는지 확인
  v_competitor_target_id := v_target_id;
  if v_competitor_target_id is null or not exists (
    select 1 from competitor_ratings cr
    join competitors comp on comp.competitor_name = cr.competitor_name
    where comp.channel_id = v_channel_id and cr.target_id = v_competitor_target_id
      and cr.broadcast_date = p_as_of_date
  ) then
    -- 2차: 못 찾으면 "수도권/National " 접두어를 떼고 "개인"을 붙인 동의어로 재시도
    v_alias_label := concat('개인', regexp_replace(p_target_label, '^(수도권|National)\s*', ''));
    select id into v_competitor_target_id from targets where label = v_alias_label;
  end if;

  return query
  with today_rows as (
    select cr.competitor_name, cr.rank, cr.rating
    from competitor_ratings cr
    join competitors comp on comp.competitor_name = cr.competitor_name and comp.channel_id = v_channel_id
    where cr.target_id = v_competitor_target_id
      and cr.source_type = 'nielsen_daily'
      and cr.broadcast_date = p_as_of_date
  ),
  baseline as (
    select cr.competitor_name, avg(cr.rating) as avg_rating
    from competitor_ratings cr
    join competitors comp on comp.competitor_name = cr.competitor_name and comp.channel_id = v_channel_id
    where cr.target_id = v_competitor_target_id
      and cr.source_type = 'nielsen_daily'
      and cr.broadcast_date between (p_as_of_date - p_baseline_days) and (p_as_of_date - 1)
    group by cr.competitor_name
  ),
  top_program as (
    select distinct on (cp.competitor_name) cp.competitor_name, cp.program_name, cp.start_time, cp.rating
    from competitor_program_ratings cp
    join channels c on c.id = cp.our_channel_id
    where c.code = p_channel_code
      and cp.broadcast_date = p_as_of_date
      and cp.rating is not null
    order by cp.competitor_name, cp.rating desc
  )
  select
    tr.competitor_name,
    tr.rank as today_rank,
    round(tr.rating::numeric, 5) as today_rating,
    round(b.avg_rating::numeric, 5) as baseline_avg_rating,
    case when b.avg_rating is not null and b.avg_rating <> 0
      then round(((tr.rating - b.avg_rating) / b.avg_rating * 100)::numeric, 1) else null end as delta_pct,
    tp.program_name as top_program_name,
    tp.start_time as top_program_start_time,
    round(tp.rating::numeric, 5) as top_program_rating
  from today_rows tr
  left join baseline b on b.competitor_name = tr.competitor_name
  left join top_program tp on tp.competitor_name = tr.competitor_name
  order by tr.rank asc nulls last;
end;
$$;
