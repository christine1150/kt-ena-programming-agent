-- 사용자 신고(2026-09-01): "대부분의 채널에서 Target Affinity가 0으로 나온다".
--
-- 근본 원인(DB 직접 조회로 확인, 2026-08-27~08-31 총 1000행 target_affinity_score 전부 0):
-- 20260826130000(fit_score_per_channel_refresh)이 "6채널 동시 계산이 anon/authenticated
-- 20초 statement_timeout을 넘겨 매번 500 실패"를 고치려고 refresh_fit_score_mart()를 채널
-- 1개씩만 계산하도록 바꿨는데(/api/scheduling/fit-score, src/lib/intent/executors.ts 둘 다
-- 항상 p_channel_code를 채워서 부름 — 실측 확인, 채널 없이 전체 배치로 부르는 곳은 프로젝트
-- 전체에 하나도 없음), Target Affinity 퍼센타일을 매기는 tmp_channel_affinity 임시 테이블은
-- "이번 함수 호출 1번"의 트랜잭션 안에서만 채워진다 — 채널 1개씩만 도니 매번 정확히 1행,
-- percent_rank()는 원소 1개짜리 집합에서 항상 0을 반환해 target_affinity_score가 예외 없이
-- 0으로 나왔다. 타이밍 버그를 고치려던 수정이 계산 정확성을 깨뜨린 회귀.
--
-- 수정: 퍼센타일 peer group을 트랜잭션 임시 테이블 대신 영속 스냅샷 테이블(channel_affinity_
-- snapshot)에서 구한다. 채널이 하나씩 갱신될 때마다 그 채널의 affinity_avg를 여기 upsert해두면,
-- 하루 동안 PD가 여러 채널 페이지를 오가는 것만으로 6채널이 자연스럽게 채워지고, 최종 퍼센타일은
-- "각 채널의 최근 14일 안 가장 최신 값들"을 모아 계산한다 — 이번 호출이 갱신 중인 채널이 1개뿐
-- 이어도 다른 채널이 최근에 한 번이라도 조회됐으면 그 값들과 함께 진짜 퍼센타일이 나온다.
create table if not exists channel_affinity_snapshot (
  as_of_date date not null,
  channel_id uuid not null references channels(id) on delete cascade,
  affinity_avg numeric,
  updated_at timestamptz not null default now(),
  primary key (as_of_date, channel_id)
);
comment on table channel_affinity_snapshot is '채널별 Target Affinity 원본 지수(affinity_avg, get_target_affinity 4개 연령대 평균) 일자별 영속 스냅샷 — refresh_fit_score_mart()가 채널을 1개씩 갱신해도 다른 채널의 최근 값과 함께 퍼센타일을 매길 수 있도록 트랜잭션 밖에 저장(2026-09-01, target_affinity_score 전 채널 0 버그 수정).';

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
  perform set_config('statement_timeout', '300000', true);

  if p_channel_code is not null then
    select id into v_target_channel_id from channels where code = p_channel_code;
  end if;

  delete from mart_scheduling_fit_score where as_of_date = p_as_of_date and (v_target_channel_id is null or channel_id = v_target_channel_id);
  delete from mart_program_target_score where as_of_date = p_as_of_date and (v_target_channel_id is null or channel_id = v_target_channel_id);
  delete from mart_slot_score where as_of_date = p_as_of_date and (v_target_channel_id is null or channel_id = v_target_channel_id);
  delete from mart_competitive_score where as_of_date = p_as_of_date and (v_target_channel_id is null or channel_id = v_target_channel_id);
  delete from mart_flow_score where as_of_date = p_as_of_date and (v_target_channel_id is null or channel_id = v_target_channel_id);

  create temporary table tmp_channel_affinity (
    channel_id uuid primary key,
    affinity_avg numeric
  ) on commit drop;

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
          null;
        end;
      end loop;
    end if;
    insert into tmp_channel_affinity (channel_id, affinity_avg)
    values (rec_channel.id, case when v_affinity_cnt > 0 then round(v_affinity_sum / v_affinity_cnt, 1) else null end);

    -- 버그 수정(2026-09-01): 위 tmp_channel_affinity는 이번 호출(트랜잭션) 안에서만 살아있어,
    -- 채널을 1개씩만 갱신하는 현재 호출 패턴에서는 퍼센타일 peer가 항상 1개뿐이었다 — 영속
    -- 테이블에도 같은 값을 upsert해 다른 시점에 갱신된 다른 채널의 값과 함께 쓸 수 있게 한다.
    insert into channel_affinity_snapshot (as_of_date, channel_id, affinity_avg, updated_at)
    values (p_as_of_date, rec_channel.id, case when v_affinity_cnt > 0 then round(v_affinity_sum / v_affinity_cnt, 1) else null end, now())
    on conflict (as_of_date, channel_id) do update set affinity_avg = excluded.affinity_avg, updated_at = excluded.updated_at;

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
      coalesce(round((ta.pctl * 100)::numeric, 1), 50) as target_affinity_score,
      m.audience_engagement_score,
      m.slot_performance_score,
      coalesce(cs.competitive_opportunity_score, 50),
      f.audience_flow_score,
      m.sample_days,
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
        else null
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
    -- 버그 수정(2026-09-01): tmp_channel_affinity(이번 호출 1개 채널뿐) 대신 channel_affinity_
    -- snapshot에서 "채널별 p_as_of_date 이하 최근 14일 안 가장 최신 값"을 모아 그 집합 전체로
    -- percent_rank()를 계산한다 — 이번에 갱신 중인 채널이 1개뿐이어도 다른 채널이 최근에 한 번
    -- 이라도 조회됐으면 그 값들과 함께 진짜 퍼센타일이 나온다(전부 다 1개뿐이면 여전히 0이지만,
    -- 이는 하루 안에 어떤 채널도 조회된 적이 없는 최초 상태에서만 발생하며 이후 자연 해소된다).
    left join (
      select channel_id, affinity_avg, percent_rank() over (order by affinity_avg) as pctl
      from (
        select distinct on (s.channel_id) s.channel_id, s.affinity_avg
        from channel_affinity_snapshot s
        where s.as_of_date between (p_as_of_date - 13) and p_as_of_date
        order by s.channel_id, s.as_of_date desc
      ) latest
      where affinity_avg is not null
    ) ta on ta.channel_id = m.channel_id
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
comment on function refresh_fit_score_mart is 'Fit Score 6개 하위지표 + 최종 점수·태그 재계산(채널 단위, p_channel_code로 1개씩 계산 가능 — 20260826130000). Target Affinity 퍼센타일은 channel_affinity_snapshot 영속 테이블에서 최근 14일 내 채널별 최신값을 모아 계산(2026-09-01 수정, 이전엔 트랜잭션 임시 테이블만 써서 항상 0이 나오는 버그가 있었음).';
