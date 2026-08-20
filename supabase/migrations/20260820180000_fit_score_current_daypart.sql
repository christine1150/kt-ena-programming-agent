-- 사용자 지시(2026-08-20): "WHAT TO SCHEDULE?에서 다른 시간대 재배치 검토를 지난 12개월 편성
-- 또는 타 경쟁 채널 분석과 비교하여 다른 시간대를 추천할 근거가 논리적으로 생긴다면 추천하는
-- 시간대도 괄호 안에 표시." — 이미 OPPORTUNITY?에서 daypart별 "우리 vs 경쟁채널 격차가 얼마나
-- 좁혀졌는지"(daypartOpportunity, 개발 단위 20번)를 계산해두고 있으니, 그 값을 프로그램별로도
-- 재사용하려면 "이 프로그램이 지금 주로 방영되는 daypart"를 알아야 한다. mart_program_target_score에
-- 그 정보가 없었으므로 여기서 current_daypart(최근 12주 동안 가장 자주 방영된 daypart)를 추가한다.
-- 새 계산 방식을 만들지 않고, 이미 있는 mart_slot_score의 daypart 분류를 그대로 재사용한다.
alter table mart_program_target_score add column if not exists current_daypart text;
comment on column mart_program_target_score.current_daypart is '최근 12주(84일) 동안 이 프로그램이 가장 자주 방영된 daypart(새벽/오전/오후/저녁_심야) — 다른 daypart 재배치 추천의 "현재 위치" 기준.';

create or replace function refresh_fit_score_mart(
  p_as_of_date date default current_date,
  p_window_days int default 84 -- 최근 12주
)
returns void
language plpgsql
as $$
declare
  v_window_from date := p_as_of_date - (p_window_days - 1);
  v_recent_from date := p_as_of_date - 27;   -- 최근 4주
  v_prior_from date := p_as_of_date - 83;    -- 이전 8주 시작
  v_prior_to date := p_as_of_date - 28;      -- 이전 8주 끝
  rec_channel record;
  v_program_target_id uuid;
  v_matched_target_id uuid;
  v_is_national boolean;
  v_compare_code text;
  v_compare_primary_target text;
  v_achievement record;
  v_demo text;
  v_demo_list text[];
  v_aff record;
  v_affinity_sum numeric;
  v_affinity_cnt int;
  v_recent_cp record;
  v_prior_cp record;
  v_cp record;
  v_cfg record;
  demo_metro text[] := array['수도권 여20대','수도권 남20대','수도권 여40대','수도권 남40대'];
  demo_national text[] := array['전국 여20대','전국 남20대','전국 여40대','전국 남40대'];
begin
  delete from mart_scheduling_fit_score where as_of_date = p_as_of_date;
  delete from mart_program_target_score where as_of_date = p_as_of_date;
  delete from mart_slot_score where as_of_date = p_as_of_date;
  delete from mart_competitive_score where as_of_date = p_as_of_date;
  delete from mart_flow_score where as_of_date = p_as_of_date;

  create temporary table tmp_channel_affinity (
    channel_id uuid primary key,
    affinity_avg numeric
  ) on commit drop;

  for rec_channel in
    select c.id, c.code, c.market, c.primary_target
    from channels c
    where c.code <> 'SKYUHD' and c.primary_target is not null
  loop
    -- 채널의 "프로그램 단위" 타깃 라벨(§1.3 타깃상세 시트 표기) 및
    -- "채널 단위" 매칭 타깃 라벨(§1.1 랭킹 시트 표기, get_target_achievement가 이미 찾아줌)을 둘 다 구한다.
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
      continue; -- 이 채널은 프로그램 단위 타깃 라벨을 못 찾음(예: skyUHD류) — 건너뜀
    end if;

    -- ---------- Target Affinity (채널 단위, 대표 연령대 4개 평균 → 나중에 6개 채널간 percentile) ----------
    v_is_national := rec_channel.market = '전국';
    v_compare_code := case
      when v_is_national then case when rec_channel.code = 'OLIFE' then 'ONCE' else 'OLIFE' end
      else case when rec_channel.code = 'ENA' then 'ENA_PLAY' else 'ENA' end
    end;
    select primary_target into v_compare_primary_target from channels where code = v_compare_code;
    v_demo_list := case when v_is_national then demo_national else demo_metro end;

    v_affinity_sum := 0; v_affinity_cnt := 0;
    if v_compare_primary_target is not null then
      foreach v_demo in array v_demo_list loop
        begin
          select * into v_aff from get_target_affinity(
            rec_channel.code, resolve_program_target_label(rec_channel.primary_target),
            v_compare_code, resolve_program_target_label(v_compare_primary_target),
            v_demo, v_window_from, p_as_of_date
          );
          if v_aff.affinity_index is not null and not v_aff.insufficient_sample then
            v_affinity_sum := v_affinity_sum + v_aff.affinity_index;
            v_affinity_cnt := v_affinity_cnt + 1;
          end if;
        exception when others then
          null; -- 이 대표 타깃 하나가 실패해도 나머지로 계속 진행
        end;
      end loop;
    end if;
    insert into tmp_channel_affinity (channel_id, affinity_avg)
    values (rec_channel.id, case when v_affinity_cnt > 0 then round(v_affinity_sum / v_affinity_cnt, 1) else null end);

    -- ---------- Competitive Opportunity (채널×매칭타깃 단위) ----------
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
          -- Gap 정규화: (자사 − 상위3평균)/상위3평균×100을 ±100%로 클램프 후 0~100 스케일
          case when v_cp.top3_avg_rating is not null and v_cp.top3_avg_rating <> 0 and v_cp.our_avg_rating is not null
            then round((greatest(-100, least(100, (v_cp.our_avg_rating - v_cp.top3_avg_rating) / v_cp.top3_avg_rating * 100)) + 100) / 2, 1)
            else 50 -- 경쟁채널 데이터 없음 → 중립값(50)으로 처리, evidence에 표시
          end,
          -- 최근 추세: 최근4주 압박도 대비 이전8주 압박도 증감(하락=기회 증가). pct_change 없으면 중립 50.
          case when v_prior_cp.competitive_pressure is not null and v_prior_cp.competitive_pressure <> 0 and v_recent_cp.competitive_pressure is not null
            then round(50 - greatest(-50, least(50, pct_change(v_recent_cp.competitive_pressure, v_prior_cp.competitive_pressure) / 2)), 1)
            else 50
          end,
          null -- 아래에서 업데이트
        );
      exception when others then
        null;
      end;
    end if;

    -- ---------- 슬롯(요일×시간대) 단위 집계 ----------
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

    -- 슬롯 내 percentile
    update mart_slot_score s set slot_pctl = round((x.pctl * 100)::numeric, 1)
    from (
      select id, percent_rank() over (order by avg_rating) as pctl
      from mart_slot_score where as_of_date = p_as_of_date and channel_id = rec_channel.id
    ) x where x.id = s.id;

    -- daypart 평균 및 percentile (원본 데이터에서 다시 직접 집계)
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

    -- 최근 4주 vs 이전 8주 추세 (슬롯별)
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

    -- ---------- 프로그램 단위 집계 (Program Target Rating, Reach, Time Spent Share) ----------
    insert into mart_program_target_score (as_of_date, channel_id, program_id, target_id, sample_days, avg_rating, avg_reach, avg_time_spent_share)
    select p_as_of_date, rec_channel.id, r.program_id, v_program_target_id,
      count(distinct r.broadcast_date), avg(r.rating), avg(r.reach), avg(r.time_spent_share)
    from ratings r
    where r.channel_id = rec_channel.id and r.target_id = v_program_target_id
      and r.source_type = 'nielsen_daily' and r.program_id is not null
      and r.broadcast_date between v_window_from and p_as_of_date
    group by r.program_id;

    -- percentile: 프로그램 시청률/Reach/Time Spent Share (채널 내 프로그램간)
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
      group by r.program_id
    ) y where y.program_id = m.program_id and m.as_of_date = p_as_of_date and m.channel_id = rec_channel.id;

    -- 프로그램별 "가장 자주 방영된 daypart" (최근 12주 방영 횟수 기준 최빈값) — 새 계산 방식을
    -- 만들지 않고 바로 위에서 이미 조인해둔 mart_slot_score의 daypart 분류를 그대로 재사용한다.
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
        group by r.program_id, s.daypart
      ) ranked where rn = 1
    ) dc where dc.program_id = m.program_id and m.as_of_date = p_as_of_date and m.channel_id = rec_channel.id;

    -- Target Performance / Slot Performance / Audience Engagement 조합
    update mart_program_target_score set
      target_performance_score = round(0.4 * coalesce(program_rating_pctl,50) + 0.3 * coalesce(same_slot_pctl,50) + 0.3 * coalesce(same_daypart_pctl,50), 1),
      slot_performance_score = round(0.5 * coalesce(same_slot_pctl,50) + 0.3 * coalesce(same_daypart_pctl,50) + 0.2 * coalesce(recent_trend_score,50), 1),
      audience_engagement_score = round(0.5 * coalesce(reach_pctl,50) + 0.5 * coalesce(time_spent_share_pctl,50), 1)
    where as_of_date = p_as_of_date and channel_id = rec_channel.id;

    -- ---------- Audience Flow (Lead-in Retention) ----------
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

  -- competitive_score의 최종 산식 계산 — 반드시 아래 "최종 결합" 루프보다 먼저 실행해야 한다
  -- (실제로 겪은 문제: 이 UPDATE를 함수 맨 끝에 뒀더니 최종 결합 INSERT가 이 값이 채워지기
  -- 전에 읽어버려서 모든 프로그램의 competitive_opportunity_score가 "데이터 없음" 기본값인
  -- 50으로 통일되는 버그가 났다 — mart_competitive_score를 실데이터로 직접 조회해서 발견함).
  update mart_competitive_score set competitive_opportunity_score = round(
    0.4 * (100 - coalesce(competitive_pressure, 100)) + 0.3 * coalesce(gap_score, 50) + 0.3 * coalesce(trend_score, 50), 1
  ) where as_of_date = p_as_of_date;

  -- ---------- 최종 결합: mart_scheduling_fit_score ----------
  for rec_channel in select id, code from channels where code <> 'SKYUHD' loop
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
      coalesce(round((ta.pctl * 100)::numeric, 1), 50) as target_affinity_score,
      m.audience_engagement_score,
      m.slot_performance_score,
      coalesce(cs.competitive_opportunity_score, 50),
      f.audience_flow_score,
      m.sample_days,
      -- 가중합. Audience Flow가 없으면(이전 프로그램이 아예 없던 프로그램) 그 가중치를 빼고 재정규화.
      round(
        (
          v_cfg.weight_target_performance * m.target_performance_score
          + v_cfg.weight_target_affinity * coalesce(round((ta.pctl * 100)::numeric, 1), 50)
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
        else null -- 아래에서 fit_score로 재분류
      end,
      jsonb_build_object(
        'avg_rating', m.avg_rating, 'sample_days', m.sample_days,
        'program_rating_pctl', m.program_rating_pctl, 'same_slot_pctl', m.same_slot_pctl, 'same_daypart_pctl', m.same_daypart_pctl,
        'avg_reach', m.avg_reach, 'reach_pctl', m.reach_pctl,
        'avg_time_spent_share', m.avg_time_spent_share, 'time_spent_share_pctl', m.time_spent_share_pctl,
        'affinity_avg_index', ta.affinity_avg, 'affinity_channel_pctl', round((ta.pctl*100)::numeric,1),
        'competitive_pressure', cs.competitive_pressure, 'our_avg_rating', cs.our_avg_rating, 'top3_avg_rating', cs.top3_avg_rating,
        'avg_lead_in_retention', f.avg_lead_in_retention, 'flow_sample_days', f.sample_days,
        'current_daypart', m.current_daypart
      )
    from mart_program_target_score m
    left join mart_competitive_score cs on cs.as_of_date = p_as_of_date and cs.channel_id = m.channel_id and cs.target_id = (
      select id from targets t where t.label = (select matched_target_label from get_target_achievement(rec_channel.code, v_window_from, p_as_of_date, extract(year from p_as_of_date)::int) limit 1)
    )
    left join mart_flow_score f on f.as_of_date = p_as_of_date and f.channel_id = m.channel_id and f.program_id = m.program_id and f.target_id = m.target_id
    left join (
      -- affinity_avg가 NULL인 채널(대표 타깃 4개 전부 표본 부족 등)은 percentile 계산에서
      -- 아예 빼야 한다 — 안 그러면 Postgres가 NULL을 정렬 맨 뒤로 보내 percent_rank가 100%로
      -- 나와버려("데이터 없음"이 "가장 좋음"으로 둔갑) NULL≠0/미표시 원칙에 어긋난다.
      select ca.channel_id, ca.affinity_avg, percent_rank() over (order by ca.affinity_avg) as pctl
      from tmp_channel_affinity ca
      where ca.affinity_avg is not null
    ) ta on ta.channel_id = m.channel_id
    where m.as_of_date = p_as_of_date and m.channel_id = rec_channel.id;
  end loop;

  -- fit_score로 최종 태그 확정 (TEST가 아닌 행만)
  update mart_scheduling_fit_score set tag = case
    when tag = 'TEST' then 'TEST'
    when fit_score >= 80 then 'STRENGTHEN'
    when fit_score >= 65 then 'KEEP'
    when fit_score >= 50 then 'MOVE'
    when fit_score is not null then 'REPLACE'
    else null
  end
  where as_of_date = p_as_of_date;
end;
$$;
comment on function refresh_fit_score_mart is 'Fit Score MART 전체 재계산(as_of_date 하루치, 최근 12주 데이터 기준). 관리자가 필요할 때 호출하거나, 매일 Nielsen 업로드 이후 실행한다. evidence.current_daypart로 다른 daypart 재배치 추천의 "현재 위치"를 함께 저장한다(2026-08-20 추가).';
