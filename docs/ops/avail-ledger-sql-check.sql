-- Avail 사용 원장 SQL 함수 점검(단계 06) — 마이그레이션 20261013010000 적용 후 **스테이징**에서 실행한다.
-- 원장은 삭제·수정이 막혀 있어(트리거) 이 점검 행은 지워지지 않는다 → 운영 DB에서는 실행하지 말고 pool_id 접두 'CHECK-'로 구별한다.
-- 기대 결과는 각 문장 아래 주석에 있다. 어긋나면 SQL 함수가 src/lib/avail/ledger.ts의 규칙과 다르다는 뜻이다.

-- 1) 한도 1회 풀에 예약 → 성공
select avail_reserve_usage('CHECK-POOL-1', 1, 1, 1, false, 'ENA', 'CHECK#r1', now(), 'rev-a', 'check-k1');
-- 기대: {"ok": true, "replay": false, ...}

-- 2) 같은 풀·회차에 다른 편성자가 예약 → 잔여 0이라 실패
select avail_reserve_usage('CHECK-POOL-1', 1, 1, 1, false, 'ENA Play', 'CHECK#r1', now(), 'rev-b', 'check-k2');
-- 기대: {"ok": false, "reason": "insufficient", "remaining": 0}

-- 3) 같은 멱등 키로 다시 호출 → 새로 쌓지 않고 replay
select avail_reserve_usage('CHECK-POOL-1', 1, 1, 1, false, 'ENA', 'CHECK#r1', now(), 'rev-a', 'check-k1');
-- 기대: {"ok": true, "replay": true, ...}

-- 4) 채널별 한도 해석이면 다른 채널은 따로 예약 가능
select avail_reserve_usage('CHECK-POOL-2', 1, 1, 1, true, 'ENA', 'CHECK#r2', now(), 'rev-a', 'check-k3');
select avail_reserve_usage('CHECK-POOL-2', 1, 1, 1, true, 'ENA Play', 'CHECK#r2', now(), 'rev-b', 'check-k4');
-- 기대: 둘 다 {"ok": true, ...}

-- 5) 해제하면 잔여가 돌아오고, 같은 풀에 다시 예약 가능
select avail_release_usage('u:check-k1', 'release', 'check-rel1', '점검');
select avail_reserve_usage('CHECK-POOL-1', 1, 1, 1, false, 'ENA Play', 'CHECK#r1', now(), 'rev-b', 'check-k5');
-- 기대: 해제 {"ok": true}, 예약 {"ok": true}

-- 6) 실제 방송 실적: 같은 source_event_id는 한 번만
select avail_consume_usage('check-ev-1', 'CHECK-POOL-3', 1, 'CHECK#r3', 'ENA', 1, now(), null, null, 5, null);
select avail_consume_usage('check-ev-1', 'CHECK-POOL-3', 1, 'CHECK#r3', 'ENA', 1, now(), null, null, 5, null);
-- 기대: 첫 호출 replay=false, 둘째 호출 replay=true. 한도 0으로 부르면 over_limit=true

-- 7) 소진된 사용을 release로 되돌리려 하면 거부(취소는 cancel)
select avail_release_usage('u:check-ev-1', 'release', 'check-rel2', null);
select avail_release_usage('u:check-ev-1', 'cancel', 'check-cancel1', '방송불발');
-- 기대: 첫째 {"ok": false, "reason": "invalid_state"}, 둘째 {"ok": true}

-- 8) 원장 수정·삭제는 막혀 있어야 한다
-- update avail_usage_ledger set units = 2 where usage_id = 'u:check-k1';   -- 기대: 오류(수정·삭제할 수 없습니다)
-- delete from avail_usage_ledger where usage_id = 'u:check-k1';             -- 기대: 오류

-- 9) 진짜 동시성(마지막 1회 경쟁)은 psql 세션 두 개에서 같은 문장을 동시에 실행해 확인한다:
--    select avail_reserve_usage('CHECK-RACE', 1, 1, 1, false, 'ENA',      'CHECK#r9', now(), 'rev-x', 'check-race-a');
--    select avail_reserve_usage('CHECK-RACE', 1, 1, 1, false, 'ENA Play', 'CHECK#r9', now(), 'rev-y', 'check-race-b');
--    기대: 정확히 한 쪽만 ok=true(advisory lock 때문에 나중 호출은 앞 호출이 끝난 뒤 잔여 0을 본다).
