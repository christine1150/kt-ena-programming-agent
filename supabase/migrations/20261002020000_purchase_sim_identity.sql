-- 콘텐츠 구매 시뮬레이터 1단계: Program Identity Resolution 기반(사용자 지시 2026-10-02).
--
-- 목적: 사용자가 "라디오스타", "라디오스따", "황금어장" 같은 불완전한 입력을 해도 DB에 실제 존재하는
-- 프로그램(정규화 키)을 후보로 찾는다. 검색은 이 마이그레이션의 테이블·RPC가 후보를 가져오고(PostgreSQL
-- 중심, pg_trgm 인덱스), 점수화·확정 판단은 TypeScript가 결정론적으로 한다(src/lib/purchaseSim).
--
-- 새 테이블을 만든 이유: 기존 programs 는 채널별 행(같은 프로그램이 채널마다 별도 id), 경쟁사 프로그램은
-- programs 에 아예 없고 competitor_program_target_ratings 의 이름 문자열뿐이라 "한 프로그램 = 한 행"인
-- 식별 계층이 없다. 이 계층은 자사·경쟁사 이름을 같은 정규화 키로 합쳐 기존 데이터를 읽기만 한다(원본 불변).
--  - program_identity: 정규화 키 단위 1행(자사/경쟁사 방영 현황·자모 분해 키). 별칭 그룹(group_key) 포함.
--  - program_alias: 같은 프로그램의 이름 변형(확정은 규칙 기반 + DB에 실제 존재하는 이름만, 후보는 사람 승인 대기).
-- LLM이 만든 별칭은 여기에 넣지 않는다(DB 근거 없는 별칭 자동 등록 금지).
create extension if not exists pg_trgm;

-- 한글 음절을 자모(호환 자모)로 분해 — "라디오스따"와 "라디오스타"처럼 자음 하나 차이를 trigram이 잡게 한다.
create or replace function purchase_hangul_jamo(p text)
returns text
language sql
immutable
parallel safe
as $$
  select coalesce(string_agg(
    case when ascii(t.c) between 44032 and 55203 then
      (array['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'])[((ascii(t.c) - 44032) / 588) + 1]
      || (array['ㅏ','ㅐ','ㅑ','ㅒ','ㅓ','ㅔ','ㅕ','ㅖ','ㅗ','ㅘ','ㅙ','ㅚ','ㅛ','ㅜ','ㅝ','ㅞ','ㅟ','ㅠ','ㅡ','ㅢ','ㅣ'])[(((ascii(t.c) - 44032) % 588) / 28) + 1]
      || (array['','ㄱ','ㄲ','ㄳ','ㄴ','ㄵ','ㄶ','ㄷ','ㄹ','ㄺ','ㄻ','ㄼ','ㄽ','ㄾ','ㄿ','ㅀ','ㅁ','ㅂ','ㅄ','ㅅ','ㅆ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'])[((ascii(t.c) - 44032) % 28) + 1]
    else t.c end, '' order by t.ord), '')
  from regexp_split_to_table(coalesce(p, ''), '') with ordinality as t(c, ord)
$$;

-- 프로그램 정규화 키: <본>/<재> 등 태그 제거 → 한글·영문·숫자만 → 영문 대문자. 경쟁사 norm_program_name 과 같은
-- 규칙이다(그 컬럼은 대문자화만 안 되어 있음). 시즌 숫자·스페셜 접미는 지우지 않는다(별개 프로그램 규칙).
create or replace function purchase_norm_key(p text)
returns text
language sql
immutable
parallel safe
as $$
  select upper(regexp_replace(regexp_replace(coalesce(p, ''), '<[^>]*>', '', 'g'), '[^가-힣a-zA-Z0-9]', '', 'g'))
$$;

create table program_identity (
  key text primary key,                 -- purchase_norm_key(이름)
  display_name text not null,           -- 화면 표시용(자사 canonical_name 우선, 없으면 경쟁사 최빈 표기)
  jamo_key text not null,               -- purchase_hangul_jamo(key) — 오타 검색용
  group_key text not null,              -- 별칭 그룹 대표 키(별칭이 없으면 자기 자신)
  own_channels text[] not null default '{}',   -- 이 이름을 방영한 자사 채널 코드
  comp_channels text[] not null default '{}',  -- 이 이름을 방영한 경쟁채널명
  airings_total int not null default 0,        -- 전 기간 방영 수(자사+경쟁, 방영 단위)
  airings_91d int not null default 0,          -- 기준일 직전 91일 방영 수
  first_date date,
  last_date date,
  is_special boolean not null default false,   -- 스페셜·특집·특별판·몰아보기·하이라이트·베스트 (본편과 별개 프로그램)
  updated_at timestamptz not null default now()
);
create index program_identity_key_trgm on program_identity using gin (key gin_trgm_ops);
create index program_identity_jamo_trgm on program_identity using gin (jamo_key gin_trgm_ops);
create index program_identity_group_idx on program_identity (group_key);

create table program_alias (
  alias_key text primary key,           -- 변형 이름의 정규화 키
  group_key text not null,              -- 같은 프로그램으로 보는 대표 키
  rule text not null,                   -- label_paren | since | label_prefix | manual
  status text not null default 'candidate' check (status in ('confirmed', 'candidate')),
  source text not null default 'RULE_DB', -- RULE_DB(DB에 존재하는 이름 규칙) | MANUAL(사람 승인)
  note text,
  created_at timestamptz not null default now(),
  check (alias_key <> group_key)
);
create index program_alias_group_idx on program_alias (group_key);

alter table program_identity enable row level security;
alter table program_alias enable row level security;

comment on table program_identity is '정규화 키 단위 프로그램 식별 계층(2026-10-02, 구매 시뮬레이터). 자사 programs·ratings 와 경쟁사 competitor_program_target_ratings 이름을 같은 키로 합친 읽기 전용 파생 테이블이며 refresh_program_identity() 로 재생성한다.';
comment on table program_alias is '같은 프로그램의 이름 변형. confirmed 만 prediction 의 같은 콘텐츠 그룹에 쓰이고 candidate 는 사람 승인 전까지 검색 후보로만 노출된다. LLM이 만든 별칭은 등록 금지.';

-- 재생성: 방영 현황은 매번 새로 계산하고 group_key 는 program_alias(confirmed)를 반영한다.
create or replace function refresh_program_identity()
returns jsonb
language plpgsql
set statement_timeout = '300s'
as $$
declare
  v_asof date;
  v_rows int;
begin
  select max(r.broadcast_date) into v_asof from ratings r where r.source_type = 'nielsen_daily';

  create temporary table if not exists tmp_identity_stats (k text, disp text, own_chans text[], comp_chans text[], n_total int, n_91 int, d0 date, d1 date) on commit delete rows;
  insert into tmp_identity_stats
  with comp as (
    select upper(c.norm_program_name) as k,
           mode() within group (order by regexp_replace(c.program_name, '<[^>]*>', '', 'g')) as disp,
           array_agg(distinct c.competitor_name) as chans,
           count(*)::int as n_total,
           count(*) filter (where c.broadcast_date > v_asof - 91)::int as n_91,
           min(c.broadcast_date) as d0,
           max(c.broadcast_date) as d1
    from competitor_program_target_ratings c
    where c.target_label = '개인2049'
    group by upper(c.norm_program_name)
  ),
  own as (
    select purchase_norm_key(p.canonical_name) as k,
           (array_agg(p.canonical_name order by length(p.canonical_name) desc))[1] as disp,
           array_agg(distinct ch.code) as chans,
           sum(s.n)::int as n_total,
           sum(s.n91)::int as n_91,
           min(s.d0) as d0,
           max(s.d1) as d1
    from programs p
    join channels ch on ch.id = p.channel_id
    join lateral (
      select count(distinct (r.broadcast_date, r.start_time))::int as n,
             count(distinct (r.broadcast_date, r.start_time)) filter (where r.broadcast_date > v_asof - 91)::int as n91,
             min(r.broadcast_date) as d0,
             max(r.broadcast_date) as d1
      from ratings r
      where r.program_id = p.id and r.source_type = 'nielsen_daily'
    ) s on s.n > 0
    group by purchase_norm_key(p.canonical_name)
  )
  select coalesce(o.k, c.k) as k,
         coalesce(o.disp, c.disp) as disp,
         coalesce(o.chans, '{}'::text[]) as own_chans,
         coalesce(c.chans, '{}'::text[]) as comp_chans,
         coalesce(o.n_total, 0) + coalesce(c.n_total, 0) as n_total,
         coalesce(o.n_91, 0) + coalesce(c.n_91, 0) as n_91,
         least(o.d0, c.d0) as d0,
         greatest(o.d1, c.d1) as d1
  from own o
  full outer join comp c on c.k = o.k
  where coalesce(o.k, c.k) <> '';

  delete from program_identity;
  insert into program_identity (key, display_name, jamo_key, group_key, own_channels, comp_channels, airings_total, airings_91d, first_date, last_date, is_special)
  select s.k, s.disp, purchase_hangul_jamo(s.k),
         coalesce((select a.group_key from program_alias a where a.alias_key = s.k and a.status = 'confirmed'), s.k),
         s.own_chans, s.comp_chans, s.n_total, s.n_91, s.d0, s.d1,
         s.k ~ '(스페셜|특집|특별판|몰아보기|하이라이트|베스트|SPECIAL)'
  from tmp_identity_stats s;
  get diagnostics v_rows = row_count;
  return jsonb_build_object('identity_rows', v_rows, 'as_of', v_asof);
end;
$$;

-- 별칭(confirmed) 변경 후 group_key 만 다시 맞춘다.
create or replace function apply_program_aliases()
returns int
language plpgsql
as $$
declare
  v_rows int;
begin
  update program_identity i
     set group_key = coalesce((select a.group_key from program_alias a where a.alias_key = i.key and a.status = 'confirmed'), i.key),
         updated_at = now();
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

-- 후보 검색: DB 후보만 가져온다(점수화·확정은 TS). p_q_key/p_q_jamo 는 TS가 같은 규칙으로 정규화해 넘긴다.
-- 매칭 경로: 정확/접두/포함(키·토큰) + 자모 trigram(오타). 반환 컬럼 이름 충돌을 피하려 jsonb 로 돌려준다.
create or replace function search_program_identity(
  p_q_key text,
  p_q_jamo text,
  p_tokens text[] default '{}',
  p_limit int default 40
)
returns jsonb
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  v_out jsonb;
begin
  perform set_config('pg_trgm.similarity_threshold', '0.22', true);
  perform set_config('pg_trgm.word_similarity_threshold', '0.45', true);

  select coalesce(jsonb_agg(to_jsonb(t) order by t.rank_hint desc, t.airings_91d desc, t.key), '[]'::jsonb)
    into v_out
  from (
    select i.key, i.group_key, i.display_name, i.own_channels, i.comp_channels,
           i.airings_total, i.airings_91d, i.first_date, i.last_date, i.is_special,
           (i.key = p_q_key) as is_exact,
           (p_q_key <> '' and i.key like p_q_key || '%') as is_prefix,
           (p_q_key <> '' and i.key like '%' || p_q_key || '%') as is_contains,
           similarity(i.jamo_key, p_q_jamo) as jamo_sim,
           word_similarity(p_q_jamo, i.jamo_key) as jamo_wsim,
           (select count(*) from unnest(p_tokens) tk where tk <> '' and i.key like '%' || tk || '%')::int as token_hits,
           (case when i.key = p_q_key then 4
                 when p_q_key <> '' and i.key like p_q_key || '%' then 3
                 when p_q_key <> '' and i.key like '%' || p_q_key || '%' then 2
                 else 1 end) as rank_hint
    from program_identity i
    where (p_q_key <> '' and i.key like '%' || p_q_key || '%')
       or (p_q_jamo <> '' and (i.jamo_key % p_q_jamo or p_q_jamo <% i.jamo_key))
       or exists (select 1 from unnest(p_tokens) tk where tk <> '' and i.key like '%' || tk || '%')
    order by (case when i.key = p_q_key then 4
                   when p_q_key <> '' and i.key like p_q_key || '%' then 3
                   when p_q_key <> '' and i.key like '%' || p_q_key || '%' then 2
                   else 1 end) desc,
             greatest(similarity(i.jamo_key, p_q_jamo), word_similarity(p_q_jamo, i.jamo_key)) desc,
             i.airings_91d desc
    limit greatest(p_limit, 1) * 3
  ) t;
  return v_out;
end;
$$;

-- 같은 별칭 그룹의 모든 키(예측에서 "같은 콘텐츠"로 묶는 단위).
create or replace function get_program_group_members(p_key text)
returns text[]
language sql
stable
as $$
  select coalesce(array_agg(m.key order by m.key), array[p_key])
  from program_identity m
  where m.group_key = coalesce((select i.group_key from program_identity i where i.key = p_key), p_key)
$$;

select refresh_program_identity();
