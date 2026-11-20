-- IPTV 보조 지표(iptv_program_block) 시간 초과 해소(2026-11-20).
-- 원인: iptv_tvindex_airings 가 175만 행(646MB)으로 커져, 같은 날짜의 경쟁(comp·uhd) 방영을 방영 건마다 되풀이해 읽는 peers_raw 단계가
--       방영 1건당 약 240ms(무작위 디스크 읽기)씩 걸려 12주 창에서 20초 제한을 넘겼다(행동과학자의 사건파일 시즌1 등 모든 작품 공통).
-- 조치: 그 단계가 읽는 열만 담은 부분 색인(경쟁·UHD 채널의 본방 표기 행만)을 추가해 표 본체를 읽지 않고 색인만으로 처리한다.
-- 신규 색인만 추가하며 기존 표·함수·데이터는 건드리지 않는다. 몇 번을 실행해도 같은 결과(멱등).

create index if not exists idx_iptv_airings_peer_cover
  on iptv_tvindex_airings (broadcast_date, target_kind)
  include (channel_name, program_key, program_name, rating, reach_viewers, avg_minute_viewers, start_minute, end_minute)
  where channel_group in ('comp', 'uhd') and not is_rerun_tag;

analyze iptv_tvindex_airings;
