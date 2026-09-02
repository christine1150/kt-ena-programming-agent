-- 사용자 지시(2026-09-02): "전체 채널 월간 추이(26년8월업데이트).xlsx" 같은 내용을 "PD 수동
-- 회차 리포트 업로드"에 맞게 반영 — 원본 파일이 사내 문서보안(DRM, "SCDSA004" 시그니처)으로
-- 암호화돼 있어 코드로 직접 열어 파싱할 수 없었고, 사용자가 스크린샷으로 내용을 보여줬다
-- (원본 복호화 사본은 다음 세션에 별도 전달 예정 — 그때 실제 파일 기반 업로드 파서를 붙인다).
--
-- program_manual_reports(회차 단위 PD 리포트, 20260826140000)와 완전히 다른 결(grain)의
-- 데이터라 그 테이블을 확장하지 않고 새 테이블로 분리했다 — program_manual_reports는
-- "채널+프로그램+방영일" 1건이 곧 그 회차의 상세 리뷰인 반면, 이건 "채널+연+월" 1건이 그 달
-- 전체(장르별 채널 평균 + 프로그램별 월간 추이 + 서술형 하이라이트 + 시장 TOP10)를 담는다.
-- program_manual_reports와 같은 설계 원칙(PD가 쓴 원문·수치를 그대로 저장, 재계산·재작성하지
-- 않음)을 그대로 따르되, 표가 여러 개(장르별/프로그램별/시장TOP10)라 각각 jsonb 배열로 둔다.
create table channel_monthly_content_review (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels(id) on delete cascade,
  year int not null,
  month int not null check (month between 1 and 12),
  -- 장르별 채널 평균 월간 추이 — [{category:"자체드라마(본)", avg_rating:0.854, comparison_pct:105.1}, ...]
  -- category는 자유 텍스트(예: "자체드라마(본)"/"자체드라마(재)"/"자체예능(본)"/"자체예능(재)"/
  -- "구매 드라마"/"기타"/"채널평균") — PD가 실제로 쓰는 표기를 그대로 받아들인다.
  genre_breakdown jsonb not null default '[]'::jsonb,
  -- 프로그램별 월간 추이(오리지널 드라마/예능 각 타이틀) —
  -- [{category:"자체드라마", program_name:"신병4(사보타주)", avg_rating:1.212, comparison_pct:null, note:"8월 4주차 첫 방송"}, ...]
  program_breakdown jsonb not null default '[]'::jsonb,
  -- PD가 작성한 서술형 하이라이트(환경/등록/상승여력 등) — 원문 그대로, 재작성하지 않음.
  narrative_text text,
  -- 시장 TOP10 채널 순위 스냅샷 — [{rank:1, channel_name:"MBC", rating:0.379, change:"▲1"}, ...]
  market_top_channels jsonb,
  source_note text, -- 자료 출처(예: "전체 채널 월간 추이(26년8월업데이트).xlsx, 스크린샷 옮겨적음")
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel_id, year, month)
);
comment on table channel_monthly_content_review is 'PD가 정리한 월간(장르별·프로그램별) 시청률 추이 + 서술형 하이라이트 — 채널+연+월 1건. 회차 단위 program_manual_reports와는 결이 달라 별도 테이블로 분리(2026-09-02). 원본 파일이 DRM 암호화돼 있어 당분간 관리자 화면에서 직접 입력(수동)으로 채운다.';

create index channel_monthly_content_review_lookup_idx on channel_monthly_content_review (channel_id, year, month);

-- 20260826160000과 동일한 접근 제어 모델: 서버(service_role)만 접근, anon/authenticated
-- 정책은 두지 않는다(관리자 인증은 자체 세션 쿠키라 auth.uid() 기반 정책이 의미 없음).
alter table channel_monthly_content_review enable row level security;
