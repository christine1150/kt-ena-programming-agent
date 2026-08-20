-- 개발 단위 19번: 원인 추적(Root-Cause 참고 분석)·기회 탐지(Opportunity Alert).
-- PRD.md 5번에 고정된 기준 그대로:
--   원인 추적 트리거: "채널 평균(최근 28일) 대비 -10%p 이상 하락이 3일 이상 지속"(1차 단순 기준,
--     하루짜리 변동은 노이즈로 트리거하지 않음)
--   편성 변화 감지: 최근 2주 동일 요일·시간대 편성과 비교해 ①주요 프로그램 교체 ②시간·프로그램 변경
--     ③신규 편성 ④기존 편성 이탈 중 하나 + 그 시간대 시청률 5%↑↓ 변화
--   기회 탐지: 경쟁채널 약세(하락)와 자사 콘텐츠 강세(상승)가 같은 기간에 겹치는 경우
--   두 경우 모두 "동시에 관찰됨 · 상관관계 가능성이 있으나 인과관계로 단정할 수 없음"으로만 제공
--   (CLAUDE.md "상관관계를 인과관계로 단정하지 않는다" 원칙, PRD.md 5번 원문 그대로)
--
-- **문서화된 설계 판단(원본 자료 한계로 축소한 부분)**: PRD의 "편성 변화 감지"(신규/시간이동/교체/이탈)는
-- 경쟁채널의 "프로그램 단위 시간대별" 데이터가 있어야 가능하다. 그런데 원본 Nielsen 파일은 채널당
-- 경쟁채널 1개만 프로그램 단위로 제공하고(§1.2), 전체 Competitor Master 채널의 프로그램 단위 데이터는
-- 원본에 아예 없다(개발 단위 16번에서 이미 확인·문서화된 한계, DATA_DICTIONARY.md §5). 그래서 "편성이
-- 바뀌었다"고 프로그램명 단위로 단정하지 않고, 그 대신 **경쟁채널의 채널 단위 일별 시청률이 같은 기간
-- 크게 움직였는지**만 참고 정보로 제공한다 — "편성 변화"가 아니라 "경쟁채널 시청률 변동"으로 정직하게
-- 표현한다. 이 한계는 API 응답과 화면 문구에도 그대로 노출한다.

-- 1) 원인 추적: 채널의 시청률이 최근 28일 평균 대비 -10%p 이상 하락한 상태가 3일 연속됐는지 확인하고,
--    트리거됐으면 그 기간 등록 경쟁채널들의 시청률 변동(전주 대비)도 함께 제시한다.
create or replace function get_root_cause_alert(
  p_channel_code text,
  p_target_label text,
  p_as_of_date date,
  p_baseline_days int default 28,
  p_threshold_pct numeric default -10,
  p_streak_days int default 3
)
returns table (
  triggered boolean,
  streak_days int,
  daily jsonb,
  competitor_moves jsonb
)
language plpgsql
stable
as $$
declare
  v_channel_id uuid;
  v_target_id uuid;
  v_matched_target_id uuid;
  v_daily jsonb := '[]'::jsonb;
  v_all_flagged boolean := true;
  v_row record;
  v_d date;
  v_rating numeric;
  v_baseline numeric;
  v_change numeric;
  v_flagged boolean;
  v_competitor_moves jsonb;
begin
  select id into v_channel_id from channels where code = p_channel_code;
  if v_channel_id is null then
    raise exception '알 수 없는 채널 코드: %', p_channel_code;
  end if;
  select id into v_target_id from targets where label = p_target_label;
  if v_target_id is null then
    raise exception '알 수 없는 타깃 이름: %', p_target_label;
  end if;

  for i in 0..(p_streak_days - 1) loop
    v_d := p_as_of_date - i;
    select r.rating into v_rating from ratings r
      where r.channel_id = v_channel_id and r.target_id = v_target_id
        and r.source_type = 'nielsen_daily' and r.program_id is null and r.broadcast_date = v_d
      limit 1;
    select avg(r.rating) into v_baseline from ratings r
      where r.channel_id = v_channel_id and r.target_id = v_target_id
        and r.source_type = 'nielsen_daily' and r.program_id is null
        and r.broadcast_date between v_d - p_baseline_days and v_d - 1;
    v_change := pct_change(v_rating, v_baseline);
    v_flagged := (v_change is not null and v_change <= p_threshold_pct);
    if not v_flagged then
      v_all_flagged := false;
    end if;
    v_daily := v_daily || jsonb_build_object(
      'date', v_d, 'rating', v_rating, 'baseline_avg', round(v_baseline, 5), 'change_pct', v_change, 'flagged', v_flagged
    );
  end loop;

  v_competitor_moves := '[]'::jsonb;
  if v_all_flagged then
    -- 채널 단위 매칭 타깃(get_target_achievement가 찾아주는 라벨)으로 경쟁채널 전주 대비 변동을 조회
    select id into v_matched_target_id from targets where label = (
      select matched_target_label from get_target_achievement(p_channel_code, p_as_of_date - 27, p_as_of_date, extract(year from p_as_of_date)::int)
    );
    if v_matched_target_id is not null then
      select coalesce(jsonb_agg(jsonb_build_object(
        'competitor_name', x.competitor_name, 'today_rating', x.today_rating, 'week_ago_rating', x.week_ago_rating, 'change_pct', x.change_pct
      ) order by abs(x.change_pct) desc), '[]'::jsonb) into v_competitor_moves
      from (
        select comp.competitor_name,
          today.rating as today_rating, prior.rating as week_ago_rating,
          pct_change(today.rating, prior.rating) as change_pct
        from competitors comp
        left join competitor_ratings today on today.competitor_name = comp.competitor_name
          and today.target_id = v_matched_target_id and today.broadcast_date = p_as_of_date
        left join competitor_ratings prior on prior.competitor_name = comp.competitor_name
          and prior.target_id = v_matched_target_id and prior.broadcast_date = p_as_of_date - 7
        where comp.channel_id = v_channel_id
      ) x
      where x.change_pct is not null and abs(x.change_pct) >= 5;
    end if;
  end if;

  return query select v_all_flagged, p_streak_days, v_daily, v_competitor_moves;
end;
$$;
comment on function get_root_cause_alert is '원인 추적(1차 단순 기준): 채널 평균(최근 28일) 대비 -10%p 이상 하락이 3일 연속이면 트리거. 경쟁채널의 "편성 변화" 자체는 원본 자료에 프로그램 단위 데이터가 없어 확인 불가 — 대신 경쟁채널 채널 단위 시청률의 전주 대비 변동(5%p 이상)만 참고 정보로 제공(DATA_DICTIONARY.md §5). 상관관계일 뿐 인과관계 아님.';

-- 2) 기회 탐지: 자사 최근 7일 평균이 이전 7일 평균 대비 강세인 동시에, 등록 경쟁채널 중 같은 기간
--    약세인 채널이 있으면 "기회 슬롯"으로 제시한다.
create or replace function get_opportunity_alert(
  p_channel_code text,
  p_target_label text,
  p_as_of_date date,
  p_window_days int default 7,
  p_threshold_pct numeric default 10
)
returns table (
  triggered boolean,
  our_recent_avg numeric,
  our_prior_avg numeric,
  our_change_pct numeric,
  weak_competitors jsonb
)
language plpgsql
stable
as $$
declare
  v_channel_id uuid;
  v_target_id uuid;
  v_matched_target_id uuid;
  v_our_recent numeric;
  v_our_prior numeric;
  v_our_change numeric;
  v_weak jsonb := '[]'::jsonb;
  v_triggered boolean := false;
begin
  select id into v_channel_id from channels where code = p_channel_code;
  if v_channel_id is null then
    raise exception '알 수 없는 채널 코드: %', p_channel_code;
  end if;
  select id into v_target_id from targets where label = p_target_label;
  if v_target_id is null then
    raise exception '알 수 없는 타깃 이름: %', p_target_label;
  end if;

  select avg(r.rating) into v_our_recent from ratings r
    where r.channel_id = v_channel_id and r.target_id = v_target_id
      and r.source_type = 'nielsen_daily' and r.program_id is null
      and r.broadcast_date between p_as_of_date - (p_window_days - 1) and p_as_of_date;
  select avg(r.rating) into v_our_prior from ratings r
    where r.channel_id = v_channel_id and r.target_id = v_target_id
      and r.source_type = 'nielsen_daily' and r.program_id is null
      and r.broadcast_date between p_as_of_date - (2 * p_window_days - 1) and p_as_of_date - p_window_days;
  v_our_change := pct_change(v_our_recent, v_our_prior);

  if v_our_change is not null and v_our_change >= p_threshold_pct then
    select id into v_matched_target_id from targets where label = (
      select matched_target_label from get_target_achievement(p_channel_code, p_as_of_date - 27, p_as_of_date, extract(year from p_as_of_date)::int)
    );
    if v_matched_target_id is not null then
      select coalesce(jsonb_agg(jsonb_build_object(
        'competitor_name', x.competitor_name, 'recent_avg', round(x.recent_avg, 5), 'prior_avg', round(x.prior_avg, 5), 'change_pct', x.change_pct
      ) order by x.change_pct), '[]'::jsonb) into v_weak
      from (
        select comp.competitor_name,
          avg(recent.rating) as recent_avg, avg(prior.rating) as prior_avg,
          pct_change(avg(recent.rating), avg(prior.rating)) as change_pct
        from competitors comp
        left join competitor_ratings recent on recent.competitor_name = comp.competitor_name
          and recent.target_id = v_matched_target_id
          and recent.broadcast_date between p_as_of_date - (p_window_days - 1) and p_as_of_date
        left join competitor_ratings prior on prior.competitor_name = comp.competitor_name
          and prior.target_id = v_matched_target_id
          and prior.broadcast_date between p_as_of_date - (2 * p_window_days - 1) and p_as_of_date - p_window_days
        where comp.channel_id = v_channel_id
        group by comp.competitor_name
      ) x
      where x.change_pct is not null and x.change_pct <= -p_threshold_pct;
      v_triggered := jsonb_array_length(v_weak) > 0;
    end if;
  end if;

  return query select v_triggered, round(v_our_recent, 5), round(v_our_prior, 5), v_our_change, v_weak;
end;
$$;
comment on function get_opportunity_alert is '기회 탐지: 자사 최근 7일 평균이 이전 7일 대비 +10%p 이상 강세이면서, 등록 경쟁채널 중 같은 기간 -10%p 이상 약세인 채널이 있으면 트리거. 상관관계일 뿐 인과관계 아님(PRD.md 5번).';
