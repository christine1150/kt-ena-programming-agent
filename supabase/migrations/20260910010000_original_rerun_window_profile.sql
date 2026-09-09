-- 오리지널 본방/재방 창 합산 + 본방·재방 효율(2026-09-10, 사용자 지시)
--
-- 사용자 지시: "ENA는 <본>이 적혀있는 본방송과 재방송 효율도 생각해야 하고, 주요 프로그램에
-- 등록되어 있는 오리지널은 본방송, 재방송, 직후 재방, 당일 재방, 1주일 내 방영 합산 등도
-- 고려해야 함."
--
-- 실측으로 확인한 데이터 현실(2026-09-10):
--   · `<본>` 태그는 ENA 채널에만 있다 — 2026-06~09 프로그램 행 기준 ENA is_first_run=true
--     1,853건, 나머지 6채널은 전부 0건. is_first_run=false는 어느 채널에도 없다(재방은
--     "태그 없음"으로만 구분됨).
--   · 따라서 ENA는 태그로 본방을 직접 가릴 수 있고, 나머지 채널은 featured_content(주요 콘텐츠
--     관리) 화이트리스트 + 방영 시각 ±10분 매칭에 의존해야 한다 — 기존 get_original_content_daily가
--     쓰는 것과 정확히 같은 방식을 그대로 복사한다(새 판정 로직을 발명하지 않음).
--
-- 기존 get_original_content_daily는 단일 일자 전용(38컬럼)이라 기간 리포트에 쓸 수 없다.
-- 이 마이그레이션은 그 판정 규칙을 그대로 유지한 채 "기간 전체"로 확장한 집계 2종을 낸다.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) 오리지널 본방/재방 창 프로파일
--
-- featured_content에 등록된 작품마다 기간 안의 본방 회차를 찾아, 그 회차를 기준으로
--   · 본방(홈 채널, 등록 요일·시각 ±10분)
--   · 동시방영(simulcast 채널, 본방 시작 ±30분 — get_original_content_daily와 동일 기준)
--   · 직후 재방(rerun 채널, 본방 종료 이후 같은 날 첫 방영)
--   · 당일 자체 재방(홈 채널, 본방 종료 이후 같은 날)
--   · 1주일 내 방영 합산(홈·동시방영·재방 채널에서 본방일~+6일 사이 그 작품의 모든 방영분)
-- 을 모아 작품 단위로 집계한다.
--
-- 1주일 창의 중복 계산 방지: 주 2회 편성(예: 월·화 드라마)은 본방 창이 서로 겹치므로 같은
-- 방영분이 두 번 세어질 수 있다. ratings.id로 distinct를 걸어 한 방영분은 정확히 한 번만
-- 합산한다 — 합산 수치가 부풀지 않게 하는 핵심.
create or replace function get_channel_original_rerun_profile(
  p_channel_code text,
  p_program_target_label text,
  p_date_from date,
  p_date_to date,
  p_window_days int default 7
)
returns table (
  canonical_name text,
  category text,
  home_channel_code text,
  simulcast_channel_code text,
  rerun_channel_code text,
  live_episodes int,
  live_avg_rating numeric,
  live_avg_reach numeric,
  live_avg_time_spent_share numeric,
  simulcast_episodes int,
  simulcast_avg_rating numeric,
  rerun_episodes int,
  rerun_avg_rating numeric,
  rerun_retention_pct numeric,
  immediate_rerun_episodes int,
  same_day_rerun_episodes int,
  self_rerun_episodes int,
  self_rerun_avg_rating numeric,
  window_airings int,
  window_sum_rating numeric,
  window_avg_rating numeric,
  amplification_ratio numeric
)
language sql
stable
as $$
  -- featured_content에는 같은 작품이 띄어쓰기만 다르게 두 번 등록된 사례가 실재한다
  -- (예: "그대에게드림"/"그대에게 드림", "제비탐정장성규"/"제비탐정 장성규").
  -- 중복을 그대로 두면 본방 회차가 두 배로 세어지므로, 정규화 이름 기준으로 먼저 하나만 남긴다.
  with reg_all as (
    select
      fc.program_id as pid,
      p.canonical_name as cn,
      regexp_replace(p.canonical_name, '[^가-힣a-zA-Z0-9]', '', 'g') as norm,
      p.channel_id as home_id,
      hc.code as home_code,
      fc.category as cat,
      fc.broadcast_day_of_week as dows,
      fc.broadcast_time as btime,
      fc.simulcast_channel_id as sim_id,
      fc.rerun_channel_id as rr_id,
      sc.code as sim_code,
      rc.code as rr_code
    from featured_content fc
    join programs p on p.id = fc.program_id
    join channels hc on hc.id = p.channel_id
    left join channels sc on sc.id = fc.simulcast_channel_id
    left join channels rc on rc.id = fc.rerun_channel_id
    where hc.code = p_channel_code
      and fc.broadcast_time is not null
      and fc.broadcast_day_of_week is not null
      and fc.broadcast_start_date <= p_date_to
      and (fc.broadcast_end_date is null or fc.broadcast_end_date >= p_date_from)
  ),
  reg as (
    select distinct on (ra.norm) ra.*
    from reg_all ra
    -- 재방/동시방영 채널이 등록된 쪽을 우선 남긴다(정보가 더 많은 등록을 택함).
    order by ra.norm, (ra.rr_id is not null or ra.sim_id is not null) desc, ra.pid
  ),
  dts as (
    select d::date as dt
    from generate_series(p_date_from, p_date_to, interval '1 day') d
  ),
  -- 등록 요일과 일치하는 날짜만 본방 후보로 둔다.
  slots as (
    select g.*, d.dt as dt
    from reg g
    cross join dts d
    where (array['월', '화', '수', '목', '금', '토', '일'])[extract(isodow from d.dt)::int] = any(g.dows)
  ),
  -- 본방 실제 매칭 — 홈 채널·그날·등록 시각 ±10분·정규화 이름 일치(기존 관례 그대로).
  live as (
    select
      s.pid, s.cn, s.norm, s.home_id, s.home_code, s.cat, s.sim_id, s.rr_id, s.sim_code, s.rr_code,
      s.dt as dt,
      r.start_time as l_start,
      r.end_time as l_end,
      r.rating as l_rating,
      r.reach as l_reach,
      r.time_spent_share as l_tss
    from slots s
    join ratings r
      on r.channel_id = s.home_id
     and r.broadcast_date = s.dt
     and r.source_type = 'nielsen_daily'
     and r.program_id is not null
     and r.rating is not null
     and r.start_time is not null
    join programs p2 on p2.id = r.program_id
    join targets t on t.id = r.target_id
    where t.label = p_program_target_label
      and regexp_replace(p2.canonical_name, '[^가-힣a-zA-Z0-9]', '', 'g') = s.norm
      and abs(extract(epoch from (r.start_time - s.btime))) <= 600
  ),
  -- 각 본방 회차에 딸린 동시방영·직후재방·자체재방을 lateral로 붙인다.
  enriched as (
    select
      l.*,
      sim.rating as sim_rating,
      rr.rating as rr_rating,
      rr.start_time as rr_start,
      rr_gap.other_between as rr_other_between,
      selfr.rating as self_rating
    from live l
    left join lateral (
      select r9.rating
      from ratings r9
      join programs p9 on p9.id = r9.program_id
      join targets t9 on t9.id = r9.target_id
      where l.sim_id is not null
        and r9.channel_id = l.sim_id
        and r9.broadcast_date = l.dt
        and r9.source_type = 'nielsen_daily'
        and r9.program_id is not null
        and t9.label = p_program_target_label
        and regexp_replace(p9.canonical_name, '[^가-힣a-zA-Z0-9]', '', 'g') = l.norm
        and abs(extract(epoch from (r9.start_time - l.l_start))) <= 1800
      order by abs(extract(epoch from (r9.start_time - l.l_start))) asc
      limit 1
    ) sim on true
    left join lateral (
      select r2.rating, r2.start_time
      from ratings r2
      join programs p2b on p2b.id = r2.program_id
      join targets t2 on t2.id = r2.target_id
      where l.rr_id is not null
        and r2.channel_id = l.rr_id
        and r2.broadcast_date = l.dt
        and r2.source_type = 'nielsen_daily'
        and r2.program_id is not null
        and r2.start_time > l.l_end
        and t2.label = p_program_target_label
        and regexp_replace(p2b.canonical_name, '[^가-힣a-zA-Z0-9]', '', 'g') = l.norm
      order by r2.start_time asc
      limit 1
    ) rr on true
    -- 직재방 vs 당일재방: 본방 종료~재방 시작 사이에 그 채널에서 다른 프로그램이 실제로
    -- 방영됐는지 직접 확인한다(추정 아님) — get_original_content_daily와 동일한 판정.
    left join lateral (
      select exists (
        select 1
        from ratings r2b
        join programs p2c on p2c.id = r2b.program_id
        where r2b.channel_id = l.rr_id
          and r2b.broadcast_date = l.dt
          and r2b.source_type = 'nielsen_daily'
          and r2b.program_id is not null
          and r2b.start_time > l.l_end
          and r2b.start_time < rr.start_time
          and regexp_replace(p2c.canonical_name, '[^가-힣a-zA-Z0-9]', '', 'g') <> l.norm
      ) as other_between
      where rr.start_time is not null
    ) rr_gap on true
    left join lateral (
      select r4.rating
      from ratings r4
      join programs p4 on p4.id = r4.program_id
      join targets t4 on t4.id = r4.target_id
      where r4.channel_id = l.home_id
        and r4.broadcast_date = l.dt
        and r4.source_type = 'nielsen_daily'
        and r4.program_id is not null
        and r4.start_time > l.l_end
        and t4.label = p_program_target_label
        and regexp_replace(p4.canonical_name, '[^가-힣a-zA-Z0-9]', '', 'g') = l.norm
      order by r4.start_time asc
      limit 1
    ) selfr on true
  ),
  -- 1주일 창: 본방일~+(window-1)일 사이 홈·동시방영·재방 채널의 그 작품 방영분 전부.
  -- ratings.id로 distinct를 걸어 본방 창이 겹쳐도 한 방영분은 한 번만 센다.
  win as (
    select distinct
      l.pid as pid,
      r5.id as rid,
      r5.rating as w_rating
    from live l
    join ratings r5
      on r5.channel_id in (l.home_id, coalesce(l.sim_id, l.home_id), coalesce(l.rr_id, l.home_id))
     and r5.broadcast_date between l.dt and (l.dt + (p_window_days - 1))
     and r5.source_type = 'nielsen_daily'
     and r5.program_id is not null
     and r5.rating is not null
    join programs p5 on p5.id = r5.program_id
    join targets t5 on t5.id = r5.target_id
    where t5.label = p_program_target_label
      and regexp_replace(p5.canonical_name, '[^가-힣a-zA-Z0-9]', '', 'g') = l.norm
  ),
  win_agg as (
    select w.pid as pid, count(*)::int as w_airings, sum(w.w_rating) as w_sum, avg(w.w_rating) as w_avg
    from win w
    group by w.pid
  )
  select
    e.cn,
    e.cat,
    e.home_code,
    e.sim_code,
    e.rr_code,
    count(*)::int,
    round(avg(e.l_rating)::numeric, 5),
    round(avg(e.l_reach)::numeric, 5),
    round(avg(e.l_tss)::numeric, 3),
    count(e.sim_rating)::int,
    round(avg(e.sim_rating)::numeric, 5),
    count(e.rr_rating)::int,
    round(avg(e.rr_rating)::numeric, 5),
    -- 재방 유지율 — 본방 대비 재방 시청률 비율(회차별로 낸 뒤 평균, 기존 retention_pct와 같은 정의).
    round(avg(case when e.rr_rating is not null and e.l_rating > 0
                   then e.rr_rating / e.l_rating * 100 end)::numeric, 1),
    count(*) filter (where e.rr_rating is not null and e.rr_other_between is not true)::int,
    count(*) filter (where e.rr_rating is not null and e.rr_other_between is true)::int,
    count(e.self_rating)::int,
    round(avg(e.self_rating)::numeric, 5),
    coalesce(max(wa.w_airings), 0),
    round(max(wa.w_sum)::numeric, 5),
    round(max(wa.w_avg)::numeric, 5),
    -- 확산 배수 — 1주일 창 합산 시청률 ÷ 본방 합산 시청률. 본방 1회분이 재방까지 포함해
    -- 실제로 몇 배의 시청을 벌었는지. 1.0이면 재방 기여가 없다는 뜻.
    round((max(wa.w_sum) / nullif(sum(e.l_rating), 0))::numeric, 2)
  from enriched e
  left join win_agg wa on wa.pid = e.pid
  group by e.pid, e.cn, e.cat, e.home_code, e.sim_code, e.rr_code
  order by avg(e.l_rating) desc nulls last;
$$;
comment on function get_channel_original_rerun_profile is
  '오리지널 본방/재방 창 프로파일(2026-09-10) — featured_content 등록 작품의 기간 내 본방 회차를 찾아 동시방영·직후재방·당일재방·자체재방·1주일 내 방영 합산을 작품 단위로 집계한다. 본방 매칭(등록 요일·시각 ±10분)과 직재방/당일재방 판정은 get_original_content_daily의 규칙을 그대로 복사했다. 1주일 창은 ratings.id로 distinct를 걸어 주 2회 편성의 창 겹침에도 방영분이 중복 합산되지 않는다. amplification_ratio는 1주일 창 합산 ÷ 본방 합산(재방 포함 확산 배수).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) 본방(<본> 태그) vs 재방 효율 — 채널 단위
--
-- 사용자 지시의 "ENA는 <본>이 적혀있는 본방송과 재방송 효율도 생각해야" 부분.
-- ratings.is_first_run이 true인 행만 본방으로 보고(=`<본>` 태그), 나머지는 "본방 외"로 묶는다.
-- is_first_run=false가 데이터에 존재하지 않으므로(실측) "재방"이라 단정하지 않고 "본방 외"로
-- 표기한다 — 태그가 없는 것과 재방인 것을 구분할 수 없기 때문(지어내지 않는다).
-- 태그가 아예 없는 채널(ENA 외 전부)은 tagged_first_run_airings가 0으로 나와, 호출부가
-- "이 채널은 본방 태그가 없어 구분 불가"로 정직하게 표시할 수 있다.
create or replace function get_channel_first_run_efficiency(
  p_channel_code text,
  p_program_target_label text,
  p_date_from date,
  p_date_to date,
  p_limit int default 40
)
returns table (
  canonical_name text,
  first_run_airings int,
  first_run_avg_rating numeric,
  first_run_avg_reach numeric,
  first_run_avg_time_spent_share numeric,
  other_airings int,
  other_avg_rating numeric,
  other_avg_reach numeric,
  other_avg_time_spent_share numeric,
  rerun_retention_pct numeric,
  total_airtime_min numeric
)
language sql
stable
as $$
  with base as (
    select
      p.canonical_name as cn,
      (r.is_first_run is true) as is_fr,
      (case when r.end_time > r.start_time
            then extract(epoch from (r.end_time - r.start_time)) / 60.0
            else extract(epoch from (r.end_time - r.start_time)) / 60.0 + 1440 end) as dur,
      r.rating as rt,
      r.reach as rc,
      r.time_spent_share as tshr
    from ratings r
    join channels c on c.id = r.channel_id
    join targets t on t.id = r.target_id
    join programs p on p.id = r.program_id
    where c.code = p_channel_code
      and t.label = p_program_target_label
      and r.source_type = 'nielsen_daily'
      and r.program_id is not null
      and r.rating is not null
      and r.start_time is not null
      and r.end_time is not null
      and r.broadcast_date between p_date_from and p_date_to
  ),
  agg as (
    select
      b.cn as cn,
      count(*) filter (where b.is_fr)::int as fr_air,
      sum(b.rt * b.dur) filter (where b.is_fr) / nullif(sum(b.dur) filter (where b.is_fr and b.rt is not null), 0) as fr_rt,
      sum(b.rc * b.dur) filter (where b.is_fr) / nullif(sum(b.dur) filter (where b.is_fr and b.rc is not null), 0) as fr_rc,
      sum(b.tshr * b.dur) filter (where b.is_fr) / nullif(sum(b.dur) filter (where b.is_fr and b.tshr is not null), 0) as fr_tshr,
      count(*) filter (where not b.is_fr)::int as ot_air,
      sum(b.rt * b.dur) filter (where not b.is_fr) / nullif(sum(b.dur) filter (where not b.is_fr and b.rt is not null), 0) as ot_rt,
      sum(b.rc * b.dur) filter (where not b.is_fr) / nullif(sum(b.dur) filter (where not b.is_fr and b.rc is not null), 0) as ot_rc,
      sum(b.tshr * b.dur) filter (where not b.is_fr) / nullif(sum(b.dur) filter (where not b.is_fr and b.tshr is not null), 0) as ot_tshr,
      sum(b.dur) as tot_dur
    from base b
    group by b.cn
  )
  select
    a.cn,
    a.fr_air,
    round(a.fr_rt::numeric, 5),
    round(a.fr_rc::numeric, 5),
    round(a.fr_tshr::numeric, 3),
    a.ot_air,
    round(a.ot_rt::numeric, 5),
    round(a.ot_rc::numeric, 5),
    round(a.ot_tshr::numeric, 3),
    round((100.0 * a.ot_rt / nullif(a.fr_rt, 0))::numeric, 1),
    round(a.tot_dur::numeric, 1)
  from agg a
  where a.fr_air > 0
  order by a.fr_rt desc nulls last
  limit p_limit;
$$;
comment on function get_channel_first_run_efficiency is
  '본방(<본> 태그) vs 본방 외 효율(2026-09-10) — ratings.is_first_run=true인 방영분과 그 외를 갈라 방영시간 가중 평균 시청률·도달율·시청시간 비율을 비교한다. rerun_retention_pct는 본방 대비 본방 외 시청률 비율(%). 실측상 `<본>` 태그는 ENA 채널에만 있으므로 다른 채널은 결과가 비고, 호출부는 "본방 태그 없음 — 구분 불가"로 정직하게 표시해야 한다. is_first_run=false가 데이터에 없어 "재방"으로 단정하지 않고 "본방 외"로 부른다.';
