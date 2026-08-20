-- 사용자 피드백: Competitive Pressure(채널 단위 근사)만으로는 "동시간대 경쟁채널이 어떤
-- 프로그램으로 몇시에 좋은 성적을 냈는가"를 알 수 없다. §1.2 `OOO경쟁채널시청률` 시트의
-- 우측 블록(페어링된 경쟁채널의 프로그램 단위 데이터)을 지금까지 저장하지 않았는데
-- (개발 단위 7번 설계 결정), 실제 파일로 재확인해보니 페어링이 날짜와 무관하게 고정돼
-- 있다: ENA↔tvN, ENA DRAMA↔ENA STORY(자사), ENA PLAY↔MBC every1. 이 데이터를 새로 저장해
-- Page 2 COMPARED WITH?에 실제 프로그램 단위 인사이트를 제공한다.
--
-- **한계(정직하게 밝힘)**: 이 페어링은 채널당 1개뿐이라(Competitor Master에 등록된 전체
-- 경쟁채널이 아님), "그 시간대 시장 전체에서 무엇이 잘 됐는지"가 아니라 "이 1개 페어링
-- 경쟁채널이 그 시간대 무엇을 편성했는지"만 보여준다 — DATA_DICTIONARY.md에 문서화.
create table competitor_program_ratings (
  id uuid primary key default gen_random_uuid(),
  broadcast_date date not null,
  our_channel_id uuid not null references channels(id) on delete cascade,
  competitor_name text not null,
  start_time time not null,
  end_time time,
  program_name text not null,
  target_label text,
  rating numeric,
  share numeric,
  created_at timestamptz not null default now(),
  unique (broadcast_date, our_channel_id, start_time, program_name)
);
create index idx_competitor_program_ratings_lookup on competitor_program_ratings (our_channel_id, broadcast_date);
comment on table competitor_program_ratings is 'Nielsen 일별 파일 §1.2 OOO경쟁채널시청률 시트의 우측 블록(페어링된 경쟁채널 1개, 프로그램 단위). 채널당 경쟁채널 1개뿐인 한계가 있음(DATA_DICTIONARY.md 참고). ENA↔tvN, ENA DRAMA↔ENA STORY(자사), ENA PLAY↔MBC every1로 고정 확인됨.';
