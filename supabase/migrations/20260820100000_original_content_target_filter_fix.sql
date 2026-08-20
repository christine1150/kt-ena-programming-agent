-- 검증 중 실데이터로 발견한 버그(사용자가 요청한 수정과는 별개, 이번에 같이 고침): 프로그램
-- 단위 "OOO타깃상세" 시트는 같은 시작/종료시각의 프로그램 블록에 대해 P2049/여20대/남20대 등
-- 17개 안팎의 서로 다른 타깃 행이 나란히 저장돼 있는데, get_original_content_daily의 매칭
-- CTE와 재방/선행재방/당일재방/직전방영 lateral join 전부가 target_id를 전혀 걸지 않고
-- LIMIT 1만 걸어서, Postgres가 우연히 먼저 돌려주는 아무 타깃의 시청률을 가져오고 있었다
-- (channels.primary_target의 KPI 타깃과 무관하게 뒤섞일 수 있었음 — 실제로 ENA Play 재방
-- rating이 P2049(0.15 근방)가 아니라 다른 타깃의 값이 나오는 걸 직접 확인). 채널의 KPI 타깃
-- (channels.primary_target)을 타깃상세 시트 표기로 변환해(src/lib/targetResolution.ts의
-- resolveProgramLevelTargetLabel과 동일 규칙, SQL로 그대로 복제) 모든 조회에 일관되게 건다.
create or replace function get_original_content_daily(p_as_of_date date)
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
  episode_number int
)
language sql
stable
as $$
  with whitelist as (
    select
      w.*,
      c.code as broadcast_channel_code,
      rc.code as rerun_channel_code_val,
      -- resolveProgramLevelTargetLabel(TS)와 동일 규칙: "유료방송가입가구"면 "전국 유료가구",
      -- 아니면 "개인"만 빼고 trim (예: "수도권 개인2049" → "수도권 2049").
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
    get_episode_number(m.matched_program_name, m.effective_date) as episode_number
  from matched m
  left join lateral (
    select fc.category
    from featured_content fc
    join programs fp on fp.id = fc.program_id
    where m.matched_program_name is not null
      and replace(fp.canonical_name, ' ', '') = replace(m.matched_program_name, ' ', '')
    limit 1
  ) fc on true
  -- 직후재방(다른 채널, 보통 ENA Play) — "본방 시작시각 이후 그 채널에 편성된 첫 프로그램"
  -- (이름 불문, 단 KPI 타깃은 우리 채널과 동일하게 고정). day-boundary-safe 시각 비교.
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
  -- 선행 재방(같은 채널, 본방 시작 전) — 예: 22:30 본방 전 20:36에 전주 회차를 먼저 방영.
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
  -- 당일 자체 재방(같은 채널, 본방 종료 후) — 예: 22:30~24:14 본방 종료 후 24:33에 자체 재방.
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
  -- 직전 방영일 실적("전회 대비" 비교용) — 같은 화이트리스트 프로그램·채널·타깃의 가장 최근
  -- 이전 본방 매칭(최대 21일 전까지 탐색, 결방 주가 있어도 어느 정도 버티도록).
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
  where m.matched_program_name is not null -- 화이트리스트에는 있지만 실제로 방영된 게 없으면(조건부 편성 등) 조용히 제외
  order by m.sort_order;
$$;
comment on function get_original_content_daily is 'Page 1 Original 리포트(평일): 화이트리스트를 실제 방영 데이터(±10분 매칭, 채널 KPI 타깃 고정)와 연결. 직후재방(다른 채널, 본방 시작 이후 첫 편성)·선행 재방·당일 자체 재방·직전 방영 대비·회차 번호까지 포함.';
