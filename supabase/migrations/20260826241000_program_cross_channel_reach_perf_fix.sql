-- 성능 수정(2026-08-26, 직전 마이그레이션 직후 실측) — get_program_cross_channel_reach를
-- OLIFE·최근 1년으로 실행하니 57014(statement timeout)로 실패했다. 원인: 대상 채널을
-- our_channel_id로 좁히지 않는 설계상(경쟁채널 등록 채널 전체를 훑어야 하는 요구사항)
-- competitor_program_ratings(41만6천+행) 전체에 매번 regexp_replace를 계산해 제목을
-- 정규화하고 있었다 — 인덱스를 못 타 사실상 매 쿼리마다 전체 테이블을 스캔+정규화했다.
--
-- 정규화된 제목을 생성 컬럼(generated always as ... stored)으로 미리 계산해 인덱스를 걸면,
-- 쿼리 시점엔 인덱스 조회만 하면 된다(programs 쪽도 972행뿐이라 병목은 아니지만 같은 방식으로
-- 통일 — 나중에 이 컬럼을 다른 함수에서도 재사용할 수 있게).
alter table competitor_program_ratings
  add column if not exists norm_program_name text
  generated always as (
    regexp_replace(regexp_replace(program_name, '<본>|<재>', '', 'g'), '[^가-힣a-zA-Z0-9]', '', 'g')
  ) stored;

create index if not exists competitor_program_ratings_norm_name_idx
  on competitor_program_ratings (norm_program_name);

create index if not exists competitor_program_ratings_broadcast_date_idx
  on competitor_program_ratings (broadcast_date);

alter table programs
  add column if not exists norm_canonical_name text
  generated always as (
    regexp_replace(regexp_replace(canonical_name, '<본>|<재>', '', 'g'), '[^가-힣a-zA-Z0-9]', '', 'g')
  ) stored;

create index if not exists programs_norm_canonical_name_idx
  on programs (norm_canonical_name);

-- 함수 재정의 — inline regexp_replace 대신 위 인덱스 걸린 생성 컬럼을 그대로 join 조건에 쓴다
-- (계산 로직 자체는 동일 — 어느 컬럼에서 계산하느냐만 바뀜, 매칭 결과는 이전과 같음).
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
comment on function get_program_cross_channel_reach is '특정 채널(p_channel_code)이 방영한/방영 중인 프로그램과 같은 canonical title이 우리 소유 다른 채널 또는 등록된 모든 경쟁채널(어느 our_channel_id로 등록됐든, 대상 채널 자신의 등록 경쟁채널로 한정하지 않음)에 있는지 찾는다. (canonical_title, found_channel_label, target_label) 단위로 방영 횟수·기간·시간대·평균 시청률을 집계 — target_label이 여러 개면 뒤섞어 평균내지 않고 행을 분리해 그대로 보여준다(2026-08-26, ENA Play 오답 다음으로 신고된 OLIFE 사례 대응. 인덱스 걸린 생성 컬럼 사용으로 성능 수정).';
