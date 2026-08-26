-- 버그 수정(2026-08-26, 사용자 제보 "세계테마기행/극한직업/걸어서세계속으로는 거의 매일
-- 편성하는데 왜 안 보이거나 이상하게 나오지?") — 실측 확인 결과 두 가지가 겹친 문제였다.
--
-- 1) (근본 원인) own_channel_matches가 ratings.target_id를 필터링하지 않고 group by
--    target_label을 그대로 둬서, 같은 실제 방영 1건이 채널당 있는 인구통계 타깃 개수만큼
--    (전국 남0409/남10대/.../여60대+/유료가구 등 최대 17개) 행으로 뻥튀기됐다(실측: OLIFE
--    최근 1년 기준 own_channel_matches 2116행 vs competitor_matches 48행 — 거의 전부 이
--    뻥튀기였다). "극한직업 → ENA Story"가 정확히 이 패턴으로 17행이 됐었다.
-- 2) (증상 악화) 이 뻥튀기로 전체 결과가 2164행까지 불어나면서, PostgREST 기본 응답 상한
--    (1000행)에 걸려 "세계테마기행"처럼 own_channel 매치가 없고 competitor 매치 1건뿐인
--    항목이 통째로 잘려나갔다(SQL 자체는 정상 — 실측: canonical_title='세계테마기행'으로
--    직접 조회하면 ONT 465회 매치가 정확히 나옴).
--
-- 수정: own_channel_matches를 "매치된 채널(c2) 자신의 KPI 타깃"(src/lib/targetResolution.ts의
-- resolveProgramLevelTargetLabel과 동일 규칙을 SQL로 그대로 옮김) 하나로만 필터링한다 —
-- 어차피 채널마다 대표 시청률은 이 타깃 하나이므로 인구통계 17종을 다 보여줄 이유가 없다.
-- (executors.ts에도 방어적으로 .limit()을 추가해 앞으로 다시 1000행을 넘는 일이 생겨도
-- 조용히 잘리지 않고 명시적으로 제한되도록 함 — 같은 커밋에서 처리.)
create or replace function get_program_cross_channel_reach(
  p_channel_code text,
  p_date_from date,
  p_date_to date
)
returns table (
  canonical_title text,
  found_channel_label text,
  is_own_channel boolean,
  target_label text,
  broadcast_count bigint,
  first_broadcast_date date,
  last_broadcast_date date,
  typical_hours text,
  avg_rating numeric
)
language sql
stable
as $$
  with source_titles as (
    select distinct on (p.norm_canonical_name)
      p.norm_canonical_name as norm_title,
      p.canonical_name
    from ratings r
    join programs p on p.id = r.program_id
    join channels c on c.id = r.channel_id
    where c.code = p_channel_code
      and r.source_type = 'nielsen_daily'
      and r.broadcast_date between p_date_from and p_date_to
      and r.program_id is not null
  ),
  own_channel_matches as (
    select
      st.canonical_name as canonical_title,
      c2.name as found_channel_label,
      true as is_own_channel,
      t.label as target_label,
      count(*) as broadcast_count,
      min(r2.broadcast_date) as first_broadcast_date,
      max(r2.broadcast_date) as last_broadcast_date,
      string_agg(distinct lpad(extract(hour from r2.start_time)::text, 2, '0') || '시', ', ' order by lpad(extract(hour from r2.start_time)::text, 2, '0') || '시') as typical_hours,
      round(avg(r2.rating)::numeric, 5) as avg_rating
    from source_titles st
    join programs p2 on p2.norm_canonical_name = st.norm_title
    join ratings r2 on r2.program_id = p2.id
    join channels c2 on c2.id = r2.channel_id and c2.code <> p_channel_code
    join targets t on t.id = r2.target_id
      -- c2 자신의 KPI 타깃 하나로만 좁힌다(resolveProgramLevelTargetLabel과 동일 규칙).
      and t.label = case
        when c2.primary_target like '%유료방송가입가구%' then '전국 유료가구'
        else trim(replace(c2.primary_target, '개인', ''))
      end
    where r2.source_type = 'nielsen_daily'
      and r2.broadcast_date between p_date_from and p_date_to
      and r2.start_time is not null
    group by st.canonical_name, c2.name, t.label
  ),
  competitor_matches as (
    select
      st.canonical_name as canonical_title,
      dedup.competitor_name as found_channel_label,
      false as is_own_channel,
      dedup.target_label,
      count(*) as broadcast_count,
      min(dedup.broadcast_date) as first_broadcast_date,
      max(dedup.broadcast_date) as last_broadcast_date,
      string_agg(distinct lpad(extract(hour from dedup.start_time)::text, 2, '0') || '시', ', ' order by lpad(extract(hour from dedup.start_time)::text, 2, '0') || '시') as typical_hours,
      round(avg(dedup.rating)::numeric, 5) as avg_rating
    from source_titles st
    join (
      select distinct on (competitor_name, program_name, broadcast_date, start_time, target_label)
        competitor_name, program_name, broadcast_date, start_time, target_label, rating, norm_program_name
      from competitor_program_ratings
      where broadcast_date between p_date_from and p_date_to
        and start_time is not null
    ) dedup
      on dedup.norm_program_name = st.norm_title
    group by st.canonical_name, dedup.competitor_name, dedup.target_label
  )
  select * from own_channel_matches
  union all
  select * from competitor_matches
  order by canonical_title, broadcast_count desc;
$$;
comment on function get_program_cross_channel_reach is '특정 채널(p_channel_code)이 방영한/방영 중인 프로그램과 같은 canonical title이 우리 소유 다른 채널 또는 등록된 모든 경쟁채널(어느 our_channel_id로 등록됐든, 대상 채널 자신의 등록 경쟁채널로 한정하지 않음)에 있는지 찾는다. own_channel 쪽은 매치된 채널 자신의 KPI 타깃 하나로만 집계(2026-08-26 수정 — 이전엔 인구통계 타깃마다 행이 뻥튀기됐음). target_label이 여러 개(경쟁채널 쪽, our_channel_id 등록에 따라 다를 수 있음)면 뒤섞어 평균내지 않고 행을 분리한다.';
