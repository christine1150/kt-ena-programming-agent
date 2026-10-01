-- 시청률 자판기: 방영 이력이 없는 오리지널 드라마의 기본 길이 70분(2026-10-01 사용자 지시)
-- "연애박사 및 기타 오리지널 드라마는 70분 정도 돼. 기본적으로 그렇게 잡고 실제 데이터가 들어오면 수정 반영해"
-- 실측 길이(최근 3달 방영, 과거 방영 이력)가 있으면 그 값이 우선이고, 없을 때만 이 값을 쓴다.
update ideal_schedule_config
   set structure = structure || '{"default_runtime_by_genre": {"오리지널 드라마": 70}}'::jsonb,
       updated_by = 'migration:default-runtime', updated_at = now()
 where channel_id is null;
