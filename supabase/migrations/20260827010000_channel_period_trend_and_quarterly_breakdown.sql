-- Phase B(2026-08-27, 사용자 지시: "Quarterly Report(12섹션)·Annual Report(15섹션) 전용
-- CJ ENM IR 문서와 Turning Point 자동 탐지 진행") — Quarterly Report의 "주별 추이",
-- Annual Report의 "월별 추이"·"분기별 스냅샷" 섹션에 쓸 집계 함수 3개.
--
-- get_channel_daily_rating_trend(20260826180000)와 동일한 WHERE절 패턴(channel_id/target_id/
-- source_type in ('nielsen_daily','skyuhd')/program_id is null)을 그대로 재사용하고, group by만
-- date_trunc('week'|'month', broadcast_date)로 바꾼다 — 계산(평균)은 여전히 SQL이 전담하고,
-- TypeScript는 이 결과를 그대로 라인차트 포인트/Turning Point 판정 입력으로만 쓴다(CLAUDE.md
-- "LLM/프론트가 계산하지 않는다" 원칙 유지). 전부 language sql(단일 SELECT)이라 plpgsql에서
-- 반복됐던 "RETURNS TABLE 컬럼명과 CTE 컬럼명이 겹쳐 ambiguous" 런타임 오류 위험이 없다.

create or replace function get_channel_weekly_rating_trend(
  p_channel_code text,
  p_target_label text,
  p_date_from date,
  p_date_to date
)
returns table (
  week_start date,
  avg_rating numeric,
  days_with_data bigint
)
language sql
stable
as $$
  select
    date_trunc('week', r.broadcast_date)::date as week_start,
    round(avg(r.rating)::numeric, 5) as avg_rating,
    count(distinct r.broadcast_date) as days_with_data
  from ratings r
  join channels c on c.id = r.channel_id
  join targets t on t.id = r.target_id
  where c.code = p_channel_code and t.label = p_target_label
    and r.source_type in ('nielsen_daily', 'skyuhd') and r.program_id is null
    and r.broadcast_date between p_date_from and p_date_to
    and r.rating is not null
  group by date_trunc('week', r.broadcast_date)
  order by week_start;
$$;
comment on function get_channel_weekly_rating_trend is 'Quarterly Report "주별 추이"/Turning Point 판정 입력 — 채널×타깃의 주 단위(ISO 월요일 시작) 채널 평균 시청률. get_channel_daily_rating_trend와 동일 WHERE 패턴, group by만 date_trunc(week)로 확장.';

create or replace function get_channel_monthly_rating_trend(
  p_channel_code text,
  p_target_label text,
  p_date_from date,
  p_date_to date
)
returns table (
  month_start date,
  avg_rating numeric,
  days_with_data bigint
)
language sql
stable
as $$
  select
    date_trunc('month', r.broadcast_date)::date as month_start,
    round(avg(r.rating)::numeric, 5) as avg_rating,
    count(distinct r.broadcast_date) as days_with_data
  from ratings r
  join channels c on c.id = r.channel_id
  join targets t on t.id = r.target_id
  where c.code = p_channel_code and t.label = p_target_label
    and r.source_type in ('nielsen_daily', 'skyuhd') and r.program_id is null
    and r.broadcast_date between p_date_from and p_date_to
    and r.rating is not null
  group by date_trunc('month', r.broadcast_date)
  order by month_start;
$$;
comment on function get_channel_monthly_rating_trend is 'Annual Report "월별 추이"/Turning Point 판정 입력 — 채널×타깃의 월 단위 채널 평균 시청률.';

-- Annual Report "분기별 스냅샷"(Q1~Q4, 진행 중인 분기는 p_date_to까지만) — text 코드를 직접 받아
-- API 라우트가 channel_id/target_id를 다시 조회하지 않게 한다. p_date_from과 p_date_to가 같은
-- 연도 안에 있다고 가정한다(YTD 프리셋은 항상 1/1~오늘이라 이 가정이 항상 성립).
--
-- 순위(rank)는 이 함수에 넣지 않는다 — 실제 DB 확인(2026-08-27) 결과 "타깃상세 시트" 라벨(예:
-- "수도권 2049")로 조회한 ratings 행은 rank가 전부 null이고, rank는 "랭킹 시트" 라벨(예:
-- "개인2049")로 저장된 별도 target_id 행에만 있다(DATA_DICTIONARY.md에 이미 문서화된 동의어
-- 표기차, targetResolution.ts가 다루는 문제). 이 함수는 p_target_label 하나만 받으므로 두 라벨을
-- 동시에 해석할 수 없어, 순위는 이 함수 대신 기존 "Annual Rank Snapshot" 섹션(YTD 순위, Page 1과
-- 동일하게 이미 올바른 target_id로 해석된 get_channel_period_rank_and_rating 재사용)에서만 낸다 —
-- 잘못된(항상 null인) 값을 새로 만들지 않기 위함.
create or replace function get_channel_quarterly_breakdown(
  p_channel_code text,
  p_target_label text,
  p_date_from date,
  p_date_to date
)
returns table (
  quarter_num int,
  quarter_date_from date,
  quarter_date_to date,
  avg_rating numeric,
  days_with_data bigint
)
language sql
stable
as $$
  with bounds as (
    select
      q.n as quarter_num,
      make_date(extract(year from p_date_from)::int, (q.n - 1) * 3 + 1, 1) as qfrom,
      least(
        (make_date(extract(year from p_date_from)::int, (q.n - 1) * 3 + 1, 1) + interval '3 months' - interval '1 day')::date,
        p_date_to
      ) as qto
    from generate_series(1, 4) as q(n)
  )
  select
    b.quarter_num,
    b.qfrom as quarter_date_from,
    b.qto as quarter_date_to,
    round(avg(r.rating)::numeric, 5) as avg_rating,
    count(distinct r.broadcast_date) as days_with_data
  from bounds b
  left join ratings r on r.broadcast_date between b.qfrom and b.qto
    and r.channel_id = (select c.id from channels c where c.code = p_channel_code)
    and r.target_id = (select t.id from targets t where t.label = p_target_label)
    and r.source_type in ('nielsen_daily', 'skyuhd') and r.program_id is null
  where b.qfrom <= p_date_to
  group by b.quarter_num, b.qfrom, b.qto
  order by b.quarter_num;
$$;
comment on function get_channel_quarterly_breakdown is 'Annual Report "Quarterly Breakdown" 섹션 — Q1~Q4(진행 중인 분기는 p_date_to까지 클램프) 각각의 평균 시청률. 순위는 포함하지 않음(사유는 위 주석 — rank는 다른 target_id에만 있어 이 함수 파라미터로는 조회 불가, Annual Rank Snapshot 섹션에서 별도 처리).';
