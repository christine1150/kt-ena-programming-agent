-- 사용자 지시(2026-09-07): "관리자 페이지에서 월간/연간 리포트 등을 세부 내역으로 올리게
-- 되어 있는데, 엑셀 파일을 올리면 우리가 약속한 논리대로 분석해서 자동으로 리포트를 작성 및
-- 보완하여 같이 배포하는 것으로 수정."
--
-- 조사 결과(2026-09-07): 이 요청이 가리키는 화면(관리자 "월간 콘텐츠 리뷰(장르별·프로그램별
-- 추이)" 폼, channel_monthly_content_review/20260902150000)은 실제로는 **어디에도 렌더링되지
-- 않는 죽은 테이블**이었다 — Page 1의 "월간 리뷰" 하단 참고 자료 블록은 하루 뒤(2026-09-03)에
-- 새로 만들어진 channel_monthly_genre_trend/channel_monthly_program_trend 두 테이블만 읽는다
-- (route.ts 확인 완료). 즉 PD가 그 폼에 정성껏 입력해도 화면에 전혀 반영되지 않고 있었다.
--
-- 이번에 관리자 화면을 "엑셀 업로드 → 자동 파싱 → 실제로 화면에 반영되는 두 테이블에 직접
-- upsert"로 다시 만들면서, 옛 폼에는 있었지만 두 테이블에는 담을 자리가 없던 "서술형
-- 하이라이트"(narrative_text)만 이 작은 새 테이블로 옮겨 살린다 — 장르별/프로그램별처럼
-- 여러 행이 아니라 "채널+연+월당 문단 하나"라 별도 테이블이 자연스럽다(genre_trend/
-- program_trend와 같은 설계 원칙: 닐슨 원자료와 분리, 참고 자료 전용, KPI 계산에 안 씀).
-- market_top_channels(시장 TOP10)는 옮기지 않는다 — 이미 nielsen_period_rank(§O)가 실제
-- 닐슨 원자료로 더 정확한 시장 순위를 자동으로 제공하고 있어, 사람이 옮겨 적은 2차 스크린샷
-- 값을 별도로 유지할 이유가 없다(중복·낮은 신뢰도 데이터를 새로 만들지 않는다).
--
-- channel_monthly_content_review 테이블 자체는 삭제하지 않는다 — 기존에 PD가 입력해둔 값이
-- 있을 수 있어 데이터 보존 차원에서 그대로 둔다(CLAUDE.md: 삭제는 사용자 최종 확인 후에만).
-- 다만 이 테이블을 쓰던 관리자 폼(MonthlyContentReviewManager.tsx)과 그 API 라우트는
-- trash-can/으로 옮긴다(코드에서는 더 이상 참조하지 않음).
create table if not exists channel_monthly_narrative (
  channel_code text not null,
  year int not null,
  month int not null check (month between 1 and 12),
  narrative_text text not null,
  source_note text,
  updated_at timestamptz not null default now(),
  -- 같은 달 자료를 다시 올리면 최신값으로 덮어쓴다(genre_trend/program_trend와 동일 원칙).
  primary key (channel_code, year, month)
);
comment on table channel_monthly_narrative is '사내 "전체 채널 월간 추이" 자료의 서술형 하이라이트(환경/등록/상승여력 등 원문) — channel_monthly_genre_trend/program_trend와 같은 원칙(참고 자료 전용, KPI 계산에 안 씀)으로 분리 보관(2026-09-07).';

create index if not exists idx_channel_monthly_narrative_lookup on channel_monthly_narrative (channel_code, year, month);
