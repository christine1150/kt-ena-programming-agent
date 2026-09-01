-- O절(2026-09-01) — 닐슨 주간·월간 파일의 "기간 단위 시장 순위" 적재용 테이블 + 조회 함수.
--
-- 배경(실측): Nielsen Data/2026에는 일간 파일(10개 시트) 외에 주간(`(260824-260830).xls`)·
-- 월간(`(260801-260831).xls`) 파일이 있고, 이들은 **랭킹 시트 2개(유료방송가입가구/개인)만**
-- 담고 있다. 블록 구조는 일간 랭킹 시트와 완전히 동일해 기존 parseRankSheet()를 그대로 쓴다.
--
-- 이 데이터의 가치는 **기간 전체의 시장 순위**다. 일별 순위를 평균 낸 값과 기간 순위는 서로
-- 다른 값이라 daily 집계로는 만들 수 없다(H절에서 get_channel_quarterly_breakdown의 avg_rank가
-- 항상 null이라 그 컬럼을 아예 뺐던 문제가 이 데이터로 해소된다).
--
-- **왜 ratings 테이블에 넣지 않는가(중요)**: ratings.broadcast_date는 단일 날짜 전제이고 이
-- 프로젝트의 거의 모든 쿼리가 `broadcast_date between X and Y`로 필터한다. 주간 행을
-- broadcast_date=8/24로 넣으면 그 주의 일간 7행과 함께 잡혀 모든 평균·합계가 조용히 오염된다
-- (이번 세션에서 반복 확인한 실패 패턴 — 공유 자원을 나중 변경이 깨뜨림). 완전히 분리한다.
create table if not exists nielsen_period_rank (
  period_type text not null check (period_type in ('weekly','monthly')),
  date_from date not null,
  date_to date not null,
  channel_id uuid not null references channels(id) on delete cascade,
  target_id uuid not null references targets(id) on delete cascade,
  rank int,
  rating numeric,
  share numeric,
  reach numeric,
  time_spent_seconds numeric,
  source_file text,
  updated_at timestamptz not null default now(),
  -- 같은 기간 파일이 두 번 업로드돼도(실제로 260223-260301이 중복 존재) 안전하게 병합된다.
  primary key (period_type, date_from, date_to, channel_id, target_id)
);
comment on table nielsen_period_rank is '닐슨 주간·월간 파일의 기간 단위 시장 순위(랭킹 시트 2종). rank는 닐슨이 시장 전체에서 매긴 값이라 일별 순위 평균으로 대체할 수 없다. ratings와 완전히 분리해 일간 집계 오염을 원천 차단(2026-09-01, O절).';

create index if not exists idx_nielsen_period_rank_lookup on nielsen_period_rank (channel_id, target_id, period_type, date_to desc);

-- 마스터 프롬프트 Weekly 최우선 요구(①Channel Ranking Movement: "#47 → #28 ▲19")를 SQL이 직접
-- 계산해 돌려준다. p_as_of_date 이하에서 가장 최근 두 기간을 골라 나란히 반환 — 기간이 하나뿐이면
-- prior_*가 null이고 rank_change도 null(없는 값을 0으로 만들지 않는다).
create or replace function get_channel_period_rank_movement(
  p_channel_code text,
  p_target_label text,
  p_period_type text,
  p_as_of_date date
)
returns table (
  current_from date,
  current_to date,
  current_rank int,
  current_rating numeric,
  prior_from date,
  prior_to date,
  prior_rank int,
  prior_rating numeric,
  rank_change int
)
language sql
stable
as $$
  with recent as (
    select r.date_from, r.date_to, r.rank, r.rating,
      row_number() over (order by r.date_to desc) as rn
    from nielsen_period_rank r
    join channels c on c.id = r.channel_id
    join targets t on t.id = r.target_id
    where c.code = p_channel_code
      and t.label = p_target_label
      and r.period_type = p_period_type
      and r.date_to <= p_as_of_date
  )
  select
    cur.date_from, cur.date_to, cur.rank, cur.rating,
    pri.date_from, pri.date_to, pri.rank, pri.rating,
    -- 순위는 작을수록 좋으므로 (이전 - 현재)가 양수면 상승이다.
    case when cur.rank is not null and pri.rank is not null then pri.rank - cur.rank else null end
  from (select * from recent where rn = 1) cur
  left join (select * from recent where rn = 2) pri on true;
$$;
comment on function get_channel_period_rank_movement is 'O절(2026-09-01): 주간/월간 기간 단위 시장 순위의 최근 2개 기간을 나란히 반환(rank_change = 이전순위 - 현재순위, 양수면 상승). 기간이 하나뿐이면 prior_*·rank_change는 null.';
