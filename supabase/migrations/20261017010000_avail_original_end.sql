-- 원 방송 종영일(Avail "종영 후 N개 채널"·"후방 N개채널" 메모 판정용, 2026-10-14)
-- 작품(권리 행의 content.canonicalKey)별로 원 방송사와 종영일을 한 줄씩 저장한다.
--  source = naver(네이버 조회 값) | manual(사람이 고친 값). manual은 다시 조회해도 덮어쓰지 않는다.
--  status = found(종영일 있음) | ongoing(방송 중) | not_found(검색 결과 없음) | review(검색된 제목이 달라 확인 필요 — 판정에 쓰지 않음)
-- 기존 테이블은 건드리지 않는다. 서버(service role)만 읽고 쓴다(다른 avail_* 테이블과 같은 RLS 설정).

create table if not exists avail_original_end (
  content_key   text primary key,
  title_raw     text not null,
  source        text not null check (source in ('naver', 'manual')),
  status        text not null check (status in ('found', 'ongoing', 'not_found', 'review')),
  broadcaster   text,
  start_date    date,
  end_date      date,
  matched_title text,
  note          text,
  updated_by    text,
  updated_at    timestamptz not null default now()
);

alter table avail_original_end enable row level security;
