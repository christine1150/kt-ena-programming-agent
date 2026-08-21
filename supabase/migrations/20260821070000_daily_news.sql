-- 사용자 지시(2026-08-21): 1페이지 "오늘의 빠른 요약" 위에 "주요 뉴스"(베타) 섹션 — 관리자가
-- 매일 텍스트로 업로드하면(형식은 추후 논의, 지금은 카테고리별 제목+링크 텍스트 붙여넣기)
-- 제목만 하이퍼링크로 보여준다(링크 주소 자체는 화면에 노출하지 않음). Channel Master의
-- original_review_programs와 동일한 패턴(업로드할 때마다 전체 교체)을 따른다.
create table if not exists daily_news_items (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  title text not null,
  url text not null,
  display_order int not null default 0,
  created_at timestamptz not null default now()
);
comment on table daily_news_items is '1페이지 "주요 뉴스"(베타) 섹션. 관리자가 매일 텍스트를 붙여넣으면 파싱되어 전체 교체된다(2026-08-21).';
