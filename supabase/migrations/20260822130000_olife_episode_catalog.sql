-- 사용자 지시(2026-08-22): "OLIFE 채널(세계테마기행/극한직업/걸어서 세계속으로)은 방문 국가·
-- 도시·부제에 따라 시청률이 크게 갈리므로, 관리자가 별도로 주는 EBS 콘텐츠 리스트(회차·부제
-- 카탈로그)를 결합해 국가/부제/테마 메타데이터를 데이터베이스화하라"는 요청 — 최소 테이블 원칙
-- (CLAUDE.md)에 따라 새 테이블 하나만 추가한다. 국가(country_guess)는 사전 매칭 성공 시에만 채우고
-- (추측 금지), 도시로 보이는 부분(detail_tail)은 "도시"라고 단정하지 않고 구조적 위치(마지막 콤마
-- 뒤)로만 표기한다 — src/lib/olifeEpisodeParsing.ts 문서 주석 참고.
create table if not exists olife_episode_catalog (
  id uuid primary key default gen_random_uuid(),
  series_name text not null check (series_name in ('세계테마기행', '극한직업', '한국기행')),
  bis_episode_number text,
  subtitle_raw text not null,
  subtitle_norm text not null,
  series_lead text not null,
  detail_tail text,
  country_guess text,
  themes text[] not null default '{}',
  source_file text not null,
  created_at timestamptz not null default now(),
  unique (series_name, subtitle_norm)
);
create index if not exists olife_episode_catalog_norm_idx on olife_episode_catalog (subtitle_norm);
create index if not exists olife_episode_catalog_series_idx on olife_episode_catalog (series_name);

comment on table olife_episode_catalog is 'OLIFE 세계테마기행/극한직업/한국기행 회차 카탈로그(관리자가 제공하는 EBS 콘텐츠 리스트 업로드로 채움) — Nielsen ratings.episode_subtitle과 subtitle_norm으로 매칭해 국가/부제/테마 메타데이터를 보완한다.';
comment on column olife_episode_catalog.bis_episode_number is 'EBS 카탈로그의 BIS등록회차(방송사 고유 채번 — Nielsen/EPG의 "회차"와는 다른 번호 체계, 실측 확인됨. 매칭은 회차 숫자가 아니라 subtitle_norm 텍스트 일치로 한다).';
comment on column olife_episode_catalog.country_guess is '부제 원문에서 국가 사전(COUNTRY_DICTIONARY) 매칭에 성공했을 때만 채워지는 참고용 국가명 — 매칭 안 되면 NULL(추측하지 않음).';
comment on column olife_episode_catalog.detail_tail is '부제 마지막 콤마 뒤 조각(구조적 추출) — 도시/장소인 경우가 많지만 항상 그렇다고 단정하지 않는다.';
comment on column olife_episode_catalog.themes is '극한직업 전용 — 키워드 기반 규칙 분류(참고용, 중복 가능). 나머지 시리즈는 빈 배열.';
