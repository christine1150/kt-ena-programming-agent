-- 사용자 신고(2026-09-02): "Target Affinity가 채널별로 모든 프로그램이 똑같은 숫자인 것은
-- 말이 안 돼 — OLIFE는 다 0, ONCE는 다 100." 확인 결과 버그가 맞다.
--
-- 근본 원인: get_target_affinity()는 애초에 program_id를 전혀 받지 않는 "채널 하루 전체 집계"
-- 전용 함수다(r.program_id is null 행만 조회). refresh_fit_score_mart()는 이 값을 채널당 딱 1번
-- (대표 연령대 4개 평균)만 계산해 tmp_channel_affinity/channel_affinity_snapshot에 채널 단위로
-- 저장하고, 최종 INSERT에서 그 채널의 모든 프로그램 행에 동일한 percent_rank(6개 채널 중 순위)
-- 값을 그대로 복사해 넣고 있었다 — 그래서 한 채널 안의 모든 프로그램이 항상 같은 값(그리고
-- 6채널 percent_rank라 0/20/40/60/80/100 중 하나로 뭉쳐 보임)이 나왔다.
--
-- 더 확인해보니 mart_program_target_score 테이블 자체는 애초부터(20260819140000, Day 1)
-- program_id 단위로 affinity_index/target_affinity_score 컬럼을 갖고 있었다(테이블 코멘트도
-- "Program×Target 단위 Target Performance/Target Affinity/..."로 명시) — 그런데 실제 채우는
-- 로직은 한 번도 이 컬럼을 쓰지 않고 채널 단위 우회 경로로만 계산해왔다. 즉 테이블 설계는
-- 프로그램 단위였는데 구현이 그걸 따라가지 못한 것 — 이번에 그 설계 의도대로 고친다.
--
-- 수정: 채널의 핵심 연령대(기존 demo_metro/demo_national 4개, 그대로 재사용) 평균 시청률을
-- "프로그램별로" 조회해(ratings.program_id is not null 행, 이미 여러 곳에서 쓰는 패턴) 그
-- 프로그램 자신의 주타깃 평균 시청률(avg_rating, 이미 계산됨)로 나눈 비율 = 그 프로그램의
-- "핵심 연령대 구성비". 이 비율을 채널 내 자기 프로그램들끼리 percentile로 매긴다 —
-- Target Performance/Audience Engagement/Slot Performance와 완전히 같은 방식("채널 내 상대
-- 순위")이라 프로그램마다 다른 값이 나오고, 동시에 나머지 5개 하위지표와 계산 방법론이
-- 일관돼진다.
--
-- get_target_affinity() RPC 자체와 channel_affinity_snapshot 테이블은 건드리지 않는다 —
-- /api/ratings/affinity·자연어 에이전트가 "채널 A가 채널 B보다 이 연령대에 얼마나 더 강한가"
-- 같은 별개 질문에 계속 쓰고 있다(이번 수정은 Fit Score의 target_affinity_score 계산 방식만
-- 바꾼다). channel_affinity_snapshot은 이제 refresh_fit_score_mart()가 채우지 않게 되어
-- 조용히 미사용 상태가 되지만, 다른 목적으로 다시 쓰일 수 있어 테이블 자체는 삭제하지 않는다.

drop function if exists refresh_fit_score_mart(date, int, text);

create or replace function refresh_fit_score_mart(
  p_as_of_date date default current_date,
  p_window_days int default 84, -- 최근 12주
  p_channel_code text default null -- null이면 기존과 동일하게 전체 채널
)
returns void
language plpgsql
as $$
declare
  v_window_from date := p_as_of_date - (p_window_days - 1);
  v_recent_from date := p_as_of_date - 27;   -- 최근 4주
  v_prior_from date := p_as_of_date - 83;    -- 이전 8주 시작
  v_prior_to date := p_as_of_date - 28;      -- 이전 8주 끝
  v_target_channel_id uuid;
  rec_channel record;
  v_program_target_id uuid;
  v_matched_target_id uuid;
  v_is_national boolean;
  v_achievement record;
  v_demo_list text[];
  v_recent_cp record;
  v_prior_cp record;
  v_cp record;
  v_cfg record;
  demo_metro text[] := array['수도권 여20대','수도권 남20대','수도권 여40대','수도권 남40대'];
  demo_national text[] := array['전국 여20대','전국 남20대','전국 여40대','전국 남40대'];
begin
  perform set_config('statement_timeout', '300000', true);

  if p_channel_code is not null then
    select id into v_target_channel_id from channels where code = p_channel_code;
  end if;

  delete from mart_scheduling_fit_score where as_of_date = p_as_of_date and (v_target_channel_id is null or channel_id = v_target_channel_id);
  delete from mart_program_target_score where as_of_date = p_as_of_date and (v_target_channel_id is null or channel_id = v_target_channel_id);
  delete from mart_slot_score where as_of_date = p_as_of_date and (v_target_channel_id is null or channel_id = v_target_channel_id);
  delete from mart_competitive_score where as_of_date = p_as_of_date and (v_target_channel_id is null or channel_id = v_target_channel_id);
  delete from mart_flow_score where as_of_date = p_as_of_date and (v_target_channel_id is null or channel_id = v_target_channel_id);

  for rec_channel in
    select c.id, c.code, c.market, c.primary_target
    from channels c
    where c.code <> 'SKYUHD' and c.primary_target is not null
      and (p_channel_code is null or c.code = p_channel_code)
  loop
    select id into v_program_target_id
    from targets where label = resolve_program_target_label(rec_channel.primary_target);

    select * into v_achievement
    from get_target_achievement(rec_channel.code, v_window_from, p_as_of_date, extract(year from p_as_of_date)::int);
    if v_achievement.matched_target_label is not null then
      select id into v_matched_target_id from targets where label = v_achievement.matched_target_label;
    else
      v_matched_target_id := null;
    end if;

    if v_program_target_id is null then
      continue;
    end if;

    v_is_national := rec_channel.market = '전국';
    v_demo_list := case when v_is_national then demo_national else demo_metro end;

    if v_matched_target_id is not null then
      begin
        select * into v_cp from get_competitive_pressure(rec_channel.code, v_achievement.matched_target_label, v_window_from, p_as_of_date);
        select * into v_recent_cp from get_competitive_pressure(rec_channel.code, v_achievement.matched_target_label, v_recent_from, p_as_of_date);
        select * into v_prior_cp from get_competitive_pressure(rec_channel.code, v_achievement.matched_target_label, v_prior_from, v_prior_to);

        insert into mart_competitive_score (
          as_of_date, channel_id, target_id, our_avg_rating, top3_avg_rating, competitive_pressure,
          gap_score, trend_score, competitive_opportunity_score
        )
        values (
          p_as_of_date, rec_channel.id, v_matched_target_id, v_cp.our_avg_rating, v_cp.top3_avg_rating, v_cp.competitive_pressure,
          case when v_cp.top3_avg_rating is not null and v_cp.top3_avg_rating <> 0 and v_cp.our_avg_rating is not null
            then round((greatest(-100, least(100, (v_cp.our_avg_rating - v_cp.top3_avg_rating) / v_cp.top3_avg_rating * 100)) + 100) / 2, 1)
            else 50
          end,
          case when v_prior_cp.competitive_pressure is not null and v_prior_cp.competitive_pressure <> 0 and v_recent_cp.competitive_pressure is not null
            then round(50 - greatest(-50, least(50, pct_change(v_recent_cp.competitive_pressure, v_prior_cp.competitive_pressure) / 2)), 1)
            else 50
          end,
          null
        );
      exception when others then
        null;
      end;
    end if;

    insert into mart_slot_score (as_of_date, channel_id, target_id, day_of_week, hour_block, daypart, avg_rating)
    select
      p_as_of_date, rec_channel.id, v_program_target_id,
      extract(dow from r.broadcast_date)::int,
      (case when extract(hour from r.start_time) < 2 then extract(hour from r.start_time)::int + 24 else extract(hour from r.start_time)::int end),
      (case
        when (case when extract(hour from r.start_time) < 2 then extract(hour from r.start_time)::int + 24 else extract(hour from r.start_time)::int end) between 2 and 8 then '새벽'
        when (case when extract(hour from r.start_time) < 2 then extract(hour from r.start_time)::int + 24 else extract(hour from r.start_time)::int end) between 9 and 13 then '오전'
        when (case when extract(hour from r.start_time) < 2 then extract(hour from r.start_time)::int + 24 else extract(hour from r.start_time)::int end) between 14 and 18 then '오후'
        else '저녁_심야'
      end),
      avg(r.rating)
    from ratings r
    where r.channel_id = rec_channel.id and r.target_id = v_program_target_id
      and r.source_type = 'nielsen_daily' and r.program_id is not null and r.start_time is not null
      and r.broadcast_date between v_window_from and p_as_of_date
    group by 1,2,3,4,5,6;

    update mart_slot_score s set slot_pctl = round((x.pctl * 100)::numeric, 1)
    from (
      select id, percent_rank() over (order by avg_rating) as pctl
      from mart_slot_score where as_of_date = p_as_of_date and channel_id = rec_channel.id
    ) x where x.id = s.id;

    update mart_slot_score s set daypart_avg_rating = d.avg_rating
    from (
      select daypart, avg(avg_rating) as avg_rating
      from mart_slot_score where as_of_date = p_as_of_date and channel_id = rec_channel.id
      group by daypart
    ) d where d.daypart = s.daypart and s.as_of_date = p_as_of_date and s.channel_id = rec_channel.id;

    update mart_slot_score s set daypart_pctl = round((x.pctl * 100)::numeric, 1)
    from (
      select id, percent_rank() over (order by daypart_avg_rating) as pctl
      from mart_slot_score where as_of_date = p_as_of_date and channel_id = rec_channel.id
    ) x where x.id = s.id;

    update mart_slot_score s set recent_trend_score = coalesce(round(50 + greatest(-50, least(50,
        pct_change(recent.avg_rating, prior.avg_rating) / 2)), 1), 50)
    from (
      select extract(dow from r.broadcast_date)::int as day_of_week,
        (case when extract(hour from r.start_time) < 2 then extract(hour from r.start_time)::int + 24 else extract(hour from r.start_time)::int end) as hour_block,
        avg(r.rating) as avg_rating
      from ratings r
      where r.channel_id = rec_channel.id and r.target_id = v_program_target_id
        and r.source_type = 'nielsen_daily' and r.program_id is not null and r.start_time is not null
        and r.broadcast_date between v_recent_from and p_as_of_date
      group by 1, 2
    ) recent(day_of_week, hour_block, avg_rating)
    full outer join (
      select extract(dow from r.broadcast_date)::int as day_of_week,
        (case when extract(hour from r.start_time) < 2 then extract(hour from r.start_time)::int + 24 else extract(hour from r.start_time)::int end) as hour_block,
        avg(r.rating) as avg_rating
      from ratings r
      where r.channel_id = rec_channel.id and r.target_id = v_program_target_id
        and r.source_type = 'nielsen_daily' and r.program_id is not null and r.start_time is not null
        and r.broadcast_date between v_prior_from and v_prior_to
      group by 1, 2
    ) prior(day_of_week, hour_block, avg_rating) on recent.day_of_week = prior.day_of_week and recent.hour_block = prior.hour_block
    where s.as_of_date = p_as_of_date and s.channel_id = rec_channel.id
      and s.day_of_week = coalesce(recent.day_of_week, prior.day_of_week)
      and s.hour_block = coalesce(recent.hour_block, prior.hour_block);

    -- avg_rating 등 전체 성과는 본방+재방 전체(사용자 지시는 "시간대 분석"만 분리하라는 것, 20260820210000).
    insert into mart_program_target_score (as_of_date, channel_id, program_id, target_id, sample_days, avg_rating, avg_reach, avg_time_spent_share)
    select p_as_of_date, rec_channel.id, r.program_id, v_program_target_id,
      count(distinct r.broadcast_date), avg(r.rating), avg(r.reach), avg(r.time_spent_share)
    from ratings r
    where r.channel_id = rec_channel.id and r.target_id = v_program_target_id
      and r.source_type = 'nielsen_daily' and r.program_id is not null
      and r.broadcast_date between v_window_from and p_as_of_date
    group by r.program_id;

    update mart_program_target_score m set
      program_rating_pctl = round((x.rating_pctl * 100)::numeric, 1),
      reach_pctl = coalesce(round((x.reach_pctl * 100)::numeric, 1), 50),
      time_spent_share_pctl = coalesce(round((x.tss_pctl * 100)::numeric, 1), 50)
    from (
      select id,
        percent_rank() over (order by avg_rating) as rating_pctl,
        percent_rank() over (order by avg_reach) as reach_pctl,
        percent_rank() over (order by avg_time_spent_share) as tss_pctl
      from mart_program_target_score where as_of_date = p_as_of_date and channel_id = rec_channel.id
    ) x where x.id = m.id;

    -- 프로그램이 실제로 방영된 슬롯들의 평균 same_slot_pctl / same_daypart_pctl / recent_trend_score
    -- — <재>(is_first_run=false) 회차는 "이 프로그램이 언제 방영되는가" 시간대 분석에서 제외(20260820210000).
    update mart_program_target_score m set
      same_slot_pctl = coalesce(round(y.avg_slot_pctl, 1), 50),
      same_daypart_pctl = coalesce(round(y.avg_daypart_pctl, 1), 50),
      recent_trend_score = coalesce(round(y.avg_trend, 1), 50)
    from (
      select r.program_id, avg(s.slot_pctl) as avg_slot_pctl, avg(s.daypart_pctl) as avg_daypart_pctl, avg(s.recent_trend_score) as avg_trend
      from ratings r
      join mart_slot_score s on s.as_of_date = p_as_of_date and s.channel_id = rec_channel.id and s.target_id = v_program_target_id
        and s.day_of_week = extract(dow from r.broadcast_date)::int
        and s.hour_block = (case when extract(hour from r.start_time) < 2 then extract(hour from r.start_time)::int + 24 else extract(hour from r.start_time)::int end)
      where r.channel_id = rec_channel.id and r.target_id = v_program_target_id
        and r.source_type = 'nielsen_daily' and r.program_id is not null and r.start_time is not null
        and r.broadcast_date between v_window_from and p_as_of_date
        and r.is_first_run is distinct from false
      group by r.program_id
    ) y where y.program_id = m.program_id and m.as_of_date = p_as_of_date and m.channel_id = rec_channel.id;

    -- 프로그램별 "가장 자주 방영된 daypart"(20260820180000) — 같은 이유로 재방송(<재>) 회차는 제외.
    update mart_program_target_score m set current_daypart = dc.daypart
    from (
      select program_id, daypart from (
        select r.program_id, s.daypart, count(*) as cnt,
          row_number() over (partition by r.program_id order by count(*) desc) as rn
        from ratings r
        join mart_slot_score s on s.as_of_date = p_as_of_date and s.channel_id = rec_channel.id and s.target_id = v_program_target_id
          and s.day_of_week = extract(dow from r.broadcast_date)::int
          and s.hour_block = (case when extract(hour from r.start_time) < 2 then extract(hour from r.start_time)::int + 24 else extract(hour from r.start_time)::int end)
        where r.channel_id = rec_channel.id and r.target_id = v_program_target_id
          and r.source_type = 'nielsen_daily' and r.program_id is not null and r.start_time is not null
          and r.broadcast_date between v_window_from and p_as_of_date
          and r.is_first_run is distinct from false
        group by r.program_id, s.daypart
      ) ranked where rn = 1
    ) dc where dc.program_id = m.program_id and m.as_of_date = p_as_of_date and m.channel_id = rec_channel.id;

    update mart_program_target_score set
      target_performance_score = round(0.4 * coalesce(program_rating_pctl,50) + 0.3 * coalesce(same_slot_pctl,50) + 0.3 * coalesce(same_daypart_pctl,50), 1),
      slot_performance_score = round(0.5 * coalesce(same_slot_pctl,50) + 0.3 * coalesce(same_daypart_pctl,50) + 0.2 * coalesce(recent_trend_score,50), 1),
      audience_engagement_score = round(0.5 * coalesce(reach_pctl,50) + 0.5 * coalesce(time_spent_share_pctl,50), 1)
    where as_of_date = p_as_of_date and channel_id = rec_channel.id;

    -- 버그 수정(2026-09-02): Target Affinity를 채널 하루 전체 집계(program_id is null) 기준
    -- 채널간 비교 대신, "이 채널의 핵심 연령대(demo_metro/demo_national) 평균 시청률 ÷ 이
    -- 프로그램 자신의 주타깃 평균 시청률" 비율을 채널 내 프로그램들끼리 percentile로 매긴다 —
    -- 프로그램별 실제 연령대 시청률(타깃상세 시트, ratings.program_id not null)이 이미 있으므로
    -- 새 데이터 없이 그룹핑 기준만 프로그램 단위로 바꾼 것. 대표 연령대 데이터가 아예 없는
    -- 프로그램(inner join에서 탈락)은 target_affinity_score가 null로 남고, 아래 최종 INSERT에서
    -- 다른 하위지표와 동일하게 coalesce(...,50) 중립값으로 처리된다.
    update mart_program_target_score m set
      affinity_index = z.ratio,
      target_affinity_score = coalesce(round((z.pctl * 100)::numeric, 1), 50)
    from (
      select m2.id,
        (d.demo_avg_rating / nullif(m2.avg_rating, 0)) as ratio,
        percent_rank() over (order by (d.demo_avg_rating / nullif(m2.avg_rating, 0))) as pctl
      from mart_program_target_score m2
      join (
        select r.program_id, avg(r.rating) as demo_avg_rating
        from ratings r
        join targets t on t.id = r.target_id
        where r.channel_id = rec_channel.id
          and r.source_type = 'nielsen_daily' and r.program_id is not null
          and t.label = any(v_demo_list)
          and r.broadcast_date between v_window_from and p_as_of_date
        group by r.program_id
      ) d on d.program_id = m2.program_id
      where m2.as_of_date = p_as_of_date and m2.channel_id = rec_channel.id
        and m2.avg_rating is not null and m2.avg_rating <> 0
    ) z
    where z.id = m.id and z.ratio is not null;

    insert into mart_flow_score (as_of_date, channel_id, program_id, target_id, sample_days, avg_lead_in_retention)
    select p_as_of_date, rec_channel.id, x.program_id, v_program_target_id, count(*),
      avg(least(3, x.ratio))
    from (
      select r.program_id, r.rating,
        r.rating / nullif(lag(r.rating) over (partition by r.broadcast_date order by r.start_time), 0) as ratio
      from ratings r
      where r.channel_id = rec_channel.id and r.target_id = v_program_target_id
        and r.source_type = 'nielsen_daily' and r.program_id is not null and r.start_time is not null
        and r.broadcast_date between v_window_from and p_as_of_date
    ) x
    where x.ratio is not null
    group by x.program_id;

    update mart_flow_score m set audience_flow_score = round((x.pctl * 100)::numeric, 1)
    from (
      select id, percent_rank() over (order by avg_lead_in_retention) as pctl
      from mart_flow_score where as_of_date = p_as_of_date and channel_id = rec_channel.id
    ) x where x.id = m.id;
  end loop;

  update mart_competitive_score set competitive_opportunity_score = round(
    0.4 * (100 - coalesce(competitive_pressure, 100)) + 0.3 * coalesce(gap_score, 50) + 0.3 * coalesce(trend_score, 50), 1
  ) where as_of_date = p_as_of_date and (v_target_channel_id is null or channel_id = v_target_channel_id);

  for rec_channel in
    select id, code from channels
    where code <> 'SKYUHD' and (p_channel_code is null or code = p_channel_code)
  loop
    select * into v_cfg from fit_score_config where channel_id = rec_channel.id;
    if not found then
      select * into v_cfg from fit_score_config where channel_id is null;
    end if;

    insert into mart_scheduling_fit_score (
      as_of_date, channel_id, program_id, target_id,
      target_performance_score, target_affinity_score, audience_engagement_score,
      slot_performance_score, competitive_opportunity_score, audience_flow_score,
      sample_days, fit_score, confidence_pct, tag, evidence
    )
    select
      p_as_of_date, m.channel_id, m.program_id, m.target_id,
      m.target_performance_score,
      coalesce(m.target_affinity_score, 50) as target_affinity_score,
      m.audience_engagement_score,
      m.slot_performance_score,
      coalesce(cs.competitive_opportunity_score, 50),
      f.audience_flow_score,
      m.sample_days,
      round(
        (
          v_cfg.weight_target_performance * m.target_performance_score
          + v_cfg.weight_target_affinity * coalesce(m.target_affinity_score, 50)
          + v_cfg.weight_audience_engagement * m.audience_engagement_score
          + v_cfg.weight_slot_performance * m.slot_performance_score
          + v_cfg.weight_competitive_opportunity * coalesce(cs.competitive_opportunity_score, 50)
          + coalesce(v_cfg.weight_audience_flow * f.audience_flow_score, 0)
        ) / (
          v_cfg.weight_target_performance + v_cfg.weight_target_affinity + v_cfg.weight_audience_engagement
          + v_cfg.weight_slot_performance + v_cfg.weight_competitive_opportunity
          + case when f.audience_flow_score is not null then v_cfg.weight_audience_flow else 0 end
        ), 1
      ) as fit_score,
      least(100, round(100.0 * m.sample_days / v_cfg.full_confidence_sample_days, 1)) as confidence_pct,
      case
        when least(100, round(100.0 * m.sample_days / v_cfg.full_confidence_sample_days, 1)) < v_cfg.min_confidence_pct_for_tag then 'TEST'
        else null
      end,
      jsonb_build_object(
        'avg_rating', m.avg_rating, 'sample_days', m.sample_days,
        'program_rating_pctl', m.program_rating_pctl, 'same_slot_pctl', m.same_slot_pctl, 'same_daypart_pctl', m.same_daypart_pctl,
        'avg_reach', m.avg_reach, 'reach_pctl', m.reach_pctl,
        'avg_time_spent_share', m.avg_time_spent_share, 'time_spent_share_pctl', m.time_spent_share_pctl,
        'affinity_composition_ratio', m.affinity_index, 'affinity_program_pctl', m.target_affinity_score,
        'competitive_pressure', cs.competitive_pressure, 'our_avg_rating', cs.our_avg_rating, 'top3_avg_rating', cs.top3_avg_rating,
        'avg_lead_in_retention', f.avg_lead_in_retention, 'flow_sample_days', f.sample_days,
        'current_daypart', m.current_daypart
      )
    from mart_program_target_score m
    left join mart_competitive_score cs on cs.as_of_date = p_as_of_date and cs.channel_id = m.channel_id and cs.target_id = (
      select id from targets t where t.label = (select matched_target_label from get_target_achievement(rec_channel.code, v_window_from, p_as_of_date, extract(year from p_as_of_date)::int) limit 1)
    )
    left join mart_flow_score f on f.as_of_date = p_as_of_date and f.channel_id = m.channel_id and f.program_id = m.program_id and f.target_id = m.target_id
    where m.as_of_date = p_as_of_date and m.channel_id = rec_channel.id;
  end loop;

  update mart_scheduling_fit_score set tag = case
    when tag = 'TEST' then 'TEST'
    when fit_score >= 80 then 'STRENGTHEN'
    when fit_score >= 65 then 'KEEP'
    when fit_score >= 50 then 'MOVE'
    when fit_score is not null then 'REPLACE'
    else null
  end
  where as_of_date = p_as_of_date and (v_target_channel_id is null or channel_id = v_target_channel_id);
end;
$$;
comment on function refresh_fit_score_mart is 'Fit Score 6개 하위지표 + 최종 점수·태그 재계산(채널 단위, p_channel_code로 1개씩 계산 가능 — 20260826130000). Target Affinity는 프로그램별 핵심 연령대 구성비를 채널 내 프로그램 percentile로 매긴다(2026-09-02 수정 — 이전엔 채널 하루 전체 집계 기준 채널간 percentile이라 한 채널의 모든 프로그램이 항상 같은 값이었음).';
