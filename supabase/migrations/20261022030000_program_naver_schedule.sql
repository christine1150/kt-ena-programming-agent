-- 네이버 방송 정보 기반 본방 편성 저장(2026-10-22, 사용자 지시)
--
-- 사용자 지시: "네이버 검색은 장르 분류와 원 방송 종영일 확인에만 쓰이던 것을, 본방 시간대와 패턴 확인에도 사용해줘.
-- 예를 들어 매주 수요일 밤 10시대에는 '나는 솔로'가 ENA와 SBS Plus가 본방송을 한다는 것을 네이버를 통해 알았으면,
-- 이후의 분석이나 리포트 패턴 등에도 그 정보를 활용하면 돼. 회차도 네이버 검색으로 알게 된다면 함께 활용해.
-- 정확한 방영 시간은 입수된 닐슨 자료와 비교하면 분 단위까지 정확히 알 수 있게 되겠지."
--
-- 네이버 검색 상단 방송 카드의 '편성'(본방 채널·요일·시각·방송 기간)과 '회차정보'(최근 회차 번호·방송일)를
-- 프로그램 정규화 키(program_identity.key와 같은 규칙) 단위로 저장한다. 정확한 방영 시각은 여기 저장하지 않고
-- 분석 시점에 닐슨 방영 자료와 대조해 맞춘다(src/lib/broadcastPattern/inferRuns.ts).
-- 새 테이블만 추가한다(기존 테이블·함수 변경 없음). 서비스 롤로만 읽고 쓴다(RLS 켜고 정책 없음).

create table if not exists program_naver_schedule (
  program_key text primary key,        -- 프로그램 정규화 키(purchase_norm_key)
  title_raw text not null,             -- 검색에 쓴 우리 쪽 프로그램명
  status text not null check (status in ('found', 'not_found', 'review')),
                                       -- found=제목이 같은 카드를 찾음 / not_found=카드 없음 / review=카드 제목이 달라 사람이 확인
  matched_title text,                  -- 네이버가 찾은 제목(검토용)
  channels text[] not null default '{}',  -- 네이버 본방 채널 표기(동시 방송 포함, 예: {SBS Plus,ENA})
  start_date date,
  end_date date,                       -- 종영일(없으면 방송 중)
  slots jsonb not null default '[]'::jsonb,     -- [{"days":[2],"minute":1350}]  days 0=월…6=일(달력 요일), minute=자정부터 분
  episodes jsonb not null default '[]'::jsonb,  -- [{"no":276,"date":"2026-10-21"}] 최신순, 네이버가 보여 주는 최근 회차만
  fetched_at timestamptz not null default now()
);

create index if not exists program_naver_schedule_fetched_idx on program_naver_schedule (fetched_at);

alter table program_naver_schedule enable row level security;

comment on table program_naver_schedule is '네이버 방송 정보 기반 본방 편성(채널·요일·시각)과 최근 회차(2026-10-22). 프로그램 성과 등 분석이 닐슨 방영의 본방 여부·회차가 비었을 때 보완 근거로 쓴다. 정확한 시각은 닐슨 방영과 대조해 분석 시점에 맞춘다.';
