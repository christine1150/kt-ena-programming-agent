-- IPTV 5순위 후속 — 구매 검토 이름 대응용 프로그램 키 목록을 빠르게 읽는다(2026-11-11).
-- 앞서 만든 iptv_peer_program_keys 는 기간 안 50만 행을 훑어 6초 넘게 걸렸다. 키는 program_key 인덱스를 건너뛰며 읽는
-- 느슨한 인덱스 스캔(재귀 CTE)으로 전체 고유 키만 가져온다. 기간·채널 구분은 뒤따르는 iptv_peer_record 가 하므로
-- 자사 전용 키가 섞여도 결과에 영향이 없다(그 함수는 경쟁·UHD 방영만 센다). 기존 함수는 건드리지 않는 신규 추가(멱등).
create or replace function iptv_all_program_keys()
returns table (program_key text)
language sql
stable
security definer
set search_path = public
as $$
  with recursive t as (
    (select a.program_key from iptv_tvindex_airings a order by a.program_key limit 1)
    union all
    select (select a.program_key from iptv_tvindex_airings a where a.program_key > t.program_key order by a.program_key limit 1)
    from t where t.program_key is not null
  )
  select t.program_key from t where t.program_key is not null;
$$;

revoke all on function iptv_all_program_keys() from public, anon, authenticated;
