# KT ENA 편성 AI Agent — 개발 계획 (PLAN)

> PRD.md에 정의된 전체 기능을 실제 서비스로 만들기 위한 실행 계획. bkit PDCA Plan 문서 구조를 참고해 작성했으며, 요구사항은 PRD.md 작성 과정에서 이미 충분히 확인·합의되었으므로 별도 체크포인트 없이 바로 작업 순서를 정리했다.

---

## 이번 사이클 목표

Nielsen 시청률 데이터를 자동 집계·분석해 KT ENA 편성 PD에게 **Morning Briefing(Page 1/2), 자연어 질문, Fit Score 기반 편성 추천(KEEP/MOVE/REPLACE/STRENGTHEN/TEST)**을 제공하는 서비스를 처음부터 끝까지 구현해, 2026년 1~8월 실데이터로 실제 동작을 검증한다.

## 성공 기준 (Definition of Done)

- [ ] 2026-01-01~08-18 Nielsen 데이터(3월 14일 제외)가 정상 파싱·적재되고, 목표 달성률·Gap 등 핵심 수치의 계산 오류율 0%
- [x] 관리자 2명 로그인 + PD 공유 링크 접근 제어가 정상 동작 (업로드는 관리자만) — 관리자 1명(christine@ktena.co.kr) 시딩 완료, 2번째 관리자는 이메일 확인 후 추가 예정
- [ ] Page 1(종합 대시보드)·Page 2(채널별 딥다이브)가 실데이터 기반으로 렌더링됨
- [ ] 자연어 질문에 Claude가 DB 조회(NL2SQL) 기반으로만 답하고, 근거 없으면 "찾을 수 없음"을 구체적으로 명시
- [ ] 편성 추천이 Fit Score·Evidence·Confidence를 함께 표시
- [ ] Morning Briefing이 매일 오전 자동 생성(6개 섹션)
- [ ] `.env`/`Nielsen Data`/`채널기본정보.xlsx` 등 대외비 자료가 git에 커밋되지 않음

## 범위 / 비범위

- **범위**: PRD.md 6번 "범위" 그대로 — Nielsen 데이터 자동 집계·분석·Morning Briefing·편성 추천, 자연어 질문, 관리자 로그인+공유링크, 주요 콘텐츠 관리
- **비범위**: PRD.md 6번 "비범위" 그대로 — Content ROI, 개인 단위 Audience Flow 추적, Cannibalization 확정 판별, 편성표 실반영, 회원가입 기능

## 주요 리스크

| 리스크 | 영향 | 완화 방안 |
|---|---|---|
| skyUHD 데이터·KT ENA CI 로고 미도착 | Page 1/2의 skyUHD 관련 화면 요소가 placeholder로 남음 | 6~7단계는 6개 채널 우선 진행, skyUHD는 도착 즉시 병행 반영 |
| Nielsen 메일함(Bizbox 그룹웨어) 2FA로 직접 자동 로그인 불가 | 자동 이메일 수집(20단계)이 지연될 수 있음 | Gmail 전달(forward) + Gmail API OAuth2 방식으로 우회 구현 완료. `.env`에 Gmail 자격증명 채우기 전까지는 관리자 수동 업로드로 서비스 지속 |
| Fit Score가 Affinity·Competitive Pressure에 의존 | 편성 추천이 선행 지표 없이는 계산 불가 | 16단계(타깃/경쟁채널 분석)를 17단계(편성 추천)보다 먼저 배치 |

---

## 작업 순서 (먼저 끝나면 나머지가 쉬워지는 순서)

1. ~~Next.js + Supabase 프로젝트 연동 확인 (.env 연결 테스트)~~ ✅
2. ~~DB 스키마 설계 및 생성 (채널·프로그램·타깃·시청률·목표 시청률 최소 테이블)~~ ✅
3. ~~관리자 로그인 + PD 공유 링크 접근 제어 구현 (링크 재발급 포함)~~ ✅
4. ~~Channel Master·Competitor Master 업로드 기능 구현 (`채널기본정보.xlsx` 값 반영)~~ ✅
5. ~~주요 콘텐츠 관리 기능 구현 (킬러 콘텐츠 자동 산출 + 관리자 지정 콘텐츠)~~ ✅
6. ~~DATA_DICTIONARY.md 작성 (Nielsen 10개 시트·skyUHD·2025년 파일 구조 문서화)~~ ✅
7. ~~Nielsen Daily Excel 업로드·파싱 구현 (6개 채널, RAW → DB)~~ ✅
8. ~~skyUHD 업로드·파싱 구현 (별도 형식, 프레임 절삭 처리)~~ ✅
9. ~~2025년 연간 집계 파일 업로드 및 YoY 기준값 저장 구현~~ ✅
10. ~~데이터 품질 검증 로직 구현 (스키마 변경 감지 포함, 오류 시 ALERT)~~ ✅
11. ~~시청률 핵심 지표 계산 구현 (Rating/Share/Reach/Time Spent, 전체 시간축)~~ ✅
12. ~~목표 시청률 업로드 및 목표 대비 달성률·Gap 계산 구현~~ ✅
13. ~~2026년 1~8월 데이터 업로드 및 계산 결과 검증 테스트~~ ✅
14. ~~Page 1 종합 대시보드 및 Morning Briefing 자동 생성 로직 구현~~ ✅ (규칙 기반 인사이트로 우선 구현, LLM 서술형은 Anthropic API 키 확보 후 고도화 예정)
15. ~~Page 2 채널별 딥다이브 화면 구현 (8대 질문 섹션 구조)~~ ✅ (WHAT HAPPENED?/HOW DEEPLY?/시간대별/COMPARED WITH? 실데이터, 나머지 4개는 16~19번 대기 placeholder)
16. ~~타깃 분석(Affinity)·경쟁채널 분석(Competitive Pressure) 구현 (Fit Score 선행 지표)~~ ✅ (`competitor_ratings` 테이블 신설 + 230일 전체 백필, `get_competitive_pressure`/`get_target_affinity` SQL 함수, Page 2 WHO IS WATCHING?/COMPARED WITH? 실데이터 반영)
17. ~~편성 추천(Fit Score 기반 5태그) 로직 및 MART/CONFIG 테이블 구현~~ ✅ (`mart_slot_score`/`mart_program_target_score`/`mart_competitive_score`/`mart_flow_score`/`mart_scheduling_fit_score` + `fit_score_config`, `refresh_fit_score_mart()` SQL 함수, Page 2 CONTENT FITS?/OPPORTUNITY?/WHAT TO SCHEDULE? 실데이터 반영)
18. 자연어 질문(NL2SQL) 기능 구현 — Page 2 내 섹션으로 배치 ⏸ (`.env`에 `ANTHROPIC_API_KEY` 확보 전까지 보류 — 사용자 확인, 19번을 먼저 진행)
19. ~~원인 추적·기회 탐지 알림 기능 구현~~ ✅ (`get_root_cause_alert`/`get_opportunity_alert` SQL 함수, Page 2 WHY?/OPPORTUNITY? 실데이터 반영. 18번은 Anthropic API 키 미확보로 보류 — 사용자 확인)
20. ~~Nielsen 메일 자동 수집 연동 구현~~ ✅ (christine@ktena.co.kr 그룹웨어가 2FA라 직접 자동 로그인이 불가능해, Gmail로 메일을 전달받아 Gmail API(OAuth2)로 첨부파일을 가져오는 방식으로 구현. `src/lib/nielsenIngest.ts`로 파싱·적재 로직을 관리자 수동 업로드와 공유하고, `mail_ingestion_log` 테이블로 중복 처리를 막는다. Vercel Cron(`vercel.json`, 매일 08:00 KST)이 `/api/cron/fetch-nielsen-mail`을 호출하며, 관리자 화면의 "지금 메일 확인" 버튼으로 즉시 테스트 가능. `.env`에 `GMAIL_*` 값을 채우기 전까지는 비활성 상태로 안전하게 대기(수동 업로드는 계속 정상 동작) — 메일 전달 규칙은 관리자가 Bizbox 웹메일에서 직접 설정해야 함(Claude가 대신 만들지 않음))
21. Vercel 배포 및 운영 전환

---

## Version History

| Version | Date | Changes |
|---|---|---|
| 0.1 | 2026-08-19 | PRD.md 기준 최초 작성 |
