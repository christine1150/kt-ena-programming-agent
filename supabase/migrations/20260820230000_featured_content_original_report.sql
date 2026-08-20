-- 사용자 지시(2026-08-20, 규칙 추가): "관리자 페이지 '주요 콘텐츠 관리' 목록에 있는 타이틀들은
-- 그 목록에 등록된 본방송 요일·시간을 본방송으로 인식하고, 회차가 여러 개면 최신 8~12회차
-- 평균과 본방을 비교하고, 1회부터 시작하는 신규 프로그램이면 1회~직전회차 평균과 비교하되,
-- 직전 회차와의 비교(전회 대비)도 항상 함께 보여줘야 한다." + "Page 1 Original 리포트에 통합,
-- featured_content에 등록된 모든 타이틀에 적용."
--
-- 1) get_original_content_daily에 "최신 최대 12회차 평균" 비교를 추가한다 — prior(직전 1회)
--    lateral과 같은 매칭 조건(채널·타깃·프로그램명·본방 등록 시각 ±10분)을 그대로 쓰되 LIMIT을
--    12로 늘려 평균·건수를 낸다. 아직 12회가 안 쌓인 신규 프로그램은 있는 만큼만(1회~직전회차)
--    평균 내므로 별도 분기 없이 이 하나의 쿼리로 두 케이스를 모두 만족한다. 전회 대비
--    (prior_rating_change_pct)는 기존 그대로 유지 — 두 비교가 동시에 나온다.
-- 2) featured_content(주요 콘텐츠 관리)는 지금까지 Original 리포트에 category 태그만 붙이는
--    용도였다 — original_review_programs(요일 별 리뷰 프로그램 화이트리스트)에 없는 featured_
--    content 타이틀도 같은 리포트에 나오도록 get_featured_content_only_daily를 새로 만든다.
--    본방 정의는 featured_content 자신의 broadcast_day_of_week(월~일 텍스트)·broadcast_time을
--    쓰고(관리자가 등록한 그대로, 패턴 추론 없음), get_original_content_daily와 같은 매칭·
--    최신 N회 평균·전회 대비·회차 번호(seed가 있으면) 컬럼을 그대로 반환해 API에서 두 결과를
--    그냥 이어붙이면 되게 한다. 이미 화이트리스트에 있는 타이틀은 중복 표시를 피하려고
--    (canonical_name 공백무시 비교) 제외한다.

-- 반환 컬럼 3개(latest_n_*)가 늘어나 create or replace만으로는 안 된다("cannot change return
-- type of existing function") — 먼저 지우고 새로 만든다.
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
  latest_n_change_pct numeric
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
    pct_change(m.matched_rating, recent_n.avg_rating) as latest_n_change_pct
  from matched m
  left join lateral (
    select fc.category
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
  -- 최신 최대 12회차 평균("본방 vs 최신 8~12회차 평균", 사용자 지시 2026-08-20) — prior와 같은
  -- 매칭 조건(±10분)으로 직전 회차들을 최대 12개까지 모아 평균·건수를 낸다. 아직 12회가 안
  -- 쌓인 신규 프로그램은 있는 만큼만 평균 내(=1회~직전회차 평균) 별도 분기 없이 동일 쿼리로
  -- 두 케이스를 모두 만족시킨다.
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
  where m.matched_program_name is not null
  order by m.sort_order;
$$;
comment on function get_original_content_daily is 'Page 1 Original 리포트(평일): 화이트리스트를 실제 방영 데이터(±10분 매칭, 채널 KPI 타깃 고정)와 연결. 직후재방·선행 재방·당일 자체 재방·직전 방영 대비(전회 대비)·회차 번호·최신 최대 12회차 평균 대비(2026-08-20 추가)까지 포함.';

-- featured_content(주요 콘텐츠 관리) 자체 등록 타이틀 전체용 — original_review_programs
-- 화이트리스트에 없는 것만(중복 방지) get_original_content_daily와 같은 컬럼 모양으로 반환한다.
create or replace function get_featured_content_only_daily(p_as_of_date date)
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
  latest_n_change_pct numeric
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
    pct_change(m.matched_rating, recent_n.avg_rating) as latest_n_change_pct
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
  where m.matched_program_name is not null;
$$;
comment on function get_featured_content_only_daily is '주요 콘텐츠 관리(featured_content)에 등록된 모든 타이틀 중 original_review_programs 화이트리스트에는 없는 것만, 등록된 요일·시간을 본방송으로 인식해 get_original_content_daily와 같은 컬럼 모양(전회 대비·최신 최대 12회차 평균·회차 번호 포함)으로 반환한다. API에서 두 함수 결과를 그대로 이어붙여 하나의 Original 리포트로 보여준다(2026-08-20 사용자 지시).';
