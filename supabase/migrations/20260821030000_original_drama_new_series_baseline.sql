-- 사용자 지시(2026-08-21, 기능 #2): "<오리지널 드라마>는 1~2회 방송 시 직전에 끝난
-- <오리지널 드라마>의 평균과 비교 분석" — 새 드라마가 갓 시작했을 때(1~2회) 그 드라마 자신의
-- 과거 회차는 비교 기준으로 쓸 수 없으므로(1회면 아예 없음), 같은 채널·같은 슬롯에서 바로
-- 직전에 방영이 끝난 "오리지널 드라마" 카테고리 작품의 전체 방영 기간 평균 시청률과 비교한다.
-- 개발 단위 #1에서 추가한 featured_content.broadcast_start_date/broadcast_end_date(직접 입력
-- 또는 예상 회차 기반 자동계산)를 그대로 활용한다 — 새 계산 인프라 없이 날짜 범위만 조회.

-- 1) 채널 안에서 "직전에 끝난 오리지널 드라마" 1개를 찾아 그 작품의 방영 기간(broadcast_start_date
--    ~broadcast_end_date) 전체 평균 시청률을 낸다. get_original_content_daily/
--    get_featured_content_only_daily 양쪽에서 lateral로 재사용.
create or replace function get_previous_drama_baseline(
  p_channel_id uuid,
  p_program_target_label text,
  p_before_date date
)
returns table (
  program_name text,
  avg_rating numeric,
  episode_count int,
  run_start_date date,
  run_end_date date
)
language sql
stable
as $$
  with prev as (
    select fc.program_id, fp.canonical_name, fc.broadcast_start_date, fc.broadcast_end_date
    from featured_content fc
    join programs fp on fp.id = fc.program_id
    where fp.channel_id = p_channel_id
      and fc.category = '오리지널 드라마'
      and fc.broadcast_end_date is not null
      and fc.broadcast_end_date < p_before_date
    order by fc.broadcast_end_date desc
    limit 1
  )
  select
    prev.canonical_name,
    round(avg(r.rating)::numeric, 5),
    count(r.rating)::int,
    prev.broadcast_start_date,
    prev.broadcast_end_date
  from prev
  left join ratings r
    on r.program_id = prev.program_id
   and r.channel_id = p_channel_id
   and r.source_type = 'nielsen_daily'
   and r.target_id = (select id from targets where label = p_program_target_label)
   and r.broadcast_date between prev.broadcast_start_date and prev.broadcast_end_date
   and r.rating is not null
  group by prev.canonical_name, prev.broadcast_start_date, prev.broadcast_end_date;
$$;
comment on function get_previous_drama_baseline is '같은 채널에서 지정한 날짜 이전에 방영이 끝난 가장 최근 "오리지널 드라마" 카테고리 작품의 전체 방영 기간 평균 시청률(2026-08-21, 신규 드라마 1~2회 비교용).';

-- 2) get_original_content_daily에 prev_drama_* 4개 컬럼 추가.
drop function if exists get_original_content_daily(date);

create function get_original_content_daily(p_as_of_date date)
returns table (
  day_of_week_iso int,
  whitelist_program_name text,
  broadcast_channel_code text,
  expected_time time,
  note text,
  matched_program_name text,
  matched_start_time time,
  matched_end_time time,
  matched_rating numeric,
  matched_share numeric,
  featured_category text,
  rerun_channel_code text,
  rerun_program_name text,
  rerun_start_time time,
  rerun_rating numeric,
  retention_pct numeric,
  pre_rerun_start_time time,
  pre_rerun_rating numeric,
  self_rerun_start_time time,
  self_rerun_rating numeric,
  prior_occurrence_date date,
  prior_occurrence_rating numeric,
  prior_rating_change_pct numeric,
  episode_number int,
  latest_n_avg_rating numeric,
  latest_n_count int,
  latest_n_change_pct numeric,
  prev_drama_name text,
  prev_drama_avg_rating numeric,
  prev_drama_episode_count int,
  prev_drama_change_pct numeric
)
language sql
stable
as $$
  with whitelist as (
    select
      w.*,
      c.code as broadcast_channel_code,
      rc.code as rerun_channel_code_val,
      case
        when c.primary_target ilike '%유료방송가입가구%' then '전국 유료가구'
        else trim(replace(c.primary_target, '개인', ''))
      end as program_target_label
    from original_review_programs w
    join channels c on c.id = w.broadcast_channel_id
    left join channels rc on rc.id = w.rerun_channel_id
    where w.day_of_week_iso = extract(isodow from p_as_of_date)::int
  ),
  matched as (
    select
      w.*,
      p_as_of_date - (case when w.broadcast_time < time '02:00:00' then 1 else 0 end) as effective_date,
      m.canonical_name as matched_program_name,
      m.start_time as matched_start_time,
      m.end_time as matched_end_time,
      m.rating as matched_rating,
      m.share as matched_share
    from whitelist w
    left join lateral (
      select p.canonical_name, r.start_time, r.end_time, r.rating, r.share
      from ratings r
      join programs p on p.id = r.program_id
      join targets t on t.id = r.target_id
      where r.channel_id = w.broadcast_channel_id
        and r.source_type = 'nielsen_daily'
        and r.broadcast_date = p_as_of_date - (case when w.broadcast_time < time '02:00:00' then 1 else 0 end)
        and r.program_id is not null
        and w.broadcast_time is not null
        and t.label = w.program_target_label
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
    fc.category as featured_category,
    m.rerun_channel_code_val as rerun_channel_code,
    rr.canonical_name as rerun_program_name,
    rr.start_time as rerun_start_time,
    rr.rating as rerun_rating,
    case when m.matched_rating is not null and m.matched_rating > 0 and rr.rating is not null
      then round((rr.rating / m.matched_rating * 100)::numeric, 1) else null end as retention_pct,
    pre.start_time as pre_rerun_start_time,
    pre.rating as pre_rerun_rating,
    self_r.start_time as self_rerun_start_time,
    self_r.rating as self_rerun_rating,
    prior.broadcast_date as prior_occurrence_date,
    prior.rating as prior_occurrence_rating,
    pct_change(m.matched_rating, prior.rating) as prior_rating_change_pct,
    get_episode_number(m.matched_program_name, m.effective_date) as episode_number,
    round(recent_n.avg_rating::numeric, 5) as latest_n_avg_rating,
    recent_n.cnt::int as latest_n_count,
    pct_change(m.matched_rating, recent_n.avg_rating) as latest_n_change_pct,
    prevd.program_name as prev_drama_name,
    prevd.avg_rating as prev_drama_avg_rating,
    prevd.episode_count as prev_drama_episode_count,
    pct_change(m.matched_rating, prevd.avg_rating) as prev_drama_change_pct
  from matched m
  left join lateral (
    select fc.category, fc.broadcast_start_date
    from featured_content fc
    join programs fp on fp.id = fc.program_id
    where m.matched_program_name is not null
      and replace(fp.canonical_name, ' ', '') = replace(m.matched_program_name, ' ', '')
    limit 1
  ) fc on true
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
      and t2.label = m.program_target_label
      and (extract(epoch from r2.start_time) + case when extract(hour from r2.start_time) < 2 then 86400 else 0 end)
          > (extract(epoch from m.matched_start_time) + case when extract(hour from m.matched_start_time) < 2 then 86400 else 0 end)
    order by (extract(epoch from r2.start_time) + case when extract(hour from r2.start_time) < 2 then 86400 else 0 end) asc
    limit 1
  ) rr on true
  left join lateral (
    select r3.start_time, r3.rating
    from ratings r3
    join programs p3 on p3.id = r3.program_id
    join targets t3 on t3.id = r3.target_id
    where m.matched_program_name is not null
      and r3.channel_id = m.broadcast_channel_id
      and r3.source_type = 'nielsen_daily'
      and r3.broadcast_date = m.effective_date
      and r3.program_id is not null
      and t3.label = m.program_target_label
      and replace(p3.canonical_name, ' ', '') = replace(m.matched_program_name, ' ', '')
      and r3.start_time < m.matched_start_time
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
      and t4.label = m.program_target_label
      and replace(p4.canonical_name, ' ', '') = replace(m.matched_program_name, ' ', '')
      and (extract(epoch from r4.start_time) + case when extract(hour from r4.start_time) < 2 then 86400 else 0 end)
          > (extract(epoch from m.matched_end_time) + case when extract(hour from m.matched_end_time) < 2 then 86400 else 0 end)
    order by (extract(epoch from r4.start_time) + case when extract(hour from r4.start_time) < 2 then 86400 else 0 end) asc
    limit 1
  ) self_r on true
  left join lateral (
    select r5.broadcast_date, r5.rating
    from ratings r5
    join programs p5 on p5.id = r5.program_id
    join targets t5 on t5.id = r5.target_id
    where m.matched_program_name is not null
      and r5.channel_id = m.broadcast_channel_id
      and r5.source_type = 'nielsen_daily'
      and r5.program_id is not null
      and t5.label = m.program_target_label
      and replace(p5.canonical_name, ' ', '') = replace(m.matched_program_name, ' ', '')
      and r5.broadcast_date < m.effective_date
      and r5.broadcast_date >= m.effective_date - 21
      and m.broadcast_time is not null
      and least(
            abs(extract(epoch from (r5.start_time - m.broadcast_time))),
            86400 - abs(extract(epoch from (r5.start_time - m.broadcast_time)))
          ) <= 600
    order by r5.broadcast_date desc
    limit 1
  ) prior on true
  left join lateral (
    select avg(rr6.rating) as avg_rating, count(*) as cnt
    from (
      select r6.rating
      from ratings r6
      join programs p6 on p6.id = r6.program_id
      join targets t6 on t6.id = r6.target_id
      where m.matched_program_name is not null
        and r6.channel_id = m.broadcast_channel_id
        and r6.source_type = 'nielsen_daily'
        and r6.program_id is not null
        and t6.label = m.program_target_label
        and replace(p6.canonical_name, ' ', '') = replace(m.matched_program_name, ' ', '')
        and r6.broadcast_date < m.effective_date
        and m.broadcast_time is not null
        and least(
              abs(extract(epoch from (r6.start_time - m.broadcast_time))),
              86400 - abs(extract(epoch from (r6.start_time - m.broadcast_time)))
            ) <= 600
      order by r6.broadcast_date desc
      limit 12
    ) rr6
  ) recent_n on true
  -- 신규 드라마 1~2회차만 계산(회차가 많아지면 latest_n_avg_rating이 이미 자기 작품 기준
  -- 비교를 제공하므로 직전 작품 비교는 굳이 필요 없다 — 사용자 지시 그대로).
  left join lateral (
    select *
    from get_previous_drama_baseline(m.broadcast_channel_id, m.program_target_label, fc.broadcast_start_date)
    where fc.category = '오리지널 드라마'
      and fc.broadcast_start_date is not null
      and get_episode_number(m.matched_program_name, m.effective_date) <= 2
  ) prevd on true
  where m.matched_program_name is not null
  order by m.sort_order;
$$;
comment on function get_original_content_daily is 'Page 1 Original 리포트(평일): 화이트리스트를 실제 방영 데이터(±10분 매칭, 채널 KPI 타깃 고정)와 연결. 직후재방·선행 재방·당일 자체 재방·직전 방영 대비(전회 대비)·회차 번호·최신 최대 12회차 평균 대비·신규 드라마(1~2회)의 직전 작품 평균 대비(2026-08-21 추가)까지 포함.';

-- 3) get_featured_content_only_daily도 동일하게 prev_drama_* 4개 컬럼 추가.
drop function if exists get_featured_content_only_daily(date);

create function get_featured_content_only_daily(p_as_of_date date)
returns table (
  day_of_week_iso int,
  whitelist_program_name text,
  broadcast_channel_code text,
  expected_time time,
  note text,
  matched_program_name text,
  matched_start_time time,
  matched_end_time time,
  matched_rating numeric,
  matched_share numeric,
  featured_category text,
  rerun_channel_code text,
  rerun_program_name text,
  rerun_start_time time,
  rerun_rating numeric,
  retention_pct numeric,
  pre_rerun_start_time time,
  pre_rerun_rating numeric,
  self_rerun_start_time time,
  self_rerun_rating numeric,
  prior_occurrence_date date,
  prior_occurrence_rating numeric,
  prior_rating_change_pct numeric,
  episode_number int,
  latest_n_avg_rating numeric,
  latest_n_count int,
  latest_n_change_pct numeric,
  prev_drama_name text,
  prev_drama_avg_rating numeric,
  prev_drama_episode_count int,
  prev_drama_change_pct numeric
)
language sql
stable
as $$
  with day_map(label, iso) as (
    values ('월',1),('화',2),('수',3),('목',4),('금',5),('토',6),('일',7)
  ),
  candidates as (
    select
      fc.id as featured_id,
      fc.category,
      fc.broadcast_time,
      fc.broadcast_start_date,
      fp.canonical_name,
      c.id as channel_id,
      c.code as broadcast_channel_code,
      p_as_of_date - (case when fc.broadcast_time < time '02:00:00' then 1 else 0 end) as effective_date,
      case
        when c.primary_target ilike '%유료방송가입가구%' then '전국 유료가구'
        else trim(replace(c.primary_target, '개인', ''))
      end as program_target_label,
      extract(isodow from p_as_of_date)::int as dow_iso
    from featured_content fc
    join programs fp on fp.id = fc.program_id
    join channels c on c.id = fp.channel_id
    join lateral unnest(fc.broadcast_day_of_week) as wd(label) on true
    join day_map dm on dm.label = wd.label
    where fc.broadcast_time is not null
      and dm.iso = extract(isodow from p_as_of_date)::int
      and (fc.broadcast_start_date is null or fc.broadcast_start_date <= p_as_of_date)
      and (fc.broadcast_end_date is null or fc.broadcast_end_date >= p_as_of_date)
      -- 이미 오늘 화이트리스트(original_review_programs)에 같은 프로그램이 등록돼 있으면
      -- get_original_content_daily가 이미 다루므로 중복 표시하지 않는다.
      and not exists (
        select 1 from original_review_programs w
        where w.day_of_week_iso = extract(isodow from p_as_of_date)::int
          and replace(w.program_name, ' ', '') = replace(fp.canonical_name, ' ', '')
      )
  ),
  matched as (
    select
      cand.*,
      m.canonical_name as matched_program_name,
      m.start_time as matched_start_time,
      m.end_time as matched_end_time,
      m.rating as matched_rating,
      m.share as matched_share
    from candidates cand
    left join lateral (
      select p.canonical_name, r.start_time, r.end_time, r.rating, r.share
      from ratings r
      join programs p on p.id = r.program_id
      join targets t on t.id = r.target_id
      where r.channel_id = cand.channel_id
        and r.source_type = 'nielsen_daily'
        and r.broadcast_date = cand.effective_date
        and r.program_id is not null
        and t.label = cand.program_target_label
        and least(
              abs(extract(epoch from (r.start_time - cand.broadcast_time))),
              86400 - abs(extract(epoch from (r.start_time - cand.broadcast_time)))
            ) <= 600 -- ±10분
      order by least(
              abs(extract(epoch from (r.start_time - cand.broadcast_time))),
              86400 - abs(extract(epoch from (r.start_time - cand.broadcast_time)))
            ) asc
      limit 1
    ) m on true
  )
  select
    m.dow_iso as day_of_week_iso,
    m.canonical_name as whitelist_program_name,
    m.broadcast_channel_code,
    m.broadcast_time as expected_time,
    null::text as note,
    m.matched_program_name,
    m.matched_start_time,
    m.matched_end_time,
    m.matched_rating,
    m.matched_share,
    m.category as featured_category,
    null::text as rerun_channel_code,
    null::text as rerun_program_name,
    null::time as rerun_start_time,
    null::numeric as rerun_rating,
    null::numeric as retention_pct,
    null::time as pre_rerun_start_time,
    null::numeric as pre_rerun_rating,
    null::time as self_rerun_start_time,
    null::numeric as self_rerun_rating,
    prior.broadcast_date as prior_occurrence_date,
    prior.rating as prior_occurrence_rating,
    pct_change(m.matched_rating, prior.rating) as prior_rating_change_pct,
    get_episode_number(m.matched_program_name, m.effective_date) as episode_number,
    round(recent_n.avg_rating::numeric, 5) as latest_n_avg_rating,
    recent_n.cnt::int as latest_n_count,
    pct_change(m.matched_rating, recent_n.avg_rating) as latest_n_change_pct,
    prevd.program_name as prev_drama_name,
    prevd.avg_rating as prev_drama_avg_rating,
    prevd.episode_count as prev_drama_episode_count,
    pct_change(m.matched_rating, prevd.avg_rating) as prev_drama_change_pct
  from matched m
  left join lateral (
    select r5.broadcast_date, r5.rating
    from ratings r5
    join programs p5 on p5.id = r5.program_id
    join targets t5 on t5.id = r5.target_id
    where m.matched_program_name is not null
      and r5.channel_id = m.channel_id
      and r5.source_type = 'nielsen_daily'
      and r5.program_id is not null
      and t5.label = m.program_target_label
      and replace(p5.canonical_name, ' ', '') = replace(m.matched_program_name, ' ', '')
      and r5.broadcast_date < m.effective_date
      and r5.broadcast_date >= m.effective_date - 21
      and least(
            abs(extract(epoch from (r5.start_time - m.broadcast_time))),
            86400 - abs(extract(epoch from (r5.start_time - m.broadcast_time)))
          ) <= 600
    order by r5.broadcast_date desc
    limit 1
  ) prior on true
  left join lateral (
    select avg(rr6.rating) as avg_rating, count(*) as cnt
    from (
      select r6.rating
      from ratings r6
      join programs p6 on p6.id = r6.program_id
      join targets t6 on t6.id = r6.target_id
      where m.matched_program_name is not null
        and r6.channel_id = m.channel_id
        and r6.source_type = 'nielsen_daily'
        and r6.program_id is not null
        and t6.label = m.program_target_label
        and replace(p6.canonical_name, ' ', '') = replace(m.matched_program_name, ' ', '')
        and r6.broadcast_date < m.effective_date
        and least(
              abs(extract(epoch from (r6.start_time - m.broadcast_time))),
              86400 - abs(extract(epoch from (r6.start_time - m.broadcast_time)))
            ) <= 600
      order by r6.broadcast_date desc
      limit 12
    ) rr6
  ) recent_n on true
  left join lateral (
    select *
    from get_previous_drama_baseline(m.channel_id, m.program_target_label, m.broadcast_start_date)
    where m.category = '오리지널 드라마'
      and m.broadcast_start_date is not null
      and get_episode_number(m.matched_program_name, m.effective_date) <= 2
  ) prevd on true
  where m.matched_program_name is not null;
$$;
comment on function get_featured_content_only_daily is '주요 콘텐츠 관리(featured_content)에 등록된 모든 타이틀 중 original_review_programs 화이트리스트에는 없는 것만, 등록된 요일·시간을 본방송으로 인식해 get_original_content_daily와 같은 컬럼 모양(전회 대비·최신 최대 12회차 평균·회차 번호·신규 드라마 직전 작품 평균 대비 포함)으로 반환한다. API에서 두 함수 결과를 그대로 이어붙여 하나의 Original 리포트로 보여준다(2026-08-20/21 사용자 지시).';
