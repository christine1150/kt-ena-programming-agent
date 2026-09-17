-- 성능 개선(2026-09-17, 사용자 지시: "닐슨 일일시청률 자료가 오면 미리 계산 해 두고 반영해서
-- 1페이지와 2페이지의 당일 데이터는 최대한 빨리 불러오게 할 수 있는지 알아보고 방법을 찾아서
-- 반영") — Page 1(채널 종합리포트)/Page 2(채널 딥다이브)가 "당일" 화면을 그릴 때 실행하는
-- 무거운 집계 RPC들의 **결과를 그대로** 담아두는 조회 전용 MART.
--
-- 설계 원칙(중요 — 이 파일을 고칠 사람이 반드시 읽을 것):
--  1) 계산식을 여기서 새로 만들지 않는다. 지금 화면이 부르는 **바로 그 함수**를 적재 시점에
--     한 번 실행해 결과 행을 jsonb로 저장해 둘 뿐이다. 그래서 화면 숫자가 달라질 수 없다
--     (CLAUDE.md Delta-Only — 목표는 "같은 값을 더 빨리 주는 것").
--  2) 저장할 때 그 함수에 넘긴 인자 전체를 args_fingerprint(문자열)로 함께 남긴다. 읽기
--     경로(src/lib/dailyMartCache.ts)는 자기가 넘기려던 인자로 같은 지문을 만들어 대조하고,
--     다르면 캐시를 쓰지 않고 기존처럼 실시간 RPC로 폴백한다 — 나중에 호출부 파라미터가
--     바뀌어도 "빠르지만 틀린 값"이 나올 수 없고 "느리지만 맞는 값"으로만 퇴화한다.
--  3) 아직 사전 계산되지 않은 날짜(과거 날짜 직접 조회 등)는 그냥 캐시 미스 → 기존 실시간
--     경로가 그대로 동작한다. 빈 화면이 되는 경로는 없다.
--
-- 선례: mart_scheduling_fit_score / refresh_fit_score_mart(20260819140000·20260820030000).
-- 같은 관례(as_of_date 하루치 단위, 트랜잭션 한정 statement_timeout 연장, 채널 단위 분할 호출)를 따른다.

-- ────────────────────────────────────────────────────────────────────────────
-- 0) 인자 지문(fingerprint) 헬퍼 — src/lib/dailyMartCache.ts의 martFingerprint()와 규칙 동일.
--    · 값들을 '|'로 잇는다  · NULL은 '~'  · 배열은 ','로 이어 붙인 뒤 한 조각으로 취급
-- ────────────────────────────────────────────────────────────────────────────
create or replace function mart_fp(variadic p_parts text[])
returns text
language sql
immutable
as $$
  select string_agg(coalesce(t.x, '~'), '|' order by t.ord)
  from unnest(p_parts) with ordinality as t(x, ord)
$$;
comment on function mart_fp is 'MART 캐시의 인자 지문 생성 — src/lib/dailyMartCache.ts의 martFingerprint()와 같은 규칙(NULL=~, 구분자=|).';

-- ────────────────────────────────────────────────────────────────────────────
-- 1) 랭킹 시트 표기 타깃 라벨 — src/lib/targetResolution.ts의 resolveRankSheetTargetLabel()을
--    SQL로 그대로 재현(resolve_program_target_label이 타깃상세 시트 표기용으로 이미 있는 것과
--    같은 짝). 표기 규칙 자체는 바꾸지 않았다.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function resolve_rank_target_label(p_primary_target text)
returns text
language sql
immutable
as $$
  select case
    when p_primary_target like '%유료방송가입가구%' then p_primary_target
    else trim(regexp_replace(p_primary_target, '^수도권\s*', ''))
  end
$$;
comment on function resolve_rank_target_label is 'src/lib/targetResolution.ts의 resolveRankSheetTargetLabel()과 동일 규칙을 SQL로 재현(일간 대시보드 MART 계산용).';

-- ────────────────────────────────────────────────────────────────────────────
-- 2) 캐시 테이블
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists mart_daily_dashboard_cache (
  as_of_date date not null,
  cache_slot text not null,                 -- 논리 슬롯명(아래 refresh 함수 주석 참고)
  channel_code text not null default '*',   -- '*' = 채널 무관(전 채널 공통 1건)
  args_fingerprint text not null,           -- 이 payload를 만들 때 함수에 넘긴 인자 지문
  payload jsonb not null,                   -- RPC 결과 행 배열(to_jsonb) 그대로
  computed_at timestamptz not null default now(),
  primary key (as_of_date, cache_slot, channel_code)
);
comment on table mart_daily_dashboard_cache is 'Page 1/Page 2 당일 화면용 집계 RPC 결과 캐시(2026-09-17). 값은 기존 RPC의 출력 그대로이며 여기서 새로 계산하지 않는다.';

-- 읽기 경로는 항상 "날짜 하나(또는 두세 개)의 전체 행"을 한 번에 가져가므로 as_of_date 인덱스면 충분.
create index if not exists idx_mart_daily_dashboard_cache_date on mart_daily_dashboard_cache (as_of_date);

-- ────────────────────────────────────────────────────────────────────────────
-- 3) LLM 서술 캐시 — 숫자(KPI)가 아니라 이미 확정된 숫자를 문장으로 옮긴 결과물만 담는다.
--    키에 입력값 지문(md5)이 들어가므로, 재업로드로 수치가 바뀌면 지문이 달라져 자동으로
--    새 문장이 생성된다(옛 문장이 남아 보이는 사고가 구조적으로 불가능).
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists mart_llm_text_cache (
  cache_key text primary key,   -- md5(kind + '|' + 입력 JSON)
  kind text not null,           -- 'channel_narrative' / 'original_insight' / 'briefing_report' ...
  as_of_date date,              -- 재업로드 시 통째로 비우기 위한 참조용(없으면 null)
  text_value text,
  created_at timestamptz not null default now()
);
comment on table mart_llm_text_cache is 'LLM 서술 생성 결과 캐시(2026-09-17). 같은 입력이면 같은 문장을 즉시 돌려줘 하루 첫 조회 이후의 OpenAI 왕복(호출당 최대 8초)을 없앤다 — 숫자는 여기서 만들지 않는다.';
create index if not exists idx_mart_llm_text_cache_date on mart_llm_text_cache (as_of_date);

-- ────────────────────────────────────────────────────────────────────────────
-- 4) 슬롯 하나를 계산해 저장하는 내부 헬퍼.
--    p_query는 "select * from get_xxx(...)" 형태의 완성된 SQL. 한 슬롯이 실패해도(함수 시그니처
--    변경·데이터 결손 등) 경고만 남기고 넘어간다 — 그 슬롯만 캐시 미스가 되어 읽기 경로가
--    실시간 계산으로 폴백하므로 화면은 정상 동작한다.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function mart_cache_put_query(
  p_as_of_date date,
  p_slot text,
  p_channel_code text,
  p_fingerprint text,
  p_query text
)
returns void
language plpgsql
as $$
declare
  v_payload jsonb;
begin
  execute format('select coalesce(jsonb_agg(to_jsonb(q)), ''[]''::jsonb) from (%s) q', p_query) into v_payload;

  insert into mart_daily_dashboard_cache (as_of_date, cache_slot, channel_code, args_fingerprint, payload, computed_at)
  values (p_as_of_date, p_slot, p_channel_code, p_fingerprint, coalesce(v_payload, '[]'::jsonb), now())
  on conflict (as_of_date, cache_slot, channel_code) do update
    set args_fingerprint = excluded.args_fingerprint,
        payload = excluded.payload,
        computed_at = excluded.computed_at;
exception when others then
  raise warning 'refresh_daily_dashboard_mart: 슬롯 %(%) 계산 실패 — % (이 슬롯만 캐시 미스로 남고 화면은 실시간 계산으로 폴백)', p_slot, p_channel_code, sqlerrm;
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 5) 갱신 함수
--    p_channel_code = null → 전 채널 + 채널 무관 슬롯 전부
--    p_channel_code = '*'  → 채널 무관 슬롯만
--    그 외                 → 해당 채널 슬롯만
--    (닐슨 적재 직후 TS가 '*' → 채널 7개 순서로 나눠 호출한다. refresh_fit_score_mart이
--     타임아웃 때문에 채널 단위로 쪼개 부르는 것과 같은 이유 — 20260826130000 주석 참고.)
--
--    슬롯 목록(읽기 경로 src/lib/dailyMartCache.ts의 MART_SLOT 상수와 1:1):
--      original_content_daily          get_original_content_daily(asOf)                       [채널 무관]
--      target_achievement_day          get_target_achievement(code, asOf, asOf, year)
--      trend_summary                   get_rating_trend_summary(code, matched, asOf)
--      narrative_28                    get_channel_daily_narrative(... 28일 baseline, 대표 4개 연령대)  [Page 1]
--      narrative_84                    get_channel_daily_narrative(... 84일 baseline, 대표 4개 연령대)  [Page 2 브리핑]
--      narrative_28_full               get_channel_daily_narrative(... 28일 baseline, 전체 12개 연령대) [Page 2 WHO IS WATCHING?]
--      killer_daypart                  get_channel_killer_content_daypart(code, prog, asOf)
--      overlap_kpi_30 / overlap_hh_30  get_competitor_program_overlap(..., p_limit=30)        [Page 1]
--      overlap_kpi_3  / overlap_hh_3   get_competitor_program_overlap(..., p_limit=3)         [Page 2]
--      top_programs_84                 get_channel_top_programs(code, prog, asOf, 84, 20)
--      top_share_84                    get_channel_top_share_programs(code, prog, asOf, 84, 5)
--      dow_hourblock_84                get_channel_dow_hourblock_pattern(code, prog, asOf, 84)
--      daypart_opportunity             get_channel_daypart_opportunity(code, prog, asOf, 365, 7)
--      hourblock_opportunity           get_channel_hourblock_opportunity(code, prog, asOf, 365, 7)
--      competitor_insight              get_competitor_insight_report(code, matched, asOf, 84, asOf)
--      hourly_baseline_84              get_hourly_rating_pattern(code, prog, asOf-83, asOf)
--      stable_slot_patterns            get_channel_stable_slot_patterns(code, prog, asOf, 12개 연령대, 8, 3)
--      demographic_program_highlights  get_channel_demographic_program_highlights(code, prog, 12개 연령대, asOf, 3, 8)
-- ────────────────────────────────────────────────────────────────────────────
create or replace function refresh_daily_dashboard_mart(
  p_as_of_date date,
  p_channel_code text default null
)
returns int
language plpgsql
as $$
declare
  rec record;
  v_year int := extract(year from p_as_of_date)::int;
  v_prog_label text;
  v_rank_label text;
  v_matched_label text;
  v_narrative_label text;
  v_narrative_prog_label text;
  v_narrative_demo text[];
  v_demo4 text[];
  v_demo12 text[];
  v_baseline_from date := p_as_of_date - 83;
  v_count int := 0;
  demo4_metro text[] := array['수도권 여20대','수도권 남20대','수도권 여40대','수도권 남40대'];
  demo4_national text[] := array['전국 여20대','전국 남20대','전국 여40대','전국 남40대'];
  demo12_metro text[] := array['수도권 남10대','수도권 여10대','수도권 남20대','수도권 여20대','수도권 남30대','수도권 여30대','수도권 남40대','수도권 여40대','수도권 남50대','수도권 여50대','수도권 남60대+','수도권 여60대+'];
  demo12_national text[] := array['전국 남10대','전국 여10대','전국 남20대','전국 여20대','전국 남30대','전국 여30대','전국 남40대','전국 여40대','전국 남50대','전국 여50대','전국 남60대+','전국 여60대+'];
  HOUSEHOLD_LABEL constant text := '전국 유료가구';
begin
  -- 콜드 계산이 기본 statement_timeout을 넘기지 않도록 이 트랜잭션에 한해 5분으로 연장
  -- (refresh_fit_score_mart 20260820030000과 동일한 처방·동일한 이유).
  perform set_config('statement_timeout', '300000', true);

  -- ── 채널 무관 슬롯 ──────────────────────────────────────────────────────
  if p_channel_code is null or p_channel_code = '*' then
    delete from mart_daily_dashboard_cache where as_of_date = p_as_of_date and channel_code = '*';
    -- 재업로드로 수치가 바뀌면 옛 문장이 남지 않도록 그 날짜의 LLM 서술 캐시도 비운다
    -- (입력 지문이 달라져 어차피 미스가 되지만, 쓸모없는 행을 남기지 않는다).
    delete from mart_llm_text_cache where as_of_date = p_as_of_date;

    perform mart_cache_put_query(
      p_as_of_date, 'original_content_daily', '*',
      mart_fp(p_as_of_date::text),
      format('select * from get_original_content_daily(%L::date)', p_as_of_date)
    );
    v_count := v_count + 1;
  end if;

  if p_channel_code = '*' then
    return v_count;
  end if;

  -- ── 채널별 슬롯 ────────────────────────────────────────────────────────
  for rec in
    select c.code, c.market, c.primary_target
    from channels c
    where c.primary_target is not null
      and c.code = any (array['ENA','ENA_DRAMA','ENA_PLAY','ENA_STORY','OLIFE','ONCE','SKYUHD'])
      and (p_channel_code is null or c.code = p_channel_code)
    order by c.code
  loop
    delete from mart_daily_dashboard_cache where as_of_date = p_as_of_date and channel_code = rec.code;

    v_prog_label := resolve_program_target_label(rec.primary_target);
    v_rank_label := resolve_rank_target_label(rec.primary_target);
    v_demo4 := case when rec.market = '전국' then demo4_national else demo4_metro end;
    v_demo12 := case when rec.market = '전국' then demo12_national else demo12_metro end;

    -- (1) 목표 달성률 — Page 1·Page 2 둘 다 여기서 matched_target_label을 얻어 다음 조회에 쓴다.
    perform mart_cache_put_query(
      p_as_of_date, 'target_achievement_day', rec.code,
      mart_fp(rec.code, p_as_of_date::text, p_as_of_date::text, v_year::text),
      format('select * from get_target_achievement(%L, %L::date, %L::date, %s)', rec.code, p_as_of_date, p_as_of_date, v_year)
    );
    -- 방금 저장한 결과에서 matched_target_label을 그대로 읽어 쓴다(같은 무거운 함수를 두 번
    -- 부르지 않기 위함 — 화면이 쓰는 값과 반드시 동일해야 하므로 재계산하지 않는다).
    select payload -> 0 ->> 'matched_target_label'
      into v_matched_label
      from mart_daily_dashboard_cache
     where as_of_date = p_as_of_date and cache_slot = 'target_achievement_day' and channel_code = rec.code;

    -- (2) DoD/WoW/... 추이 요약
    if v_matched_label is not null then
      perform mart_cache_put_query(
        p_as_of_date, 'trend_summary', rec.code,
        mart_fp(rec.code, v_matched_label, p_as_of_date::text),
        format('select * from get_rating_trend_summary(%L, %L, %L::date)', rec.code, v_matched_label, p_as_of_date)
      );
    end if;

    -- (3) 채널별 인사이트/오늘의 브리핑 원시 신호 — Page 1(28일) / Page 2(84일, 28일·전체 연령대).
    --     skyUHD만 호출 인자가 다르다(타깃 구분이 없어 랭킹 시트 표기·프로그램 타깃·연령대를
    --     쓰지 않음) — page1/route.ts의 skyuhdSignalResult 블록과 동일하게 맞춘다.
    if rec.code = 'SKYUHD' then
      v_narrative_label := v_matched_label;
      v_narrative_prog_label := '__없음__';
      v_narrative_demo := array[]::text[];
    else
      v_narrative_label := v_rank_label;
      v_narrative_prog_label := v_prog_label;
      v_narrative_demo := v_demo4;
    end if;

    if v_narrative_label is not null then
      perform mart_cache_put_query(
        p_as_of_date, 'narrative_28', rec.code,
        mart_fp(rec.code, v_narrative_label, v_narrative_prog_label, array_to_string(v_narrative_demo, ','), p_as_of_date::text, '28', '8', null),
        format('select * from get_channel_daily_narrative(%L, %L, %L, %L::text[], %L::date, 28, 8, null)',
               rec.code, v_narrative_label, v_narrative_prog_label, v_narrative_demo, p_as_of_date)
      );

      perform mart_cache_put_query(
        p_as_of_date, 'narrative_84', rec.code,
        mart_fp(rec.code, v_narrative_label, v_narrative_prog_label, array_to_string(v_narrative_demo, ','), p_as_of_date::text, '84', '8', null),
        format('select * from get_channel_daily_narrative(%L, %L, %L, %L::text[], %L::date, 84, 8, null)',
               rec.code, v_narrative_label, v_narrative_prog_label, v_narrative_demo, p_as_of_date)
      );
    end if;

    -- Page 2 WHO IS WATCHING?는 랭킹 시트 표기가 아니라 matched_target_label을, 대표 4개가
    -- 아니라 전체 12개 연령대를 쓴다(channel/route.ts whoIsWatchingDemographicsRes와 동일).
    if v_matched_label is not null and rec.code <> 'SKYUHD' then
      perform mart_cache_put_query(
        p_as_of_date, 'narrative_28_full', rec.code,
        mart_fp(rec.code, v_matched_label, v_prog_label, array_to_string(v_demo12, ','), p_as_of_date::text, '28', '8', null),
        format('select * from get_channel_daily_narrative(%L, %L, %L, %L::text[], %L::date, 28, 8, null)',
               rec.code, v_matched_label, v_prog_label, v_demo12, p_as_of_date)
      );
    end if;

    -- (4) 채널별 킬러 콘텐츠 강세/약세 시간대 — Page 1(INSIGHT_CHANNEL_ORDER, skyUHD 제외).
    if rec.code <> 'SKYUHD' then
      perform mart_cache_put_query(
        p_as_of_date, 'killer_daypart', rec.code,
        mart_fp(rec.code, v_prog_label, p_as_of_date::text, '28', '3'),
        format('select * from get_channel_killer_content_daypart(%L, %L, %L::date, 28, 3)', rec.code, v_prog_label, p_as_of_date)
      );
    end if;

    -- (5) 동시간대 경쟁 프로그램 — Page 1은 p_limit=30(순위 계산에 전체가 필요), Page 2는 기본값 3.
    perform mart_cache_put_query(
      p_as_of_date, 'overlap_kpi_30', rec.code,
      mart_fp(rec.code, v_prog_label, p_as_of_date::text, '30'),
      format('select * from get_competitor_program_overlap(%L, %L, %L::date, 30)', rec.code, v_prog_label, p_as_of_date)
    );
    perform mart_cache_put_query(
      p_as_of_date, 'overlap_kpi_3', rec.code,
      mart_fp(rec.code, v_prog_label, p_as_of_date::text, '3'),
      format('select * from get_competitor_program_overlap(%L, %L, %L::date, 3)', rec.code, v_prog_label, p_as_of_date)
    );
    if rec.code in ('ENA','ENA_PLAY','ENA_DRAMA') then
      perform mart_cache_put_query(
        p_as_of_date, 'overlap_hh_30', rec.code,
        mart_fp(rec.code, HOUSEHOLD_LABEL, p_as_of_date::text, '30'),
        format('select * from get_competitor_program_overlap(%L, %L, %L::date, 30)', rec.code, HOUSEHOLD_LABEL, p_as_of_date)
      );
      perform mart_cache_put_query(
        p_as_of_date, 'overlap_hh_3', rec.code,
        mart_fp(rec.code, HOUSEHOLD_LABEL, p_as_of_date::text, '3'),
        format('select * from get_competitor_program_overlap(%L, %L, %L::date, 3)', rec.code, HOUSEHOLD_LABEL, p_as_of_date)
      );
    end if;

    -- (6) Page 2 히트맵·TOP20·TOP점유율(모두 기본 진입 = 최근 84일 창)
    perform mart_cache_put_query(
      p_as_of_date, 'top_programs_84', rec.code,
      mart_fp(rec.code, v_prog_label, p_as_of_date::text, '84', '20', null, null),
      format('select * from get_channel_top_programs(%L, %L, %L::date, 84, 20, null, null)', rec.code, v_prog_label, p_as_of_date)
    );
    perform mart_cache_put_query(
      p_as_of_date, 'top_share_84', rec.code,
      mart_fp(rec.code, v_prog_label, p_as_of_date::text, '84', '5', null, null),
      format('select * from get_channel_top_share_programs(%L, %L, %L::date, 84, 5, null, null)', rec.code, v_prog_label, p_as_of_date)
    );
    perform mart_cache_put_query(
      p_as_of_date, 'dow_hourblock_84', rec.code,
      mart_fp(rec.code, v_prog_label, p_as_of_date::text, '84'),
      format('select * from get_channel_dow_hourblock_pattern(%L, %L, %L::date, 84)', rec.code, v_prog_label, p_as_of_date)
    );

    -- (7) Page 2 OPPORTUNITY? (4구간 · 8구간) — 보유 기간 전체(365일) 대비 최근 7일
    perform mart_cache_put_query(
      p_as_of_date, 'daypart_opportunity', rec.code,
      mart_fp(rec.code, v_prog_label, p_as_of_date::text, '365', '7'),
      format('select * from get_channel_daypart_opportunity(%L, %L, %L::date, 365, 7)', rec.code, v_prog_label, p_as_of_date)
    );
    perform mart_cache_put_query(
      p_as_of_date, 'hourblock_opportunity', rec.code,
      mart_fp(rec.code, v_prog_label, p_as_of_date::text, '365', '7'),
      format('select * from get_channel_hourblock_opportunity(%L, %L, %L::date, 365, 7)', rec.code, v_prog_label, p_as_of_date)
    );

    -- (8) Page 2 COMPARED WITH?
    if v_matched_label is not null then
      perform mart_cache_put_query(
        p_as_of_date, 'competitor_insight', rec.code,
        mart_fp(rec.code, v_matched_label, p_as_of_date::text, '84', p_as_of_date::text, null, null),
        format('select * from get_competitor_insight_report(%L, %L, %L::date, 84, %L::date, null, null)',
               rec.code, v_matched_label, p_as_of_date, p_as_of_date)
      );
    end if;

    -- (9) Page 2 시간대별 그래프의 최근 12주 기준선(연한 꺾은선)
    perform mart_cache_put_query(
      p_as_of_date, 'hourly_baseline_84', rec.code,
      mart_fp(rec.code, v_prog_label, v_baseline_from::text, p_as_of_date::text, null, null),
      format('select * from get_hourly_rating_pattern(%L, %L, %L::date, %L::date, null, null)',
             rec.code, v_prog_label, v_baseline_from, p_as_of_date)
    );

    -- (10) Page 2 고정 슬롯 패턴 / 연령대별 프로그램 이상치
    perform mart_cache_put_query(
      p_as_of_date, 'stable_slot_patterns', rec.code,
      mart_fp(rec.code, v_prog_label, p_as_of_date::text, array_to_string(v_demo12, ','), '8', '3'),
      format('select * from get_channel_stable_slot_patterns(%L, %L, %L::date, %L::text[], 8, 3)',
             rec.code, v_prog_label, p_as_of_date, v_demo12)
    );
    if rec.code <> 'SKYUHD' then
      perform mart_cache_put_query(
        p_as_of_date, 'demographic_program_highlights', rec.code,
        mart_fp(rec.code, v_prog_label, array_to_string(v_demo12, ','), p_as_of_date::text, '3', '8'),
        format('select * from get_channel_demographic_program_highlights(%L, %L, %L::text[], %L::date, 3, 8)',
               rec.code, v_prog_label, v_demo12, p_as_of_date)
      );
    end if;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;
comment on function refresh_daily_dashboard_mart is 'Page 1/Page 2 당일 화면용 집계 결과 사전 계산(2026-09-17). 기존 RPC의 출력을 그대로 저장할 뿐 새 계산식은 없다. 닐슨 일별 파일 적재 직후 src/lib/nielsenIngest.ts가 채널 단위로 나눠 호출한다.';

-- 보안(2026-09-17, 검토 중 누락 발견) — 이 저장소는 public 스키마의 모든 테이블에 RLS를
-- 켜고 anon/authenticated 정책은 하나도 두지 않는 것이 관례다(20260826160000, 20260909010000).
-- 서버는 service_role 키로 붙어 RLS를 무시하므로 앱 동작은 그대로이고, 브라우저 번들에
-- 노출되는 공개 anon 키로는 이 캐시 테이블을 읽거나 조작할 수 없게 된다. mart 테이블도
-- 예외가 아니다(mart_scheduling_fit_score 등 기존 mart 6종이 모두 켜져 있음) — 신규 테이블
-- 2개가 빠지면 Supabase Security Advisor의 rls_disabled_in_public 경고가 다시 뜬다.
alter table mart_daily_dashboard_cache enable row level security;
alter table mart_llm_text_cache enable row level security;
