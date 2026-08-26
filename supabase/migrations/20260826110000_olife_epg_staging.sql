-- 사용자 지시(2026-08-26): "OLIFE 편성표(EPG) 업로드부분은 닐슨 데이터가 없어도 미리 등록을
-- 해놓을 수 있게 해줘" — 지금까지는 olife-epg 업로드 시 그 날짜의 Nielsen ratings 행이 이미
-- 있어야만(episode_number를 UPDATE로 채우는 방식이라) 매칭이 됐고, 없으면 "닐슨 데이터가
-- 아직 없습니다"로 그냥 버려졌다(엑셀을 다시 올려야 했음). 파싱된 EPG 원본을 항상 이 표에
-- 저장해두고, Nielsen 일별 파일이 나중에 들어오면(nielsenIngest.ts) 그 시점에 자동으로
-- 매칭·반영한다.
create table olife_epg_staging (
  id uuid primary key default gen_random_uuid(),
  broadcast_date date not null,
  start_time time not null,
  end_time time,
  program_name_raw text not null,
  episode_number int,
  subtitle text,
  run_type text,
  uploaded_at timestamptz not null default now(),
  unique (broadcast_date, start_time, program_name_raw)
);
comment on table olife_epg_staging is 'OLIFE EPG(일일운행표) 업로드 원본을 Nielsen 데이터 유무와 무관하게 보관 — Nielsen 일별 파일이 나중에 들어오면 nielsenIngest.ts가 이 표를 조회해 ratings.episode_number/episode_subtitle을 자동으로 채운다(2026-08-26). 이미 매칭이 끝난 뒤에도 재사용(재업로드) 가능하도록 삭제하지 않고 남겨둔다.';

create index olife_epg_staging_date_idx on olife_epg_staging (broadcast_date);
