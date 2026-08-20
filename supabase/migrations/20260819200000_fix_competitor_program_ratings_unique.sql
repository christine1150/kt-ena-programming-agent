-- competitor_program_ratings 파서 버그 수정(nielsenDaily.ts)에 맞춰 스키마도 고친다.
-- 예전 파서는 "OOO경쟁채널시청률" 시트의 우측 블록 1개(페어링된 경쟁채널 1개)만 읽는다고
-- 봤는데, 실제로는 5행×2열 그리드에 등록된 경쟁채널 8~9개 전체의 프로그램 단위 하루 편성이
-- 있었다(DATA_DICTIONARY.md §1.2 참고, 실데이터 재검증 완료). 이제 채널 하나당 여러 경쟁채널이
-- 같은 (broadcast_date, our_channel_id, start_time)에 존재할 수 있으므로, 유니크 제약에
-- competitor_name을 추가해야 서로 다른 경쟁채널의 동시간대 프로그램이 충돌하지 않는다.
do $$
declare
  constraint_name text;
begin
  select con.conname into constraint_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  where rel.relname = 'competitor_program_ratings' and con.contype = 'u';

  if constraint_name is not null then
    execute format('alter table competitor_program_ratings drop constraint %I', constraint_name);
  end if;
end $$;

alter table competitor_program_ratings
  add constraint competitor_program_ratings_unique
  unique (broadcast_date, our_channel_id, competitor_name, start_time, program_name);

comment on table competitor_program_ratings is 'Nielsen 일별 파일 §1.2 OOO경쟁채널시청률 시트의 채널 블록 그리드(자사 채널 블록 제외 나머지 전부, 등록된 경쟁채널만) — 프로그램 단위. our_channel_id는 어느 시트에서 읽었는지(자사 채널 기준 provenance)를 나타낼 뿐, competitor_name+broadcast_date로 조회하면 그 경쟁채널의 실제 스케줄을 채널 구분 없이 그대로 쓸 수 있다(같은 경쟁채널이 여러 시트에 나타나지 않으므로 안전).';
