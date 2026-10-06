# 관리자 화면 기능 위치표·업로드 정책·권한 (단계 05, 단계 06에서 Avail 추가)

소스: `src/lib/admin/featureMap.ts`, `uploadPolicy.ts`, `fieldPrecedence.ts`, `permissions.ts`(코드가 단일 출처이며 `npm run test:admin`이 화면·API와의 일치를 검사한다).

## 1. 기능 위치표(유지/이동/통합)

| 기능 | 위치(묶음) | 컴포넌트/페이지 | API | 최소 역할 | 처리 | 변경 내용 |
|---|---|---|---|---|---|---|
| Nielsen 시청률 업로드 | 매일 올리는 자료 | NielsenUploader | /api/admin/upload/nielsen | upload | 유지 | 수신 현황 표 바로 아래. 일간·주간·월간 자동 분류, 변경 없음·개정·부분 반영 결과 표시(단계 01). |
| skyUHD 시청률 업로드 | 매일 올리는 자료 | SkyUhdUploader | /api/admin/upload/skyuhd | upload | 유지 | 수신 현황의 skyUHD 행과 연결. |
| OLIFE EPG 업로드 | 매일 올리는 자료 | OlifeEpgUploader | /api/admin/upload/olife-epg | upload | 유지 | 업로드 결과에 미매칭·모호 후보 목록(미매칭 큐) 추가. |
| 주요 뉴스 관리(베타) ※저장하면 즉시 게시됩니다(검토·게시 상태 분리는 후속). | 1페이지 반영 내용 | DailyNewsManager | /api/admin/news | approve | 유지 | 저장 전 미리보기, 이전 버전 복구 추가. |
| 주요 콘텐츠 관리 | 1페이지 반영 내용 | FeaturedContentManager | /api/admin/featured-content<br>/api/admin/featured-content/[id] | approve | 유지 | 위치 유지. 저장은 즉시 반영. |
| PD 수동 회차 리포트 업로드 | 1페이지 반영 내용 | ManualReportUploader | /api/admin/upload/manual-drama-report<br>/api/admin/upload/manual-original-report | upload | 유지 | 드라마·예능 양식 통합 카드 유지. PD 메모는 공식 시청률을 덮지 않는 필드로 분리. |
| 월간 채널 추이 자료 업로드 | 1페이지 반영 내용 | MonthlyReferenceTrendUploader | /api/admin/upload/monthly-reference-trend | upload | 유지 | 위치 유지(월간 어댑터 provisional 표시). |
| 주간 편성표 업로드 | 편성표 검토 | ScheduleGridUploader | /api/admin/upload/schedule-grid<br>/api/admin/schedule-grid/data<br>/api/admin/schedule-grid/export<br>/api/admin/schedule-grid/weeks | upload | 유지 | 위치 유지. 내보내기는 편성자 이상(export). |
| Channel Master 업로드 | 기준 정보 | ChannelMasterUploader | /api/admin/upload/channel-master<br>/api/admin/channels | master_edit | 유지 | 수동 잠금 목표를 덮어쓰지 않음(단계 05). |
| 목표 시청률 관리 | 기준 정보 | TargetGoalsManager | /api/admin/target-goals | master_edit | 유지 | 저장 시 수동 잠금·변경 이력 기록(단계 05). |
| 누적 채널 순위 업로드 | 기준 정보 | MarketYtdRankUploader | /api/admin/upload/market-ytd-rank | upload | 유지 | 위치 유지. |
| OLIFE 회차 카탈로그(EBS 콘텐츠 리스트) 업로드 | 기준 정보 | OlifeEpisodeCatalogUploader | /api/admin/upload/olife-episode-catalog | upload | 유지 | 위치 유지. |
| Avail(콘텐츠·채널 권리) 관리 ※Avail 업로드는 미리보기를 거친 뒤 확정해야 반영됩니다. 마이그레이션 적용 전에는 반영할 수 없습니다. | 기준 정보 | AvailManager | /api/admin/upload/avail<br>/api/admin/avail<br>/api/admin/avail/template<br>/api/admin/avail/ledger | rights_edit | 통합 | 기준 정보에 신설(단계 06). 표준 양식·열 매핑 미리보기·권리 반영·확인 대기(해석·메모·승인·중복)·보충 속성(1st window)을 한 카드에서 처리. |
| 장르 분류 보완 | 기준 정보 | GenreMapManager | /api/admin/program-genre | approve | 유지 | 분류율 표시를 내림·미분류 건수 병기로 수정(단계 05). |
| Nielsen 메일 자동 수집 | 점검·이력 | MailIngestionManager | /api/admin/mail-ingestion/run<br>/api/admin/mail-ingestion/status | upload | 유지 | 연결 상태·마지막 성공·오류만 표시, 설정 절차는 기술 문서로 이동(단계 05). |
| 로그인 이력 | 점검·이력 | /admin/login-history | — | view | 유지 | 상단 링크 유지. |
| 질문하기 사각지대 | 점검·이력 | /admin/ask-gaps | — | view | 유지 | 상단 링크 유지. |
| 자료 수신·반영 현황 | 수신·반영 현황 | DataStatusPanel | /api/admin/data-status | view | 통합 | 관리자 첫 화면 최상단 신설(단계 05). 업로드 카드의 결과를 채널×자료종류로 모아 보여 줌. |

## 2. 자료 유형별 업로드 정책(목표 vs 현재 구현)

| 유형 | 정책(원자성) | 미리보기 | 차이 | 복구 | 현재 구현 | 같은 기간 재업로드 |
|---|---|---|---|---|---|---|
| Nielsen 시청률(일간·주간·월간) | all_or_nothing | 목표 O / 현재 X | 목표 O / 현재 O | 목표 auto_rollback / 현재 auto_rollback | 단계 01: 해시·기간 멱등성, 반영 전 일별 백업과 실패 시 복구, 같은 기간 개정(revision)·차이 기록. 미리보기 화면은 없음. 경쟁 시트 실패는 partial. | 내용이 같으면 변경 없음, 다르면 개정 번호를 올리고 차이를 기록한 뒤 교체(일간만 ratings 교체). |
| skyUHD 수기 누적 | valid_rows_only | 목표 O / 현재 X | 목표 O / 현재 X | 목표 reupload_only / 현재 reupload_only | 미래일은 null 유지. 미리보기·차이 표시 없음. | 날짜 키 단위로 최신 파일 값으로 갱신. |
| EPG(일일운행표) | valid_rows_only | 목표 O / 현재 X | 목표 O / 현재 X | 목표 reupload_only / 현재 reupload_only | 원본은 staging에 저장 후 닐슨과 ±60분 매칭. 매칭 실패·모호 후보는 단계 05의 미매칭 목록으로 노출. | (날짜·채널·시각·프로그램명·출처) 키로 최신값 덮어쓰기. |
| 주간 편성표 | all_or_nothing | 목표 O / 현재 X | 목표 O / 현재 X | 목표 version_restore / 현재 reupload_only | 주 단위 교체(scheduleGridSource). 이전 버전 복구 없음. | 같은 주는 새 파일로 교체. |
| Channel Master(채널·경쟁채널·목표) | valid_rows_only | 목표 O / 현재 X | 목표 O / 현재 X | 목표 version_restore / 현재 reupload_only | 단계 05: 수동 잠금이 있는 목표는 덮어쓰지 않고 건너뜀(잠금 테이블이 적용된 환경). 경쟁채널은 채널별 삭제 후 재삽입. | 채널 단위로 교체하되 수동 잠금 목표는 보존. |
| 목표 시청률(수동 입력) | all_or_nothing | 목표 X / 현재 X | 목표 O / 현재 X | 목표 version_restore / 현재 reupload_only | 단계 05: 저장 시 수동 잠금과 변경 이력을 남김(테이블 적용 후). | 수동 입력이 항상 우선하며 Channel Master 재업로드로 덮이지 않음. |
| PD 수동 회차 리포트 | valid_rows_only | 목표 O / 현재 X | 목표 O / 현재 X | 목표 version_restore / 현재 reupload_only | 같은 키로 upsert. PD 메모는 공식 시청률 사실을 덮지 않음(필드 우선순위 표). | (프로그램·회차) 키로 갱신. |
| 월간 채널 추이 참고자료 | all_or_nothing | 목표 O / 현재 X | 목표 O / 현재 X | 목표 version_restore / 현재 reupload_only | 월·채널 키 upsert. 월간 어댑터는 provisional. | 월·채널 키로 갱신. |
| 누적 채널 순위 | all_or_nothing | 목표 O / 현재 X | 목표 O / 현재 X | 목표 version_restore / 현재 reupload_only | upsert/insert. | 기준일 키로 갱신. |
| OLIFE 회차 카탈로그(EBS 콘텐츠 리스트) | valid_rows_only | 목표 O / 현재 X | 목표 X / 현재 X | 목표 reupload_only / 현재 reupload_only | 회차 번호 시드와 연동. | 회차 키로 갱신. |
| Avail(콘텐츠별·채널별 권리) | valid_rows_only | 목표 O / 현재 O | 목표 O / 현재 O | 목표 version_restore / 현재 version_restore | 단계 06: 시트별 양식 감지·열 매핑 미리보기, 헤더가 맞지 않으면 거부, 기존 권리와의 차이(신규·개정·철회 후보·수동 충돌) 확인 후 확정 반영. 권리 revision은 쌓기만 하며 실패 시 이번 배치분만 되돌림. 마이그레이션 적용 후 동작. | 같은 행(원본 열 해시 동일)은 변화 없음, 내용이 바뀐 행은 새 revision이 이전 revision을 대체(이전 revision은 보존). 증분 파일에서 빠진 행은 철회가 아님, 전체 스냅샷은 대상 범위 확정 후 철회 후보로만 표시. |
| 주요 뉴스(전체 텍스트 교체) | replace_all | 목표 O / 현재 O | 목표 O / 현재 O | 목표 version_restore / 현재 version_restore | 단계 05: 저장 전 미리보기(추가·삭제·유지 건수), 교체 전 이전 버전 보관·복구(버전 테이블 적용 후), 삽입 실패 시 이전 목록으로 자동 되돌림. 저장은 즉시 게시이며 화면에 표시. | 항상 전체 교체. |

## 3. 필드별 우선순위(위가 이김)

| 필드 | 허용 출처 순서 |
|---|---|
| target_goal | manual_admin > channel_master_file |
| channel_info | manual_admin > channel_master_file |
| episode_info | epg_corrected > epg_daily > weekly_plan |
| review_text | pd_manual_review > calc_review |
| airing_schedule | daily_actual > weekly_plan |
| rating_fact | official_nielsen |

## 4. 행동별 최소 역할

| 행동 | 최소 역할 |
|---|---|
| view | viewer |
| export | planner |
| schedule_finalize | planner |
| upload | admin |
| approve | admin |
| master_edit | admin |
| rights_edit | admin |
| lock_override | admin |
| policy_edit | admin |

현재 세션 역할은 admin·pd뿐이며 pd는 편성자(planner)로 대응한다. 열람자(viewer) 계정은 아직 발급되지 않았다.
