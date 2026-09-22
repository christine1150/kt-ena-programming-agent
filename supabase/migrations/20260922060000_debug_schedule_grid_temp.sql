-- 임시 디버그용 함수 — match_schedule_grid_ratings가 왜 특정 행을 매칭하지 못하는지
-- candidates CTE 결과를 직접 눈으로 확인하기 위함. 조사 후 다음 마이그레이션에서 즉시 drop한다.
create or replace function debug_schedule_grid_candidates(p_grid_id uuid)
returns table (
  program_id uuid,
  canonical_name text,
  rating numeric,
  diff_minutes numeric,
  rn bigint
)
language sql
stable
as $$
  with g as (select * from program_schedule_grid where id = p_grid_id)
  select
    r.program_id,
    p.canonical_name,
    r.rating,
    abs(extract(epoch from (
      (r.broadcast_date + r.start_time) - (g.broadcast_date + g.start_time)
    )) / 60.0) as diff_minutes,
    row_number() over (
      order by abs(extract(epoch from (
        (r.broadcast_date + r.start_time) - (g.broadcast_date + g.start_time)
      )) / 60.0)
    ) as rn
  from g
  join ratings r
    on r.channel_id = g.channel_id
    and r.broadcast_date = g.broadcast_date
    and r.source_type = 'nielsen_daily'
    and r.program_id is not null
    and r.rating is not null
  join programs p on p.id = r.program_id
  where (
    schedule_grid_normalize_title(p.canonical_name) like '%' || nullif(schedule_grid_normalize_title(g.program_name_raw), '') || '%'
    or schedule_grid_normalize_title(g.program_name_raw) like '%' || nullif(schedule_grid_normalize_title(p.canonical_name), '') || '%'
  )
  order by diff_minutes
  limit 20;
$$;
