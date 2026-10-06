# 닐슨 수집 설계 (단계 01)

기존 흐름(`nielsenFileDispatch.ts` → `nielsenIngest.ts`/`nielsenPeriod.ts`, 메일 `mailIngestionRunner.ts`)을 유지하고 그 위에 원장·멱등·검증·롤백을 얹었다. 전면 재작성 없음.

## 1. 흐름과 단계

```
수신(received) → 파싱(parsed) → 검증(validated) → 반영(applied | partial | failed)
                                        ↘ 동일 파일 재수신: skipped_duplicate (데이터 불변)
```
- 원장 `nielsen_ingest_batches`(마이그레이션 `20261011010000`): 파일 SHA-256, 파일명, 종류(daily/period_weekly/period_monthly/annual), 기간, `parser_version`, 어댑터 상태, 수집 경로(manual/mail+메일 ID), 개정(revision), 이전 개정(supersedes), 단계 로그, 시트 메타, 행 수, 이전 반영본과의 차이, 경고, 오류.
- 원장 쓰기는 **최선 노력**이다: 테이블이 없거나 쓰기가 실패해도 적재는 기존대로 돈다(마이그레이션 적용 전에도 동작).
- 메일 경로와 수동 업로드는 같은 `ingestAnyNielsenFile`을 지난다(기존 원칙 유지). 메일은 `origin={source:'mail', ref:message_id}`를 넘겨 원장에서 추적한다.

## 2. 판정 규칙

| 항목 | 규칙 |
|---|---|
| 종류 | 시트 "분석기간" 줄(하루 vs 범위)이 1차, 파일명은 보조(연간만 예외로 파일명 기준 — 기존) |
| 일간 날짜 | 시트 분석기간이 1차. 파일명 날짜와 **다르면 적재 거부**(다른 날 데이터를 덮어쓰는 사고 방지). 시트에 날짜가 없으면 파일명으로 폴백하고 경고 |
| 주간 | 월~일 7일이 아니면 경고. 어댑터 `verified`(2026-09-28~10-04 원본 골든 대조) |
| 월간 | 주간과 같은 랭킹 시트 구조로 가정한 `provisional` 어댑터 — 결과에 경고 표시. 월간 원본 골든은 아직 없음 |
| 타깃 | 헤더 라벨로 매핑(고정 열 금지). ENA PLAY D=2039/I=2049와 순서가 뒤바뀐 경우 모두 테스트 |
| 반복 블록 | 시트명이 아니라 블록 헤더(`ONCE`/`OLIFE`/`ENA STORY` 등)로 채널 구분 |
| 총계행 | `하루전체`는 `isDailyAggregate`로 분리(프로그램 아님) |
| 시간 | 엑셀 일수 실수·`H:MM:SS` 문자열 모두 처리, 24시 이상은 시계 시각으로 정규화(방송일은 파일 날짜 유지) |
| 0/결측 | 숫자 0=관측값 0, 빈 셀=null(결측). 경쟁시트 E9=0 / H9 빈 셀 구분 유지 |
| KPI 누락 | 채널 KPI 타깃(랭킹 시트 라벨)이 파일에 없으면 경고(헤더 변경 감지) |
| 교차 검증 | 경쟁채널시청률 시트의 자사 블록 ↔ 타깃상세 같은 방송의 타깃별 시청률 대조, 불일치 시 경고 |

## 3. 논리적 grain (어디에 무엇이 저장되는가)

| grain | 테이블 | 키 | 비고 |
|---|---|---|---|
| channel_daily | `ratings` (program_id NULL, rank 있음) | 채널·타깃·방송일 | 랭킹 시트 값(공식 No.) |
| channel_daily_aggregate | `ratings` (program_id NULL, rank NULL) | 채널·타깃·방송일 | 타깃상세 `하루전체` 행 |
| program_airing | `ratings` (program_id 있음) | 채널·프로그램·방송일·**시작시각**·타깃 | 재방 회차는 시작시각별 별도 행(`is_first_run` 보존) — program_id만으로 합치지 않음 |
| channel_period_official | `nielsen_period_rank` | 기간 종류·기간·채널·타깃 | 주간·월간 파일은 **여기에만** 쓴다 |
| competitor_* | `competitor_ratings`, `competitor_program_ratings`, `competitor_program_target_ratings` | 방송일·경쟁채널·… | 등록된 경쟁채널만 |
| 수집 원장 | `nielsen_ingest_batches` | 배치 | 신규 |
| EPG / PD 리뷰 / skyUHD | 별도 테이블(변경 없음) | — | 본 단계 범위 밖 |

주간·월간 입력은 `ratings`·`programs`를 만들지도 지우지도 않는다(테스트로 확인). 같은 방송이 타깃상세와 경쟁시트에 모두 있어도 (채널·시작·프로그램·타깃) 중복 행이 생기지 않는다(원본 파일로 확인).

행 단위 출처: `ratings`에 배치 ID 컬럼을 추가하지 않았다(핵심 테이블 변경 위험·마이그레이션 순서 의존). 대신 **(종류, 기간)의 최신 `applied` 배치**가 그 날짜 행의 출처이며, 원본 시트 헤더·정규화 결과는 배치 `sheet_meta`에 보존한다. 셀 주소 단위 출처는 저장하지 않는다(한계).

## 4. 멱등·개정·롤백 정책

- **멱등**: 같은 (종류, 기간)의 **가장 최근 `applied` 배치**와 파일 해시·`parser_version`이 같으면 아무것도 쓰지 않고 `duplicate`로 응답한다. A→B→A처럼 되돌리는 재업로드는 최신본이 B이므로 정상 변경(개정 3)으로 처리한다.
- **수정본**: 같은 기간 다른 해시 → 개정 +1, `supersedes_batch_id` 연결, 채널×타깃 단위 변경/추가/삭제 건수를 경고와 원장에 남김.
- **롤백(일간)**: 삭제 전에 해당 날짜 `ratings`를 메모리에 백업한다. 백업이 실패하면 **아무것도 지우지 않고 중단**한다. `ratings` 삽입이 실패하면 그 날짜를 지우고 백업으로 되돌린다(`되돌렸습니다` 메시지, 원장 `failed`, 이전 반영본이 계속 최신).
- **부분 성공**: 핵심(`ratings`)은 반영됐고 경쟁채널 테이블 일부만 실패하면 `partial`(경고 노출, 롤백 안 함). 이전에는 이 실패가 조용히 무시됐다. `partial`은 멱등 판정 대상이 아니라 같은 파일 재업로드로 복구할 수 있다.
- **재처리 범위**: 파일 단위(같은 날짜·기간 전체). 부분 행 재처리는 하지 않는다.
- **후속 의존**: 일간 반영 성공 시에만 OLIFE EPG 매칭과 `refreshDailyDashboardMart(날짜)`가 실행된다(기존). 롤백·실패 시에는 실행하지 않는다. 주간·월간 반영은 마트 재생성이 필요 없다(`nielsen_period_rank` 직접 조회).
- 연간(YoY) 파일은 기존 경로 유지(원장 미적용).

## 5. 메일 수집

- 상태: `mail_ingestion_log.status` = processing(수신·선점) → processed / error / skipped. 파일별 단계는 원장.
- **재시도·dead-letter**(신규): `error` 메일은 마지막 시도 후 30분이 지나면 다시 시도, 시도 3회(`MAIL_MAX_ATTEMPTS`)에 도달하면 자동 재시도를 멈추고 오류 메시지에 "관리자 확인 필요"를 덧붙인다. 재시도 선점은 `status='error' AND attempt_count=이전값` 조건의 UPDATE로 하여 동시 실행 시 한 쪽만 성공한다. `attempt_count` 컬럼이 아직 없으면 예전 동작(기록된 메일은 모두 처리 완료)으로 동작한다.
- 중복 방지 키: `message_id`(기존 unique) + 파일 해시(원장). 재시도로 같은 첨부가 다시 들어와도 이미 반영된 파일은 `duplicate`로 건너뛴다.
- 테스트는 운영 메일에 접속하지 않는다(`runNielsenMailIngestion`은 호출하지 않고 재시도 판정은 순수 함수로 검증).
- 한계: 선점 후 비정상 종료한 `processing` 행이 계속 남는 문제는 기존과 동일(이번 단계 범위 밖).

## 6. 배포 순서(운영 반영 시)

1. `supabase db push`로 `20261011010000_nielsen_ingest_batches.sql` 적용(새 테이블 + `mail_ingestion_log.attempt_count`).
2. 코드 배포. 순서가 뒤바뀌어도 적재는 동작하지만(원장·재시도만 비활성) 원장 기록이 비는 기간이 생긴다.
3. 배포 후 같은 날짜 파일 재업로드로 `duplicate` 응답과 원장 행을 확인.

## 7. 검증 (`npm run test:nielsen`)

- 합성 워크북: 날짜 규칙(일치/불일치/없음/범위), 필수 시트 누락, 알 수 없는 시트, ENA PLAY 헤더 순서 2종, 시간 문자열·실수·25시, 총계행, 다중 채널 블록, 빈 셀 vs 0, 교차 검증 정/오.
- 대역 DB: 재업로드 멱등, 수정본 개정·차이, A→B→A, 삽입 실패 롤백, 백업 실패 중단, 경쟁 테이블 부분 성공, 주간·월간이 programs/ratings 불변, 주간 수정본 차이, 월간 잠정 표시, 깨진 파일 거부.
- 실제 원본(파일이 있을 때만, 없으면 SKIP): 골든 14건 파서 출력 일치, D14/I14↔D12/E12 교차 일치, E9=0, 총계행, 중복 행 없음, 10/1~10/5 일간 날짜 일치, 대역 DB 적재 후 값 확인.
