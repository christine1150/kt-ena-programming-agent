-- 사용자 피드백: "경쟁채널로 지정은 했지만 자료가 없으면 그 채널은 화면에서 빼고, 자료가
-- 있으면 반영해서 인사이트를 보여달라." 지금까지 COMPARED WITH?의 "등록된 경쟁채널 목록"은
-- Competitor Master에 등록된 이름을 실제 시청률 데이터 유무와 무관하게 전부 나열했다 —
-- 이 함수는 실제로 competitor_ratings 데이터가 있는 경쟁채널만, 최근 시청률과 전주 대비
-- 증감까지 함께 돌려준다(get_competitive_pressure의 상위 3개 제한과 달리 데이터가 있는
-- 경쟁채널 전체를 대상으로 한다).
create or replace function get_competitor_channel_snapshot(
  p_channel_code text,
  p_target_label text,
  p_date_from date,
  p_date_to date
)
returns table (
  competitor_name text,
  avg_rating numeric,
  prior_week_avg_rating numeric,
  change_pct numeric
)
language plpgsql
stable
as $$
declare
  v_channel_id uuid;
  v_target_id uuid;
  v_alias_label text;
  v_window_days int;
begin
  select id into v_channel_id from channels where code = p_channel_code;
  if v_channel_id is null then
    raise exception '알 수 없는 채널 코드: %', p_channel_code;
  end if;

  select id into v_target_id from targets where label = p_target_label;
  if v_target_id is null then
    raise exception '알 수 없는 타깃 이름: %', p_target_label;
  end if;

  -- get_competitive_pressure()와 동일한 동의어 재시도 규칙(수도권 2049 ↔ 개인2049 등,
  -- DATA_DICTIONARY.md §5 참고).
  if not exists (
    select 1 from competitor_ratings cr
    join competitors comp on comp.competitor_name = cr.competitor_name
    where comp.channel_id = v_channel_id and cr.target_id = v_target_id
      and cr.broadcast_date between p_date_from and p_date_to
  ) then
    v_alias_label := concat('개인', regexp_replace(p_target_label, '^(수도권|National)\s*', ''));
    select id into v_target_id from targets where label = v_alias_label;
  end if;

  if v_target_id is null then
    return;
  end if;

  v_window_days := p_date_to - p_date_from + 1;

  return query
  select
    cr.competitor_name,
    round(avg(cr.rating), 5),
    round(avg(prior.rating), 5),
    pct_change(avg(cr.rating), avg(prior.rating))
  from competitor_ratings cr
  join competitors comp on comp.competitor_name = cr.competitor_name
  left join competitor_ratings prior on prior.competitor_name = cr.competitor_name
    and prior.target_id = v_target_id
    and prior.broadcast_date between p_date_from - v_window_days and p_date_to - v_window_days
  where comp.channel_id = v_channel_id
    and cr.target_id = v_target_id
    and cr.broadcast_date between p_date_from and p_date_to
  group by cr.competitor_name
  having avg(cr.rating) is not null
  order by avg(cr.rating) desc;
end;
$$;
comment on function get_competitor_channel_snapshot is 'COMPARED WITH? 목록용: 등록된 경쟁채널 중 실제 시청률 데이터가 있는 채널만, 최근 평균 시청률과 이전 동일 길이 기간 대비 증감을 함께 반환. 데이터 없는 경쟁채널은 결과에서 제외(임의로 0 표시하지 않음).';
