-- 개발 단위 16번 보완: 전체 230일 백필 후 실데이터로 재검증하다가 발견한 버그 2건 수정.
--
-- 버그 1) Postgres의 LEAST(100, NULL)은 NULL을 무시하고 100을 반환한다 (GREATEST/LEAST는
--   NULL이 아닌 값 중에서 고른다). 그래서 경쟁채널 데이터가 하나도 없어도(top3_avg_rating이
--   NULL) competitive_pressure가 "100(최대 압박)"으로 잘못 나왔다 — NULL과 실제값을 구분하지
--   않은 것(CLAUDE.md "NULL과 0을 구분" 원칙 위반). CASE로 명시적으로 NULL을 유지하도록 고침.
--
-- 버그 2) 자사 채널의 매칭 타깃 라벨과 competitor_ratings에 저장된 타깃 라벨이 다른 채널이
--   있다 (ENA/ENA Drama/ENA Play: 자사 라벨 "수도권 2049" ↔ 경쟁채널 시트 라벨 "개인2049" —
--   같은 시청률 파일 안에서도 "타깃상세" 시트와 "경쟁채널시청률" 시트가 표기를 다르게 쓰는
--   기존에 알려진 3-way 라벨 불일치 문제(DATA_DICTIONARY.md §1.1)가 경쟁채널 쪽에도 있었음).
--   실데이터로 확인: OLIFE/ONCE/ENA Story는 두 표기가 같아 문제 없었고, ENA 계열만 걸림.
--   정확히 일치하는 라벨로 먼저 찾고, 경쟁채널 데이터가 0건이면 "수도권 2049"→"개인2049"
--   같은 알려진 동의어(지역 접두어 제거 + "개인" 접두 부착)로 한 번 더 시도한다.
create or replace function get_competitive_pressure(
  p_channel_code text,
  p_target_label text,
  p_date_from date,
  p_date_to date
)
returns table (
  our_avg_rating numeric,
  top3_avg_rating numeric,
  competitive_pressure numeric,
  top3_competitors jsonb
)
language plpgsql
stable
as $$
declare
  v_channel_id uuid;
  v_target_id uuid;
  v_our_rating numeric;
  v_competitor_target_id uuid;
  v_alias_label text;
begin
  select id into v_channel_id from channels where code = p_channel_code;
  if v_channel_id is null then
    raise exception '알 수 없는 채널 코드: %', p_channel_code;
  end if;

  select id into v_target_id from targets where label = p_target_label;
  if v_target_id is null then
    raise exception '알 수 없는 타깃 이름: %', p_target_label;
  end if;

  select avg(r.rating) into v_our_rating
  from ratings r
  where r.channel_id = v_channel_id and r.target_id = v_target_id
    and r.source_type = 'nielsen_daily' and r.program_id is null
    and r.broadcast_date between p_date_from and p_date_to;

  -- 1차: 자사 타깃 라벨과 정확히 같은 라벨로 경쟁채널 데이터가 있는지 확인
  v_competitor_target_id := v_target_id;
  if not exists (
    select 1 from competitor_ratings cr
    join competitors comp on comp.competitor_name = cr.competitor_name
    where comp.channel_id = v_channel_id and cr.target_id = v_competitor_target_id
      and cr.broadcast_date between p_date_from and p_date_to
  ) then
    -- 2차: 못 찾으면 "수도권/National " 접두어를 떼고 "개인"을 붙인 동의어로 재시도
    v_alias_label := concat('개인', regexp_replace(p_target_label, '^(수도권|National)\s*', ''));
    select id into v_competitor_target_id from targets where label = v_alias_label;
  end if;

  return query
  with competitor_avgs as (
    select cr.competitor_name, avg(cr.rating) as avg_rating
    from competitor_ratings cr
    join competitors comp on comp.competitor_name = cr.competitor_name
    where comp.channel_id = v_channel_id
      and cr.target_id = v_competitor_target_id
      and cr.broadcast_date between p_date_from and p_date_to
    group by cr.competitor_name
    having avg(cr.rating) is not null
    order by avg_rating desc
    limit 3
  )
  select
    v_our_rating,
    avg(ca.avg_rating),
    case
      when avg(ca.avg_rating) is null or v_our_rating is null then null
      else least(100, round((avg(ca.avg_rating) / nullif(v_our_rating, 0)) * 100, 1))
    end,
    coalesce(jsonb_agg(jsonb_build_object('name', ca.competitor_name, 'rating', round(ca.avg_rating, 5)) order by ca.avg_rating desc), '[]'::jsonb)
  from competitor_avgs ca;
end;
$$;
comment on function get_competitive_pressure is 'Competitive Pressure(0~100, 100 클램프) — 등록된 경쟁채널 중 상위 3개의 일평균 시청률 ÷ 자사 일평균 시청률. "동시간대"가 아니라 기간 평균 기준(원본 파일 한계, DATA_DICTIONARY.md 참고). 경쟁채널 데이터가 전혀 없으면 100이 아니라 NULL 반환(2026-08-19 수정: LEAST(100,NULL) 버그 및 ENA 계열 타깃 라벨 불일치 수정)';
