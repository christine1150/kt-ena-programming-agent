-- 사용자 제보(2026-08-26): "ENA Play 주간 편성..." 질문 다음으로, "OLIFE 채널의 프로그램과
-- 같은 타이틀을 등록된 경쟁채널이 아니더라도 우리가 파악 가능한 모든 채널 편성에서 찾아줘"
-- 질문이 COMPETITIVE_HEAD_TO_HEAD(동시간대 등록 경쟁채널 겹침만 봄)로 잘못 답해진 사고.
-- 실제로 필요한 건 "동시간대 겹침"이 아니라 "같은 프로그램 타이틀이 다른 어느 채널에
-- 편성됐는지"이며, "등록 경쟁채널"로 한정하지 않고 competitor_program_ratings 전체(어느
-- our_channel_id로 등록됐든)를 훑어야 한다(예: OLIFE 자신은 ONT를 경쟁채널로 등록했지만,
-- KBS1의 "걸어서세계속으로"는 ENA 그룹 채널의 경쟁채널 시트에만 등록돼 있어도 찾아내야 함).
--
-- 프로그램명 매칭은 기존 정규화 규칙(src/lib/programNameMatch.ts의
-- normalizeProgramCanonicalName과 동일 — <본>/<재> 태그 제거 + 한글·영문·숫자 외 문자 제거)을
-- SQL에서 그대로 재현한다.
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
    -- p_channel_code가 이 기간에 편성한 프로그램들의 canonical title 집합(정규화된 타이틀 기준
    -- 중복 제거 — 동일 canonical_name이 회차별로 여러 programs 행일 수 있어 raw canonical_name도
    -- 대표값 하나로 같이 들고 간다).
    select distinct on (regexp_replace(regexp_replace(p.canonical_name, '<본>|<재>', '', 'g'), '[^가-힣a-zA-Z0-9]', '', 'g'))
      regexp_replace(regexp_replace(p.canonical_name, '<본>|<재>', '', 'g'), '[^가-힣a-zA-Z0-9]', '', 'g') as norm_title,
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
    -- 우리 소유 다른 6개 채널 중 같은 canonical title로 편성한 적이 있는지(자기 자신 채널 제외).
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
    join programs p2
      on regexp_replace(regexp_replace(p2.canonical_name, '<본>|<재>', '', 'g'), '[^가-힣a-zA-Z0-9]', '', 'g') = st.norm_title
    join ratings r2 on r2.program_id = p2.id
    join channels c2 on c2.id = r2.channel_id and c2.code <> p_channel_code
    join targets t on t.id = r2.target_id
    where r2.source_type = 'nielsen_daily'
      and r2.broadcast_date between p_date_from and p_date_to
      and r2.start_time is not null
    group by st.canonical_name, c2.name, t.label
  ),
  competitor_matches as (
    -- competitor_program_ratings 전체(어느 our_channel_id로 등록됐든) 중 같은 canonical
    -- title. 같은 실제 방영이 여러 our_channel_id 시트에 중복 등록됐을 수 있어(예: 같은
    -- 경쟁채널을 우리 채널 두 곳이 각자 등록) (경쟁채널명, 방영일시, 타깃)로 한 번만 센다.
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
        competitor_name, program_name, broadcast_date, start_time, target_label, rating
      from competitor_program_ratings
      where broadcast_date between p_date_from and p_date_to
        and start_time is not null
    ) dedup
      on regexp_replace(regexp_replace(dedup.program_name, '<본>|<재>', '', 'g'), '[^가-힣a-zA-Z0-9]', '', 'g') = st.norm_title
    group by st.canonical_name, dedup.competitor_name, dedup.target_label
  )
  select * from own_channel_matches
  union all
  select * from competitor_matches
  order by canonical_title, broadcast_count desc;
$$;
comment on function get_program_cross_channel_reach is '특정 채널(p_channel_code)이 방영한/방영 중인 프로그램과 같은 canonical title이 우리 소유 다른 채널 또는 등록된 모든 경쟁채널(어느 our_channel_id로 등록됐든, 대상 채널 자신의 등록 경쟁채널로 한정하지 않음)에 있는지 찾는다. (canonical_title, found_channel_label, target_label) 단위로 방영 횟수·기간·시간대·평균 시청률을 집계 — target_label이 여러 개면 뒤섞어 평균내지 않고 행을 분리해 그대로 보여준다(2026-08-26, ENA Play 오답 다음으로 신고된 OLIFE 사례 대응).';
