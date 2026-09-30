-- 시청률 자판기 학습 기간을 최근 3달로(2026-10-01 사용자 지시)
-- "'시청률 자판기'는 최근 3달간의 실적을 바탕으로 이상적인 시청률을 얻을 수 있는 툴" — 3달 ≈ 90~93일.
-- 기존 84일(12주)을 91일(13주, 요일이 고르게 13번씩 들어가는 3달)로 맞춘다.
update ideal_schedule_config
   set expected_kpi = expected_kpi || '{"lookback_days": 91}'::jsonb,
       updated_by = 'migration:lookback-3months', updated_at = now()
 where channel_id is null;
