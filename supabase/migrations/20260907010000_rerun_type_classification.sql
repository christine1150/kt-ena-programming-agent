-- 사용자 지시(2026-09-07) — 용어 정의:
-- "직재방" = 본방송이 끝나고 사이에 다른 프로그램 없이 바로 다시 방영하는 것.
-- "당일 재방" = 직재방이 아니고, 본방송이 있는 날 다른 시간대에(사이에 다른 프로그램이
--   있는 채로) 후속으로 편성하는 것.
-- 지금까지는 이 둘을 구분하지 않고 전부 "직재방"(직후재방)으로 불렀다 — 실측 확인 결과
-- 짐쌀라비움의 ENA Play 재방(본방 종료 21:12→재방 23:59, 그 사이 다른 프로그램 방영)처럼
-- 실제로는 몇 시간 간격이 있는 "당일 재방" 사례도 전부 "직재방"으로 잘못 표기되고 있었다.
-- get_original_content_daily의 rr(교차채널 재방)·self_r(자체채널 재방) 각각에, 본방 종료
-- 시각과 재방 시작 시각 사이에 그 채널에서 "다른 프로그램"이 실제로 방영됐는지를 직접
-- 조회해 rerun_type/self_rerun_type('직재방'|'당일재방'|null)으로 반환한다 — 추정이 아니라
-- 그 사이 시간대의 실제 방영 데이터 존재 여부로 판정한다.
drop function if exists get_original_content_daily(date);

create or replace function get_original_content_daily(p_as_of_date date)
returns table (
  day_of_week_iso integer,
  whitelist_program_name text,
  broadcast_channel_code text,
  expected_time time,
  note text,
  matched_program_name text,
  matched_start_time time,
  matched_end_time time,
  matched_rating numeric,
  matched_share numeric,
  matched_reach numeric,
  featured_category text,
  featured_display_name text,
  simulcast_channel_code text,
  simulcast_program_name text,
  simulcast_start_time time,
  simulcast_rating numeric,
  rerun_channel_code text,
  rerun_program_name text,
  rerun_start_time time,
  rerun_rating numeric,
  rerun_type text,
  retention_pct numeric,
  pre_rerun_start_time time,
  pre_rerun_rating numeric,
  self_rerun_start_time time,
  self_rerun_rating numeric,
  self_rerun_type text,
  prior_occurrence_date date,
  prior_occurrence_rating numeric,
  prior_rating_change_pct numeric,
  episode_number integer,
  age_breakdown jsonb,
  matched_household_rating numeric,
  household_rating_change_pct numeric,
  prev_drama_name text,
  prev_drama_avg_rating numeric,
  prev_drama_episode_count integer,
  prev_drama_change_pct numeric
)
language sql
stable
as $$
  with whitelist as (
    select distinct on (regexp_replace(p.canonical_name, '[^가-힣a-zA-Z0-9]', '', 'g'), fc.broadcast_time)
      extract(isodow from p_as_of_date)::int as day_of_week_iso,
      p.canonical_name as program_name,
      fc.category as featured_category_val,
      p.channel_id as broadcast_channel_id,
      c.code as broadcast_channel_code,
      case
        when c.primary_target ilike '%유료방송가입가구%' then '전국 유료가구'
        else trim(replace(c.primary_target, '개인', ''))
      end as program_target_label,
      fc.simulcast_channel_id as simulcast_channel_id_val,
      sc.code as simulcast_channel_code_val,
      fc.simulcast_competitor_name as simulcast_competitor_name_val,
      fc.rerun_channel_id as rerun_channel_id,
      rc.code as rerun_channel_code_val,
      fc.broadcast_time,
      fc.broadcast_schedule_text as note,
      fc.broadcast_start_date,
      fc.broadcast_time as sort_order
    from featured_content fc
    join programs p on p.id = fc.program_id
    join channels c on c.id = p.channel_id
    left join channels rc on rc.id = fc.rerun_channel_id
    left join channels sc on sc.id = fc.simulcast_channel_id
    where fc.broadcast_time is not null
      and fc.broadcast_day_of_week is not null
      and (array['월','화','수','목','금','토','일'])[extract(isodow from p_as_of_date)::int] = any(fc.broadcast_day_of_week)
      and (fc.broadcast_start_date is null or fc.broadcast_start_date <= p_as_of_date)
      and (fc.broadcast_end_date is null or fc.broadcast_end_date >= p_as_of_date)
    order by
      regexp_replace(p.canonical_name, '[^가-힣a-zA-Z0-9]', '', 'g'),
      fc.broadcast_time,
      (fc.rerun_channel_id is not null or fc.simulcast_channel_id is not null or fc.simulcast_competitor_name is not null) desc,
      fc.created_at desc
  ),
  matched as (
    select
      w.*,
      p_as_of_date - (case when w.broadcast_time < time '02:00:00' then 1 else 0 end) as effective_date,
      m.canonical_name as matched_program_name,
      m.start_time as matched_start_time,
      m.end_time as matched_end_time,
      m.rating as matched_rating,
      m.share as matched_share,
      m.reach as matched_reach,
      m.target_id as matched_target_id_val
    from whitelist w
    left join lateral (
      select p.canonical_name, r.start_time, r.end_time, r.rating, r.share, r.reach, r.target_id
      from ratings r
      join programs p on p.id = r.program_id
      join targets t0 on t0.id = r.target_id
      where r.channel_id = w.broadcast_channel_id
        and r.source_type = 'nielsen_daily'
        and r.broadcast_date = p_as_of_date - (case when w.broadcast_time < time '02:00:00' then 1 else 0 end)
        and r.program_id is not null
        and w.broadcast_time is not null
        and t0.label = w.program_target_label -- 타깃 명시(같은 시각 여러 타깃 행 중 정확히 이 타깃만)
        and least(
              abs(extract(epoch from (r.start_time - w.broadcast_time))),
              86400 - abs(extract(epoch from (r.start_time - w.broadcast_time)))
            ) <= 600 -- ±10분
      order by least(
              abs(extract(epoch from (r.start_time - w.broadcast_time))),
              86400 - abs(extract(epoch from (r.start_time - w.broadcast_time)))
            ) asc
      limit 1
    ) m on true
  ),
  deduped as (
    select distinct on (
      m.broadcast_channel_id,
      m.matched_start_time,
      case when m.matched_start_time is null then m.program_name else null end
    )
      m.*
    from matched m
    order by
      m.broadcast_channel_id,
      m.matched_start_time,
      case when m.matched_start_time is null then m.program_name else null end,
      (m.matched_program_name is not null
        and regexp_replace(m.program_name, '[^가-힣a-zA-Z0-9]', '', 'g')
            = regexp_replace(m.matched_program_name, '[^가-힣a-zA-Z0-9]', '', 'g')) desc,
      m.broadcast_start_date desc nulls last,
      m.program_name
  )
  select
    m.day_of_week_iso,
    m.program_name as whitelist_program_name,
    m.broadcast_channel_code,
    m.broadcast_time as expected_time,
    m.note,
    m.matched_program_name,
    m.matched_start_time,
    m.matched_end_time,
    m.matched_rating,
    m.matched_share,
    m.matched_reach,
    m.featured_category_val as featured_category,
    m.program_name as featured_display_name,
    coalesce(m.simulcast_channel_code_val, m.simulcast_competitor_name_val) as simulcast_channel_code,
    sim.canonical_name as simulcast_program_name,
    sim.start_time as simulcast_start_time,
    sim.rating as simulcast_rating,
    m.rerun_channel_code_val as rerun_channel_code,
    rr.canonical_name as rerun_program_name,
    rr.start_time as rerun_start_time,
    rr.rating as rerun_rating,
    case
      when rr.start_time is null then null
      when rr_gap.other_program_between then '당일재방'
      else '직재방'
    end as rerun_type,
    case when m.matched_rating is not null and m.matched_rating > 0 and rr.rating is not null
      then round((rr.rating / m.matched_rating * 100)::numeric, 1) else null end as retention_pct,
    pre.start_time as pre_rerun_start_time,
    pre.rating as pre_rerun_rating,
    self_r.start_time as self_rerun_start_time,
    self_r.rating as self_rerun_rating,
    case
      when self_r.start_time is null then null
      when self_r_gap.other_program_between then '당일재방'
      else '직재방'
    end as self_rerun_type,
    prior.broadcast_date as prior_occurrence_date,
    prior.rating as prior_occurrence_rating,
    pct_change(m.matched_rating, prior.rating) as prior_rating_change_pct,
    get_episode_number(m.matched_program_name, m.effective_date) as episode_number,
    age.age_breakdown,
    hh.rating as matched_household_rating,
    pct_change(hh.rating, hh_prior.rating) as household_rating_change_pct,
    prevd.program_name as prev_drama_name,
    prevd.avg_rating as prev_drama_avg_rating,
    prevd.episode_count as prev_drama_episode_count,
    pct_change(m.matched_rating, prevd.avg_rating) as prev_drama_change_pct
  from deduped m
  left join lateral (
    (
      select p9.canonical_name, r9.start_time, r9.rating
      from ratings r9
      join programs p9 on p9.id = r9.program_id
      where m.simulcast_channel_id_val is not null
        and m.matched_program_name is not null
        and m.matched_start_time is not null
        and r9.channel_id = m.simulcast_channel_id_val
        and r9.source_type = 'nielsen_daily'
        and r9.broadcast_date = m.effective_date
        and r9.program_id is not null
        and r9.target_id = m.matched_target_id_val
        and least(
              abs(extract(epoch from (r9.start_time - m.matched_start_time))),
              86400 - abs(extract(epoch from (r9.start_time - m.matched_start_time)))
            ) <= 1800
      order by least(
              abs(extract(epoch from (r9.start_time - m.matched_start_time))),
              86400 - abs(extract(epoch from (r9.start_time - m.matched_start_time)))
            ) asc
      limit 1
    )
    union all
    (
      select cpr.program_name as canonical_name, cpr.start_time, cpr.rating
      from competitor_program_ratings cpr
      where m.simulcast_channel_id_val is null
        and m.simulcast_competitor_name_val is not null
        and m.matched_program_name is not null
        and m.matched_start_time is not null
        and cpr.competitor_name = m.simulcast_competitor_name_val
        and cpr.broadcast_date = m.effective_date
        and cpr.norm_program_name = regexp_replace(m.matched_program_name, '[^가-힣a-zA-Z0-9]', '', 'g')
        and least(
              abs(extract(epoch from (cpr.start_time - m.matched_start_time))),
              86400 - abs(extract(epoch from (cpr.start_time - m.matched_start_time)))
            ) <= 1800
      order by least(
              abs(extract(epoch from (cpr.start_time - m.matched_start_time))),
              86400 - abs(extract(epoch from (cpr.start_time - m.matched_start_time)))
            ) asc
      limit 1
    )
  ) sim on true
  left join lateral (
    select p2.canonical_name, r2.start_time, r2.rating
    from ratings r2
    join programs p2 on p2.id = r2.program_id
    join targets t2 on t2.id = r2.target_id
    where m.rerun_channel_id is not null
      and m.matched_program_name is not null
      and r2.channel_id = m.rerun_channel_id
      and r2.source_type = 'nielsen_daily'
      and r2.broadcast_date = m.effective_date
      and r2.program_id is not null
      and r2.start_time > m.matched_end_time
      and t2.label = m.program_target_label -- 타깃 명시
      and regexp_replace(p2.canonical_name, '[^가-힣a-zA-Z0-9]', '', 'g') = regexp_replace(m.matched_program_name, '[^가-힣a-zA-Z0-9]', '', 'g')
    order by r2.start_time asc
    limit 1
  ) rr on true
  -- 직재방/당일재방 판정: 본방 종료~재방 시작 사이에 그 재방 채널에서 "다른 프로그램"이
  -- 실제로 방영됐는지(추정이 아니라 그 시간대 실제 데이터 존재 여부)를 직접 확인한다.
  left join lateral (
    select exists (
      select 1
      from ratings r2b
      join programs p2b on p2b.id = r2b.program_id
      where r2b.channel_id = m.rerun_channel_id
        and r2b.source_type = 'nielsen_daily'
        and r2b.broadcast_date = m.effective_date
        and r2b.program_id is not null
        and r2b.start_time > m.matched_end_time
        and r2b.start_time < rr.start_time
        and regexp_replace(p2b.canonical_name, '[^가-힣a-zA-Z0-9]', '', 'g') <> regexp_replace(m.matched_program_name, '[^가-힣a-zA-Z0-9]', '', 'g')
    ) as other_program_between
    where rr.start_time is not null
  ) rr_gap on true
  left join lateral (
    select p3.canonical_name, r3.start_time, r3.rating
    from ratings r3
    join programs p3 on p3.id = r3.program_id
    join targets t3 on t3.id = r3.target_id
    where m.matched_program_name is not null
      and r3.channel_id = m.broadcast_channel_id
      and r3.source_type = 'nielsen_daily'
      and r3.broadcast_date = m.effective_date
      and r3.program_id is not null
      and regexp_replace(p3.canonical_name, '[^가-힣a-zA-Z0-9]', '', 'g') = regexp_replace(m.matched_program_name, '[^가-힣a-zA-Z0-9]', '', 'g')
      and r3.start_time < m.matched_start_time
      and t3.label = m.program_target_label -- 타깃 명시
    order by r3.start_time desc
    limit 1
  ) pre on true
  left join lateral (
    select r4.start_time, r4.rating
    from ratings r4
    join programs p4 on p4.id = r4.program_id
    join targets t4 on t4.id = r4.target_id
    where m.matched_program_name is not null
      and r4.channel_id = m.broadcast_channel_id
      and r4.source_type = 'nielsen_daily'
      and r4.broadcast_date = m.effective_date
      and r4.program_id is not null
      and regexp_replace(p4.canonical_name, '[^가-힣a-zA-Z0-9]', '', 'g') = regexp_replace(m.matched_program_name, '[^가-힣a-zA-Z0-9]', '', 'g')
      and r4.start_time > m.matched_end_time
      and t4.label = m.program_target_label -- 타깃 명시
    order by r4.start_time asc
    limit 1
  ) self_r on true
  left join lateral (
    select exists (
      select 1
      from ratings r4b
      join programs p4b on p4b.id = r4b.program_id
      where r4b.channel_id = m.broadcast_channel_id
        and r4b.source_type = 'nielsen_daily'
        and r4b.broadcast_date = m.effective_date
        and r4b.program_id is not null
        and r4b.start_time > m.matched_end_time
        and r4b.start_time < self_r.start_time
        and regexp_replace(p4b.canonical_name, '[^가-힣a-zA-Z0-9]', '', 'g') <> regexp_replace(m.matched_program_name, '[^가-힣a-zA-Z0-9]', '', 'g')
    ) as other_program_between
    where self_r.start_time is not null
  ) self_r_gap on true
  left join lateral (
    select r5.broadcast_date, r5.rating
    from ratings r5
    join programs p5 on p5.id = r5.program_id
    join targets t5 on t5.id = r5.target_id
    where m.matched_program_name is not null
      and r5.channel_id = m.broadcast_channel_id
      and r5.source_type = 'nielsen_daily'
      and r5.program_id is not null
      and regexp_replace(p5.canonical_name, '[^가-힣a-zA-Z0-9]', '', 'g') = regexp_replace(m.matched_program_name, '[^가-힣a-zA-Z0-9]', '', 'g')
      and r5.broadcast_date < m.effective_date
      and r5.broadcast_date >= m.effective_date - 21
      and m.broadcast_time is not null
      and t5.label = m.program_target_label -- 타깃 명시
      and least(
            abs(extract(epoch from (r5.start_time - m.broadcast_time))),
            86400 - abs(extract(epoch from (r5.start_time - m.broadcast_time)))
          ) <= 600
    order by r5.broadcast_date desc
    limit 1
  ) prior on true
  left join lateral (
    select jsonb_agg(jsonb_build_object('label', x.label, 'rating', x.rating) order by x.rating desc) as age_breakdown
    from (
      select t.label, r6.rating
      from ratings r6
      join targets t on t.id = r6.target_id
      where m.matched_program_name is not null
        and r6.channel_id = m.broadcast_channel_id
        and r6.source_type = 'nielsen_daily'
        and r6.broadcast_date = m.effective_date
        and r6.program_id is not null
        and r6.start_time = m.matched_start_time
        and exists (
          select 1 from programs p6 where p6.id = r6.program_id
            and regexp_replace(p6.canonical_name, '[^가-힣a-zA-Z0-9]', '', 'g') = regexp_replace(m.matched_program_name, '[^가-힣a-zA-Z0-9]', '', 'g')
        )
        and t.label ~ '^(수도권|전국) (남|여)(0409|10대|20대|30대|40대|50대|60대\+)$'
        and r6.rating is not null
      order by r6.rating desc
      limit 5
    ) x
  ) age on true
  left join lateral (
    select r7.rating
    from ratings r7
    join targets t7 on t7.id = r7.target_id
    where m.matched_program_name is not null
      and r7.channel_id = m.broadcast_channel_id
      and r7.source_type = 'nielsen_daily'
      and r7.broadcast_date = m.effective_date
      and r7.program_id is not null
      and t7.label = '전국 유료가구'
      and m.broadcast_time is not null
      and least(
            abs(extract(epoch from (r7.start_time - m.broadcast_time))),
            86400 - abs(extract(epoch from (r7.start_time - m.broadcast_time)))
          ) <= 600
    order by least(
            abs(extract(epoch from (r7.start_time - m.broadcast_time))),
            86400 - abs(extract(epoch from (r7.start_time - m.broadcast_time)))
          ) asc
    limit 1
  ) hh on true
  left join lateral (
    select r8.rating
    from ratings r8
    join targets t8 on t8.id = r8.target_id
    where m.matched_program_name is not null
      and r8.channel_id = m.broadcast_channel_id
      and r8.source_type = 'nielsen_daily'
      and r8.program_id is not null
      and t8.label = '전국 유료가구'
      and r8.broadcast_date < m.effective_date
      and r8.broadcast_date >= m.effective_date - 21
      and m.broadcast_time is not null
      and least(
            abs(extract(epoch from (r8.start_time - m.broadcast_time))),
            86400 - abs(extract(epoch from (r8.start_time - m.broadcast_time)))
          ) <= 600
    order by r8.broadcast_date desc
    limit 1
  ) hh_prior on true
  left join lateral (
    select *
    from get_previous_drama_baseline(m.broadcast_channel_id, m.program_target_label, m.broadcast_start_date)
    where m.featured_category_val = '오리지널 드라마'
      and m.broadcast_start_date is not null
      and get_episode_number(m.matched_program_name, m.effective_date) <= 2
  ) prevd on true
  where m.matched_program_name is not null
  order by m.sort_order;
$$;
