# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

이 저장소는 **KT ENA 편성 AI Agent** — Nielsen 시청률 데이터를 자동 집계·분석하고, 편성 PD에게 Morning Briefing과 자연어 질의응답, 편성 추천(KEEP/MOVE/REPLACE/STRENGTHEN/TEST)을 제공하는 서비스다. 전체 요구사항과 의사결정 이력은 [`PRD.md`](PRD.md)에 있고, [`prd_lite.md`](prd_lite.md)는 그 축약판이다. 코드를 작성하기 전에 반드시 `PRD.md`를 먼저 읽을 것 — 아래 내용은 그중 "코드를 짤 때 반드시 지켜야 하는" 부분만 발췌한 것이다.

**현재 상태: 개발 단위 1~20번 완료, 18번은 규칙 기반 1차 슬라이스 + OpenAI 폴백까지 연결됨.** Next.js(App Router, TypeScript, Tailwind) 스캐폴딩이 되어 있고, Supabase 프로젝트(`kt-ena-programming-agent`, ap-northeast-2)가 생성되어 `.env`에 연결 정보가 저장되어 있다. `channels`/`competitors`/`programs`/`targets`/`ratings`/`target_goals`/`featured_content`/`file_uploads`/`share_links`/`admins`/`competitor_ratings`/`competitor_program_ratings`/`original_review_programs`/`mail_ingestion_log`/`fit_score_config`/`mart_slot_score`/`mart_program_target_score`/`mart_competitive_score`/`mart_flow_score`/`mart_scheduling_fit_score` 20개 테이블 + `killer_content_v` 뷰가 [`SCHEMA.md`](SCHEMA.md) 설계대로 생성됨 (`supabase/migrations/`). 처음엔 "18번(자연어 질문/NL2SQL)은 `.env`에 `ANTHROPIC_API_KEY`가 아직 없어 보류, 규칙 기반으로 대체할 수 없다"고 판단해 19번(원인 추적·기회 탐지)을 먼저 진행했었으나, 2026-08-20 사용자가 **LLM 없이도 동작하는 규칙 기반 질의 엔진**(Intent Registry 기반, PRD 성격의 대규모 스펙 제공)을 직접 지시해 진행 방향을 뒤집었다 — 그 스펙의 Python `/agent` 디렉토리 구조는 "별도 SQL/Python 백엔드를 두지 않는다"는 이 문서의 고정 아키텍처와 충돌해 그대로 쓰지 않고, TypeScript로 Next.js 안에 포팅했다(사용자 확인, 3가지 방향 중 선택). 상세는 아래 "자연어 질의 엔진(18번, 규칙 기반)" 문단 참고. 관리자 로그인(이메일+비밀번호, 서명 쿠키 세션)과 PD 공유 링크(발급/재발급, `/s/[token]`) 접근 제어가 구현되어 `proxy.ts`(Next.js 16의 미들웨어)가 모든 화면 접근을 관리자/PD 세션 유무로 걸러준다. 관리자 계정은 회원가입 화면 없이 `scripts/seed-admin.mjs`로만 추가한다. 관리자 화면(`/admin`)에서 `채널기본정보.xlsx` 하나를 업로드하면 세 시트를 함께 반영한다 — "채널 별 경쟁채널" 시트 → `channels`/`competitors`/`target_goals`(2026년 기준, 로고 대표색 자동 추출 포함), "KT ENA 오리지널" 시트 → `programs`/`featured_content`(편성 정보가 기입된 항목만, 나머지는 건너뜀), "요일 별 리뷰 프로그램" 시트 → `original_review_programs`(Page 1 Original 리포트 화이트리스트, 매번 전체 교체). 주요 콘텐츠는 관리자 화면에서 직접 추가·수정·삭제도 가능하다. "킬러 콘텐츠 자동 산출"은 `killer_content_v` 뷰(최근 28일 자사 프로그램 평균 시청률 기준 채널별 순위) + `/api/killer-content`로 구현되어 있으나, Nielsen 일별 시청률 데이터가 아직 없어 실제 값은 다음 개발 단위(Nielsen 업로드) 이후에 나온다.

- 실행: `npm run dev` (http://localhost:3000)
- 빌드: `npm run build`
- 린트: `npm run lint`
- 연동 확인: `npm run dev` 실행 후 http://localhost:3000/api/health 접속 → `{"ok":true, ...}` 확인
- DB 스키마 변경: `supabase migration new <이름>` 으로 새 마이그레이션 생성 → SQL 작성 → `supabase db push`로 적용 (기존 마이그레이션 파일은 수정하지 않고 새로 추가)
- 관리자 계정 추가/재설정: `node --env-file=.env scripts/seed-admin.mjs 이메일 [비밀번호]` (비밀번호 생략 시 임시 비밀번호 자동 생성, 한 번만 화면에 표시됨)
- Channel/Competitor Master·주요 콘텐츠 갱신: 관리자로 `/admin` 로그인 → `채널기본정보.xlsx` 업로드 (재업로드 시 기존 값을 덮어씀), 주요 콘텐츠는 화면에서 직접 추가/수정/삭제도 가능

[`DATA_DICTIONARY.md`](DATA_DICTIONARY.md)에 2025~2026년 Nielsen 일별/연간 파일(10개 시트)과 skyUHD 파일 구조를 실제 샘플로 확인해 문서화해뒀다 — ENA Story는 이 일별 파일에 프로그램 단위 데이터가 없다는 것, `ONCE,OLIFE경쟁채널시청률` 시트는 경쟁채널이 아니라 자사 채널 2개가 나란히 있다는 것 등 파싱 전에 알아야 할 함정들이 정리되어 있다. **2013~2016년 과거 자료(스카이라이프/TNmS 시대)는 채널 매핑표 도착 전까지 보류 중** (TNmS 자료는 이번 범위에서 제외, Nielsen 자료만 사용하기로 확정).

관리자 화면(`/admin`)에서 Nielsen 일별 파일(`닐슨_채널시청률(YYMMDD).xls`)을 여러 개 한 번에 업로드하면 6개 채널(ENA/ENA Drama/ENA Play/ENA Story/OLIFE/ONCE, skyUHD 제외)의 `ratings`/`programs`가 채워진다. 같은 날짜를 재업로드하면 그 날짜 데이터를 덮어쓴다. **ENA Story는 이 파일에 프로그램 단위 데이터가 없어 채널 단위 순위/시청률만 채워진다** (DATA_DICTIONARY.md에 문서화됨). 주간/월간/연간 집계 파일(파일명에 날짜 범위)은 이 기능이 거부한다 — 다음 개발 단위에서 별도로 다룬다.

관리자 화면(`/admin`)에서 skyUHD 파일(`26 skyUHD 시청률 (MMDD).xlsx`)을 업로드하면 `26 UHD ALL` 시트를 읽어 skyUHD의 `ratings`/`programs`를 채운다 — 수기 누적 파일 특성상 업로드할 때마다 skyUHD 데이터 전체를 새로 교체한다. 프레임 정보는 버리고 초 단위까지만 저장하며, 타깃 구분이 없는 시트라 `target_id`는 비워둔다(임의로 타깃을 지정하지 않음).

"Nielsen 시청률 업로드" 카드(`/admin`)는 일별 파일뿐 아니라 **1/1~12/31 전체를 덮는 연간 파일**(`닐슨_채널시청률(YYMMDD-YYMMDD).xls`)도 같이 받는다 — 연간 파일은 시트가 2개(전체 채널 랭킹)뿐이라 채널 단위 연간 평균만 `ratings(source_type='annual_2025', broadcast_date=그해-12-31)`로 저장되고, YoY 비교는 "연간 평균 대 연간 평균" 수준까지만 가능하다(일별 YoY는 이 파일만으론 안 됨 — DATA_DICTIONARY.md §3 참고). 주간/월간 파일은 여전히 거부한다.

업로드 기능(Channel Master·Nielsen 일별/연간·skyUHD) 전체가 공통 데이터 품질 검증([`src/lib/dataQuality.ts`](src/lib/dataQuality.ts))을 거친다: 파일·구조는 각 파서가 자체 확인해 실패 시 🔴 DATA QUALITY ALERT로 전체 중단하고, 값(시청률 등 0~100 범위 벗어남)은 그 값만 NULL 처리 후 경고, 완전성(기대한 채널이 파일에 아예 없음)과 스키마 변경(처음 보는 타깃 이름 등장)은 경고로 표시하되 나머지 정상 데이터는 그대로 반영한다.

시청률 핵심 지표(Rating/Share/Reach/Time Spent/Time Spent Share)와 DoD/WoW/MoM/QoQ/YoY/YTD 비교는 Postgres 함수(`get_rating_summary`/`get_hourly_rating_pattern`/`get_rating_trend_summary`, `supabase/migrations/20260819074120_rating_metrics_functions.sql`)로 계산하며, `/api/ratings/trend`가 그 결과를 그대로 돌려준다 (Claude는 암산하지 않고 이 값만 쓴다). YoY는 일별 데이터가 없으면 2025년 연간 평균으로 자동 대체된다.

목표 대비 달성률·Gap은 `get_target_achievement()` SQL 함수(`supabase/migrations/20260819080521_target_achievement_function.sql`)로 계산하며, `/api/ratings/target-achievement`가 결과를 그대로 돌려준다. 목표 시청률은 아직 실제 업로드 파일 형식이 없어(2026년치는 Channel Master로 이미 확보), 관리자가 `/admin`의 "목표 시청률 관리" 화면에서 연도별로 직접 입력/수정한다 (`/api/admin/target-goals`). Channel Master의 KPI 표기("수도권 개인2049")와 Nielsen 파일의 타깃 표기("수도권 2049")가 다른 채널은 사용자 확인을 거쳐 동의어로 매칭한다.

2026-01-01~08-18 Nielsen 일별 데이터 230일치 전체 백필 완료 (누락 없음, `ratings` 449,148행). 이 과정에서 `ONCE,OLIFE...타깃상세` 시트 이름이 3월부터 바뀌는 것을 발견해 정확한 이름 대신 패턴으로 찾도록 고쳤고, 동시에 **3월부터 ENA Story도 프로그램 단위 데이터가 생긴 것**을 확인해 반영했다(1~2월은 여전히 채널 단위만). 킬러 콘텐츠 뷰·목표 달성률·DoD/WoW/MoM/QoQ/YoY/YTD 트렌드 전부 실데이터로 검증 완료.

Page 1(홈 화면, `/`)이 실제 대시보드로 동작한다 — 사용자가 제안한 레이아웃(좌: ENA 히어로 카드 + 나머지 6개 채널 압축 그리드, 우: Original 콘텐츠 리포트)으로 재구성했다. AI Insights는 지금도 규칙 기반 한국어 문장(임계값: 달성률 100%↑ STRENGTHEN / 70~99% WATCH / 70%↓ RISK)이며, **`.env`에 Anthropic API 키가 아직 없어** Claude가 직접 서술하는 버전은 키 확보 후 고도화한다(18번 자연어 질문 기능과 함께 보류 중, 사용자 확인). **참고**: 같은 타깃이라도 Channel Master("수도권 개인2049")·타깃상세 시트("수도권 2049")·랭킹 시트("개인2049") 표기가 전부 다른 채널이 있어(DATA_DICTIONARY.md §1.1 참고), 순위 조회 시 여러 후보 표기를 순서대로 시도한다.

"Original" 리포트는 `get_original_content_report()` SQL 함수로 ENA/ENA Drama/ENA Play가 오늘 실제 방영한 프로그램(수도권 2049 기준)과 같은 날 다른 채널에서의 직후재방 관계, `featured_content` 태그(오리지널/독점 등)를 조회한다. **프로그램명을 하드코딩하지 않는다** — 사용자가 준 참고 레이아웃에 특정 프로그램명("나는 솔로" 등)이 있었지만 그 프로그램이 `featured_content`에 편성 정보로 등록돼 있지 않아(요일 등 조건 매칭 불가), 그날 실제 방영 데이터를 그대로 가져와 매번 최신 편성을 반영하게 했다. **실제로 겪은 문제**: `featured_content`(관리자가 Channel Master 시트에서 입력)와 Nielsen 파일의 프로그램명이 띄어쓰기만 다른 경우가 있어(예: "그대에게 드림" vs "그대에게드림" — 서로 다른 원본 파일의 표기 차이) 공백을 뺀 이름으로 매칭하도록 고쳤다(CLAUDE.md 원칙: 띄어쓰기 차이는 동일 프로그램으로 인식). 경쟁채널(SBS Plus 등)과의 동시방송 비교는 프로그램 단위 경쟁채널 데이터가 없어 아직 지원하지 않음을 화면에 명시했다.

채널 로고는 PNG마다 투명 여백 비율이 달라(실측: ENA/OLIFE/skyUHD는 거의 없음, ENA Play/Drama/Story는 이미지의 84%가 투명, ONCE는 77%) 같은 높이로 그리면 실제 로고 크기가 채널마다 달라 보이던 문제(사용자 피드백)를 고쳤다 — `channels.logo_visible_ratio`/`logo_visible_top_ratio`(Channel Master 업로드 시 자동 계산, `src/lib/logoColor.ts`)로 로고 이미지를 확대·크롭해 "보이는 부분"의 높이를 ENA 기준으로 맞춘다(`src/components/ChannelLogo.tsx`). 기존 로고는 `scripts/backfill-logo-visible-ratio.mjs`로 일괄 계산해뒀다.

Page 2 COMPARED WITH?의 경쟁채널 목록은 `get_competitor_channel_snapshot()`으로 바뀌어, Competitor Master에 등록만 되어있고 실제 시청률 데이터가 없는 채널은 화면에서 제외하고, 데이터가 있는 채널만 최근 7일 평균 시청률과 전주 대비 증감을 함께 보여준다(사용자 피드백).

이후 사용자 피드백 4건을 추가로 반영했다:
1. **02~26시 시간대별 그래프**: 실제로 안 그려지던 버그를 고쳤다 — `height:X%` 막대의 부모 요소에 명시적 높이가 없어 퍼센트가 항상 0으로 계산되던 CSS 문제였다(부모를 `flex-1`로 고쳐 고정 높이 컨테이너 기준 실제 공간을 갖게 함). 시청률/점유율/도달율/시청시간 4개 지표를 체크박스로 동시에 여러 개 볼 수 있게 바꿨다(기본은 시청률만 체크, 지표마다 단위가 달라 각자 자기 최댓값 기준으로 정규화).
2. **오늘의 브리핑**: Page 2 맨 위에 8대 질문을 단순 나열하지 않고 What(오늘 무슨 일)→Why(왜)→So What(그래서 의미)→What Next(다음 행동) 구조로 규칙 기반 요약하는 카드를 추가했다(`buildBriefing()`, 이미 계산된 트렌드·원인추적·기회탐지·목표달성·Fit Score 값만 조합, 새 숫자 계산 없음). 이것도 Anthropic API 키 확보 전까지는 규칙 기반이다.
3. **관리자 화면 편성 정보**: `featured_content`의 구조화 필드(첫 방송일자/매주 요일·시간)는 이미 있었지만 라벨이 없어 구분이 안 됐다 — "① 첫 방송일자"/"② 매주 반복 편성"으로 라벨을 나누고, 목록 테이블도 이 두 필드를 그대로 보여주도록 고쳤다.
4. **경쟁채널 시간대별 프로그램 인사이트(해결됨)**: 처음에는 §1.2 `OOO경쟁채널시청률` 시트에 "페어링된 경쟁채널 1개"만 있다고 보고 우측 블록 하나만 읽었는데, 그 상태로 저장해보니 R4 헤더 채널명("tvN" 등)과 실제 프로그램명이 다른 경우가 많아(예: tvN 헤더인데 "MBC뉴스데스크" 등장) PD팀 확인 전까지 보류했었다. 이후 실제 파일을 직접 열어 구조를 다시 확인한 결과, 이 시트는 **5행×2열의 채널 블록 그리드**(자사 채널 블록 제외 8~9개 경쟁채널 전체의 프로그램 단위 하루 편성)였고, 예전 파서가 각 블록의 "하루 전체" 종료 행에서 멈추지 않고 시트 끝까지 읽어버려 뒤 블록(SBS/MBC/KBS2 등)의 데이터까지 첫 블록 이름("tvN")으로 잘못 붙였던 **파서 버그**였다(진짜 데이터 문제가 아니었음). `findCompetitorBlocks()`로 모든 채널 블록을 각자의 "하루 전체" 행까지만 읽도록 고치고(`src/lib/nielsenDaily.ts`), `competitor_program_ratings`의 유니크 제약에 `competitor_name`을 추가한 뒤 `scripts/backfill-competitor-program-ratings.mjs`로 2026-01-01~08-18 전체(230개 파일, 147,458건)를 재백필했다. `get_competitor_program_overlap()`(우리 프로그램과 시간이 겹치는 등록 경쟁채널 프로그램 상위 3개, "그 시간대에 경쟁채널이 무엇으로 잘했는지" 직접 비교)과 `get_competitor_top_programs()`(그날 등록 경쟁채널 TOP 5, 시장 전체 참고용)를 새로 만들어 Page 2 COMPARED WITH?에 반영했다(Competitive Pressure=100.0은 버그가 아니라 ENA류가 실제로 MBC/SBS/tvN 등 상위 경쟁채널 합산 시청률에 못 미치는 정상적인 현상임을 이 작업 중 재확인함).

Page 2(`/channel/[code]`)가 좌측 채널 사이드바 + 8대 질문 구조로 동작한다 — WHAT HAPPENED?(DoD/WoW/MoM/QoQ/YoY/YTD 표), HOW DEEPLY?(Rating/Share/Reach/Time Spent), 02~26시 시간대별 그래프, WHO IS WATCHING?(대표 연령대 4개의 Affinity), COMPARED WITH?(경쟁채널 목록 + Competitive Pressure), CONTENT FITS?/OPPORTUNITY?/WHAT TO SCHEDULE?(Fit Score 기반 5태그 편성 추천)는 실데이터로 채워져 있고, WHY?만 필요한 계산(19번: 원인 추적)이 준비될 때까지 "다음 단계에서 추가됩니다" 안내를 표시한다. Page 1의 각 채널 카드를 누르면 해당 채널의 Page 2로 이동한다. `src/lib/targetResolution.ts`에 "프로그램 단위 데이터용 타깃 라벨" 매핑을 정리해뒀다(직접 DB로 검증한 값). **알려진 한계**: 2025년 연간 YoY 대체값이 ENA/ENA Drama/ENA Play에는 라벨 불일치로 아직 안 붙는다(DATA_DICTIONARY.md §1.1 참고).

개발 단위 16번(타깃 분석·경쟁채널 분석)으로 `competitor_ratings` 테이블을 새로 만들고, Nielsen 일별 업로드가 랭킹 시트를 Competitor Master 등록 채널명으로 한 번 더 파싱해 함께 채운다(230일 전체 백필 완료, 68,793건/40개 경쟁채널). `get_competitive_pressure()`(등록 경쟁채널 상위 3개 최근 7일 평균 시청률 ÷ 자사 시청률 × 100, 100 클램프 — "동시간대"가 아니라 기간 평균 근사, 원본 자료가 경쟁채널 전체의 시간대별 데이터를 제공하지 않는 한계)와 `get_target_affinity()`(자사 6개 채널끼리만 비교 가능, 표본 5일 미만이면 `insufficient_sample`)가 Page 2 WHO IS WATCHING?/COMPARED WITH?에 반영됐다. **알려진 한계 및 겪은 문제**: 자사 채널의 매칭 타깃 라벨과 `competitor_ratings` 라벨이 다른 경우(ENA 계열)가 있어 동의어 재시도를 추가했고, Postgres `LEAST(100, NULL)`이 NULL을 무시하고 100을 반환하는 함정 때문에 경쟁채널 데이터가 없을 때 압박도가 잘못 100으로 나오던 버그를 고쳤으며, WHO IS WATCHING?의 연령대별 비교는 채널의 시장 스코프(수도권/전국)에 맞는 채널끼리만 이뤄지도록 했다(전부 실데이터 재검증 완료, DATA_DICTIONARY.md §5 참고).

개발 단위 17번(편성 추천)으로 PRD.md 고정 공식 그대로 Fit Score(30% Target Performance + 20% Target Affinity + 15% Audience Engagement + 15% Slot Performance + 10% Competitive Opportunity + 10% Audience Flow)를 구현했다. `fit_score_config`(가중치 CONFIG, 채널별 override 가능·현재는 전체 기본값 1행만) + `mart_slot_score`/`mart_program_target_score`/`mart_competitive_score`/`mart_flow_score`/`mart_scheduling_fit_score` 5개 MART 테이블과 이를 채우는 `refresh_fit_score_mart()` SQL 함수(최근 12주 데이터 기준, Program 단위는 `programs.canonical_name`으로 회차를 통합)를 만들었고, `/api/scheduling/fit-score`가 기준일 계산이 없으면 그때 한 번 새로 계산시킨 뒤 결과를 돌려준다. Page 2의 CONTENT FITS?(Target Performance/Affinity/Engagement 하위지표)/OPPORTUNITY?(Competitive Opportunity)/WHAT TO SCHEDULE?(최종 Fit Score + Confidence + 5태그 + 근거, 최근 14일 안에 방영된 프로그램만) 세 섹션에 실데이터로 반영했다. **문서화된 설계 판단(PRD가 정확히 정의하지 않은 부분)**: Daypart는 새벽(02~08)/오전(09~13)/오후(14~18)/저녁·심야(19~25) 4구간으로 임의 정의했고, Target Affinity·Competitive Opportunity는 원본 자료 한계로 프로그램별이 아니라 **채널 단위**로 계산해 그 채널의 모든 프로그램에 동일 적용하며, 개별 percentile 하위지표에 쓸 데이터가 없으면 0이 아니라 50(중앙값)으로 처리해 전체 계산이 막히지 않게 했다(DATA_DICTIONARY.md §5 참고). 검증 과정에서 Postgres `round(double precision, int)` 미지원(→ `::numeric` 캐스팅 필요), GROUP BY 별칭 참조 오류, 그리고 `mart_competitive_score`의 최종 계산이 최종 결합 단계보다 늦게 실행되어 Competitive Opportunity가 전부 중립값(50)으로만 나오던 버그를 실데이터 재검증 중 발견해 고쳤다.

개발 단위 19번(원인 추적·기회 탐지)으로 PRD.md 5번 고정 기준 그대로 `get_root_cause_alert()`(채널 평균 최근 28일 대비 -10%p 이상 하락이 3일 연속되면 트리거, 하루짜리 변동은 노이즈로 무시)와 `get_opportunity_alert()`(자사 최근 7일 평균이 이전 7일 대비 +10%p 이상 강세이면서 등록 경쟁채널 중 같은 기간 -10%p 이상 약세인 채널이 있으면 트리거)를 만들어 Page 2 WHY?/OPPORTUNITY? 섹션에 실데이터로 반영했다 — 이로써 Page 2의 8대 질문이 전부 실데이터로 채워졌다. 두 함수 모두 "동시에 관찰됨 · 상관관계 가능성이 있으나 인과관계로 단정할 수 없음"으로만 제공한다(CLAUDE.md 원칙). **문서화된 설계 판단**: PRD의 "편성 변화 감지"(신규 편성·시간 이동·프로그램 교체·이탈)는 경쟁채널의 프로그램 단위 시간대별 데이터가 있어야 가능한데, 원본 자료는 채널당 경쟁채널 1개만 그 단위로 제공하고 전체 Competitor Master 채널은 채널 단위 일별 데이터만 있다(개발 단위 16번 한계, DATA_DICTIONARY.md §5). 그래서 "편성이 바뀌었다"고 단정하지 않고, 경쟁채널의 채널 단위 시청률이 같은 기간(전주 대비) 5%p 이상 움직였는지만 참고 정보로 제공한다(DATA_DICTIONARY.md §7). 실데이터 검증: 8/18 OLIFE에서 실제 3일 연속 하락 트리거(−16.4%/−10.0%/−13.2%)와 경쟁채널 변동(CMCTV ▲37.0%)이 확인됐고, 기회 탐지도 5~8월 구간에서 실제 트리거 사례(ONCE, ENA Story 등)를 여러 건 확인했다.

Page 1 레이아웃은 사용자가 제안한 예시 이미지대로 반영 완료(위 문단 참고).

Page 1 Original 리포트를 **화이트리스트 기반**으로 다시 만들었다(사용자 지시: "Original 분석은 그 프로그램들만 하면 돼"). 관리자가 `채널기본정보.xlsx`의 "요일 별 리뷰 프로그램" 시트(요일/프로그램명/본방 채널/본방 시간/비고/직재방 채널)에 요일별로 꼭 봐야 하는 프로그램을 지정하면(`original_review_programs`, 매 업로드마다 전체 교체), 그날 요일에 해당하는 프로그램만 실제 시청률 데이터와 매칭해 보여준다(`get_original_content_daily`). "본방 시간의 ±10분 이내로 시작하는 것이 본방송"이라는 사용자 기준을 그대로 구현했고, 자정을 넘기는 프로그램(예: 화요일 밤~수요일 새벽 00:40 방영)은 Nielsen의 "02:00~다음날 25:59=하루" 관행에 맞춰 하루 전 날짜 파일에서 찾도록 처리했다(`src/lib/originalReviewSchedule.ts`의 `parseKoreanBroadcastTime`이 "밤 10시"류 한글 시간 텍스트와 엑셀 시간 소수 둘 다 처리). 화이트리스트가 없는 요일(금요일)은 최근 7일 화이트리스트 프로그램 실적을 종합하는 주간 리뷰(`get_original_content_weekly_review`)로 자동 대체된다. **직접 겪은 버그**: 처음엔 "±10분 이내 시작"만으로 매칭해서, 그 시간대에 우연히 방영 중이던 다른 프로그램을 화이트리스트 프로그램으로 잘못 인식하는 문제가 실데이터로 확인됐다(TV로 방영되지 않는 "[웹예능]에나분식"이 그 시간대 방영 중이던 "유부녀킬러"에 매칭되는 등) — ±10분은 "본방송 여부"를 가리는 기준이지 프로그램을 찾는 기준이 아니므로, 프로그램명이 먼저 일치(공백·쉼표 등 문장부호 차이는 무시)해야 시간 매칭을 적용하도록 고쳤다. 수요일/목요일 "나는 SOLO" 프랜차이스의 "SBS Plus 동시방송 비교" 요청은 프로그램명을 하드코딩하지 않고, 화이트리스트에 걸린 채널마다 `get_competitor_program_overlap`을 재사용해 실제 시간이 겹치는 경쟁 프로그램(등록된 채널만, 상위 3개)을 그대로 붙이는 방식으로 일반화했다 — 그 시간대에 SBS Plus가 방영 중이면 자연히 나타난다.

Page 1을 사용자가 첨부한 참고 이미지(파스텔 블루·라벤더 그라디언트 + 블러 블롭 장식 + 글래스모피즘 화이트 카드)의 톤앤매너로 다시 디자인했다. 헤더는 "좋은 저녁입니다" 인사말 대신 ENA 로고 + "KT ENA YYYY-MM-DD 채널 현황" 제목으로 바꿨고, 본문은 **2열×3행 그리드**로 재구성했다 — R1: 채널 현황(ENA 크게+나머지 6채널 압축) | Original 성과(표 형태), R2: 채널별 인사이트(줄글) | 채널별 킬러 콘텐츠(daypart 강세·약세), R3: 빠른 요약 태그(전체 폭, 기존 🟢🟡🔴 규칙 기반 태그 유지). **R2/R3 셀 배치는 사용자가 명시하지 않아 임의로 정한 설계 판단**임을 밝혀둔다.

이 작업 중 실데이터로 발견한 버그: **skyUHD의 채널 단위 시청률·등위가 지금까지 전혀 저장되지 않고 있었다.** skyUHD는 프로그램 단위 데이터만 별도 수기 파일로 받는다고 여겨왔는데, 실제로는 §1.1 "유료방송가입가구" 랭킹 시트에 "SkyUHD"라는 이름으로 매일 다른 채널들과 나란히 채널 단위 시청률·등위가 들어있었다 — `nielsenDaily.ts`의 채널 필터 집합에 이름이 없어서 조용히 걸러지고 있었다. 필터에 추가하고 `scripts/backfill-skyuhd-channel-rank.mjs`로 230일 전체를 재백필했다(이제 목표 달성률·순위·인사이트에 skyUHD도 정상 반영).

채널별 인사이트(줄글)는 `get_channel_daily_narrative()` SQL 함수(오늘 vs 최근 28일 평균의 시청률·순위·점유율·피크시간대·1위 프로그램 자체 이력·연령대별 편차를 계산)를 문장으로 조립한다(Page 2 오늘의 브리핑과 동일하게 "SQL 계산 → 클라이언트에서 문장 조립" 패턴). "4주 이상 반복되는 패턴은 언급 회피"라는 사용자 지시는 임계값(시청률 ±15%, 순위 ±3, 프로그램 자체 이력 대비 ±30%, 연령대 ±30%)을 넘는 것만 문장화하는 방식으로 구현했다 — 편차가 없으면 자연히 안 나온다. skyUHD는 등위가 10위 이상 움직였을 때만 별도로 한 줄 언급한다(그 미만이면 아예 언급하지 않음, 사용자 지시 그대로). 채널별 킬러 콘텐츠는 `get_channel_killer_content_daypart()`로 최근 4주 상위 프로그램의 daypart(Fit Score MART와 동일한 4구간: 새벽/오전/오후/저녁·심야)별 강세·약세를 계산한다. 두 함수 모두 Page 2에서 이미 검증된 패턴(hour 버킷팅, 공백 무시 프로그램명 매칭)을 그대로 재사용했다.

사용자 추가 지시(같은 작업 중): ENA/ENA Play/ENA Drama는 KPI가 "수도권 2049"지만, `전국 유료가구` 타깃으로도 최근 12주(84일) 평균 대비 유의미(±30%)하게 기여한 프로그램이 있으면 함께 언급하도록 `get_channel_household_top_program()`을 추가했다(2049 기준 1위와 같은 프로그램이면 "2049뿐 아니라 유료가구 기준으로도"로, 다르면 "2049 타깃과 별개로"로 구분해 표현). Page 2 COMPARED WITH?의 "오늘 시간대별 경쟁 프로그램"/"오늘 경쟁채널 TOP 5"에서 "(우리 시청률)" 같은 "우리" 표현은 전부 제거했다(사용자 지시).

개발 단위 20번(Nielsen 메일 자동 수집)을 구현했다. christine@ktena.co.kr의 그룹웨어(더존 Bizbox)는 2FA가 걸려있어 브라우저 자동 로그인으로 메일함에 직접 접근할 수 없다는 게 이전 조사에서 확인됐다 — 그래서 **Gmail로 메일을 전달(forward)받아 Gmail API(OAuth2)로 첨부파일을 가져오는 방식**을 택했다(메일 전달 규칙 자체는 관리자가 Bizbox 웹메일에서 직접 설정해야 한다 — CLAUDE.md 원칙상 Claude가 표준 규칙을 대신 만들지 않음). 관리자 수동 업로드(`/api/admin/upload/nielsen-daily`)와 자동 수집이 **반드시 같은 파싱·적재 로직을 태워야 한다**는 고정 결정을 지키기 위해, 기존 라우트에 있던 파싱·검증·적재 코드를 `src/lib/nielsenIngest.ts`(재사용 가능한 함수)로 옮기고 두 경로 모두 이 함수만 호출하도록 리팩터링했다. Gmail 연동은 `src/lib/gmailClient.ts`(무거운 `googleapis` SDK 대신 fetch로 REST API를 직접 호출, 최소 구성 원칙)로 구현했고, 이미 처리한 메일은 `mail_ingestion_log` 테이블(메시지 ID 유니크)로 기억해 중복 처리를 막는다. `vercel.json`에 Vercel Cron(매일 08:00 KST)을 등록해 `/api/cron/fetch-nielsen-mail`을 자동 호출하며(배포 후에만 실제로 동작, `CRON_SECRET`으로 외부 호출 차단 가능), 관리자 화면에 "Nielsen 메일 자동 수집" 카드(`MailIngestionManager.tsx`)를 추가해 "지금 메일 확인" 버튼으로 크론을 기다리지 않고 즉시 테스트하고 처리 이력을 볼 수 있게 했다. **`.env`에 `GMAIL_USER_EMAIL`/`GMAIL_CLIENT_ID`/`GMAIL_CLIENT_SECRET`/`GMAIL_REFRESH_TOKEN`을 아직 채우지 않아 지금은 비활성 상태**(안내 메시지만 표시)이며, 채우기 전까지는 관리자 수동 업로드로 서비스가 계속 정상 동작한다(설계상 의도된 안전한 대기 상태 — 18번 Anthropic 키 패턴과 동일).

Page 2(채널별 딥다이브)를 사용자 지시(2026-08-20)로 대대적으로 재구성했다:
1. **오늘의 브리핑**: WHAT/WHY/SO WHAT/WHAT NEXT 라벨을 없애고 하나의 보고서 줄글로 바꿨고, 목표 달성률 언급을 뺐다. 대신 최근 12주 평균 대비 요일별 패턴(오늘 요일이 평소 강세/약세인지)·시간대 흐름(피크 시간대가 평소와 다른지)·기여 프로그램(오늘 1위 프로그램이 자기 자신의 12주 평균 대비 얼마나 기여/비기여했는지)·연령대 변화를 종합한다. Page 1과 같은 `get_channel_daily_narrative()` 함수를 12주(84일) baseline으로 재사용하고, 요일별 비교를 위해 `dow_baseline_avg_rating`(오늘과 같은 요일의 12주 평균) 컬럼을 새로 추가했다.
2. **WHO IS WATCHING?/HOW DEEPLY?**: 숫자는 그대로 두고, 그 숫자가 무슨 의미인지(Rating/Share/Reach/Time Spent 각각의 정의, Affinity 지수의 의미)와 오늘 값의 해석(어느 연령대가 상대적으로 강한지/약한지)을 줄글로 덧붙였다.
3. **CONTENT FITS?**: 카드 그리드 → 표(프로그램별 Target Performance/Affinity/Engagement + 3개 평균 "종합" 점수)로 바꾸고 종합 점수 높은 순(채널에 도움되는 순)으로 정렬, 상하위 프로그램을 짚어주는 줄글을 추가했다.
4. **OPPORTUNITY?/WHAT TO SCHEDULE?**: 채널 단위 Competitive Opportunity 숫자 대신, `get_channel_daypart_opportunity()`(새 함수)로 daypart(새벽/오전/오후/저녁·심야)별 "우리 vs 등록 경쟁채널" 격차가 보유 기간 전체(최대 1년) 평균 대비 최근 1주 사이 어떻게 바뀌었는지 계산해, 격차가 좁혀진(경쟁채널이 상대적으로 약해진) daypart를 편성 기회로 짚고 WHAT TO SCHEDULE?의 STRENGTHEN/TEST 후보를 그 daypart에 배치하도록 제안하는 보고서를 만든다.
5. **02~26시 그래프**: 막대 형태는 유지하되(사용자가 "일단 유지" 지시로 선형 그래프 요청을 재차 취소), `get_hourly_program_titles()`(새 함수)로 각 시간대에 실제 방영된 프로그램명을 막대 tooltip과 그래프 하단 목록에 표시했다.
6. **COMPARED WITH?**: Competitive Pressure 숫자를 없애고, `get_competitor_insight_report()`(새 함수)로 등록 경쟁채널을 **오늘 순위 높은 순**으로 나열하며 최근 12주 평균 대비 오늘 등락 + 오늘 최고 성적 프로그램(시간대)을 함께 보여주는 보고서로 바꿨다. **직접 겪은 버그**: 이 함수를 처음 만들 때 자사 매칭 타깃 라벨("수도권 2049")을 그대로 `competitor_ratings` 조회에 썼다가 0건만 나왔다 — `competitor_ratings`는 §1.1 랭킹 시트 표기("개인2049")를 쓴다는, `get_competitive_pressure`에서 이미 한 번 겪고 고쳤던 문제(CLAUDE.md 앞부분·DATA_DICTIONARY.md §1.1 참고)를 새 함수에 다시 반영 안 해서 재발한 것 — 같은 동의어 폴백 로직을 그대로 옮겨와 고쳤다.
7. **우측 상단 기간 설정**: "기준일" 고정 텍스트를 DoD/WoW/MoM/QoQ/YTD 프리셋 + 직접 날짜 선택 드롭다운으로 바꿨다(기본값 오늘=최신 데이터). **직접 겪은 버그**: 프리셋 날짜 계산에 `new Date(...).toISOString().slice(0,10)`을 썼다가, 브라우저의 로컬 타임존이 UTC보다 빠른 경우(예: KST) 날짜가 하루 당겨지는 문제가 실제로 발생했다(`T00:00:00`으로 로컬 시각으로 파싱한 뒤 `toISOString()`으로 UTC 변환하면서 자정 근처에서 날짜가 넘어감) — `toISOString()` 대신 `getFullYear/getMonth/getDate`로 로컬 날짜 문자열을 직접 만들도록 고쳐 타임존에 안전하게 만들었다.

사용자 추가 지시(2026-08-20, 같은 작업): Page 2 WHAT TO SCHEDULE?에서 STRENGTHEN/TEST/MOVE 프로그램이 지금 주로 방영되는 daypart보다 다른 daypart의 경쟁채널 격차가 더 좁혀지고 있으면(이미 OPPORTUNITY?에 있는 daypart별 격차 데이터 재사용) 그 daypart를 괄호로 추천하도록 했다 — 이를 위해 `mart_program_target_score.current_daypart`(프로그램이 최근 12주 동안 가장 자주 방영된 daypart, 이미 있는 `mart_slot_score`의 daypart 분류를 재사용해 계산)를 새로 추가했다(`refresh_fit_score_mart()` 수정, 새 SQL 로직 없이 기존 조인 재사용). Page 1 채널별 킬러 콘텐츠의 "점유율은"→"점유율이" 워딩도 고쳤다.

## 자연어 질의 엔진(18번, 규칙 기반) — Intent Registry 아키텍처

2026-08-20, 사용자가 PD가 실제로 물을 만한 질문을 Intent/Parameter/Metric/Rule/Analytics Mart/Response Template 구조로 미리 정의해 LLM 없이도 동작하게 만들라는 대규모 스펙을 직접 제시했다(11개 Macro Intent, Time Resolver, Parameter Extractor, 300개 이상 테스트셋, Python `/agent` 디렉토리 구조 등). 그대로 따르면 이 문서의 두 고정 결정과 충돌한다는 점을 사용자에게 확인받았다: (1) "18번은 `ANTHROPIC_API_KEY` 확보 전까지 보류"였던 이전 판단, (2) "별도의 SQL/Python 분석 엔진(백엔드 서비스)을 두지 않는다"는 고정 아키텍처(스펙 원안은 `/agent/intent/*.py` 같은 Next.js 밖 Python 구조). 사용자가 "TS로 포팅해 지금 시작"을 선택해 18번 보류를 해제했고, Python 구조 대신 Next.js 네이티브(TypeScript)로 포팅하기로 확정했다.

**1차 슬라이스 범위**: 원안 11개 Macro/수십 개 Intent를 한 번에 만들지 않고(CLAUDE.md "최소부터 시작" 원칙), 이미 있는 SQL 함수로 바로 답할 수 있는 5개 Macro·9개 Intent만 등록했다 — PORTFOLIO_RANKING/PORTFOLIO_KPI_GAP/PORTFOLIO_ALERT(Macro 01), CHANNEL_PERFORMANCE/CHANNEL_DAYPART(Macro 02), PROGRAM_TOP(Macro 03), TARGET_AFFINITY(Macro 04), COMPETITIVE_POSITION/COMPETITIVE_HEAD_TO_HEAD(Macro 07). 새 SQL 함수를 하나도 만들지 않고, Page 1/2에서 이미 검증된 `get_rating_period_report`/`get_target_achievement`/`get_root_cause_alert`/`get_opportunity_alert`/`get_channel_daily_narrative`/`get_channel_dow_daypart_pattern`/`get_channel_top_programs`/`get_target_affinity`/`get_competitor_insight_report`/`get_competitor_program_overlap`만 재사용했다(CLAUDE.md "계산은 SQL이, Claude/엔진은 해석만" 원칙).

**구조**(`src/lib/intent/`): `types.ts`(공용 타입) → `timeResolver.ts`(어제/최근N일/이번주/지난달/전분기/YTD/전년동기 등 Rolling↔Calendar 구분 파싱, "OO 대비" 비교 기준 인식) → `referenceData.ts`(channels/competitors/targets를 DB에서 캐시 조회 — 존재하지 않는 채널/타깃을 임의로 인식하지 않기 위해 하드코딩 대신 DB 기준 매칭) → `parameterExtractor.ts`(채널명 별칭·연령대 표기·경쟁채널명·TOP N/가장~ 추출) → `intentRegistry.ts`(9개 Intent 정의) → `intentRouter.ts`(후보 Intent 중 필요 파라미터 충족 + specificity 높은 것 우선 선택, 스펙의 Collision Prevention) → `executors.ts`(RPC 호출) → `responseTemplates.ts`(결론→핵심 수치→비교 기준→Evidence→해석→Programming Action→Confidence 순서 강제, 스펙 Evidence-First Rule). API는 `/api/ask`(POST, 관리자+PD 공유 링크 세션 둘 다 허용), UI는 Page 2(`ChannelDeepDive.tsx`)에 "질문하기" 섹션 하나로 배치했다 — 특정 채널 페이지에 있어도 질문 속 채널명을 다시 인식해 다른 채널/포트폴리오 전체 질문에도 답한다(라이브로 확인: ENA 페이지에서 "어제 ENA Drama는 어땠어?" 질문 시 ENA가 아닌 ENA Drama 데이터를 정확히 반환).

**LLM 연동(2026-08-20, 사용자 지시 "openai api key를 활용")**: `.env`의 `OPENAI_API_KEY`(이미 값이 있었음)로 `src/lib/intent/llmClassifier.ts`를 추가했다. 규칙 기반 라우터가 먼저 시도하고(무료·결정적·이미 42/42 검증됨), `no_intent_matched`/`missing_required_parameter`로 실패할 때만 OpenAI(`gpt-4o-mini`, Structured Outputs로 Intent Registry의 9개 intent_id·유효 channel_code/target_label/competitor_name 목록을 enum으로 강제)를 한 번 더 호출해 같은 `RouteResult` 형태로 반환한다 — 그 뒤(SQL 실행·Evidence 조립)는 규칙 기반 경로와 완전히 동일한 코드(`dispatchIntent()`, `/api/ask/route.ts`)를 탄다(CLAUDE.md "LLM이 계산을 직접 하지 않는다" 원칙 유지). LLM은 `time_phrase`(원문 그대로, 예: "어제")만 추출하고 실제 날짜 계산은 여전히 `timeResolver.ts`가 담당 — 프롬프트에 "날짜를 직접 계산하지 마라"고 명시(LLM의 날짜 연산 오류 위험 회피). 키가 없거나 API 호출이 실패하면 조용히 null을 반환해 기존 미지원 응답으로 자연스럽게 대체된다(LLM 장애가 서비스를 막지 않음). 응답 JSON에 `usedLlmFallback` 플래그를 추가해 어느 경로로 답했는지 구분 가능. 라이브로 확인: 규칙 기반이 못 잡는 "ONCE 채널 요즘 컨디션 어때?" 같은 자유 표현이 OpenAI를 거쳐 정확히 CHANNEL_PERFORMANCE로 라우팅되고, 규칙 기반이 이미 잡는 질문("어제 ENA는 어땠어?")은 OpenAI를 호출하지 않는 것(비용 절감)을 둘 다 확인했다.

**작업 중 발견한 사고**: 이 작업 도중 `.env`의 `OPENAI_API_KEY` 값과 바로 다음 줄 `NEXT_PUBLIC_SUPABASE_URL=`이 줄바꿈 없이 한 줄로 붙어있는 파일 손상을 발견했다(원인 불명 — 편집 중 줄바꿈이 유실된 것으로 추정). 두 값 다 깨진 상태였고, OpenAI 호출이 401(Incorrect API key)로 실패하는 것으로 처음 발견함 — 값 자체는 손상 없이 줄바꿈만 복구하고, 그 과정에서 생긴 빈 중복 줄(`NEXT_PUBLIC_SUPABASE_URL=` 값 없이 한 줄 더 있던 것)도 제거했다. 실제 키 값은 채팅에 출력하지 않았다(CLAUDE.md 원칙).

**Confidence 설계 판단**: 스펙의 표본 일수 기준 Confidence(8주+=HIGH~2주미만=INSUFFICIENT_SAMPLE)를 기계적으로 모든 응답에 적용했더니, "어제 ENA는 어땠어?" 같은 단일 일자 사실 조회까지 표본 1일→INSUFFICIENT_SAMPLE로 나와 오해를 주는 문제를 라이브 검증 중 발견했다 — 단일 일자 조회는 통계적 추정이 아니라 실측 사실 하나이므로 항상 HIGH로 처리하고, 표본 일수 기준 Confidence는 여러 날에 걸친 롤링/캘린더 기간 조회에만 적용하도록 고쳤다(`confidenceForPeriodReport()`).

**테스트**: `scripts/test-intent-router.ts` + `npm run test:intent`(tsx로 실행, devDependency 추가) — 원안은 "300개 이상"이었지만 9개 Intent 규모에 맞춰 ~40개(같은 의미의 여러 표현 포함: 채널명 "ENA Drama"/"ENA DRAMA"/"ENA 드라마", 비교 "전일 대비"/"어제보다" 등)로 시작했고, Intent가 늘어나면 이 목록도 함께 늘린다. 현재 42/42 통과.

**미구현(스펙 원안 대비, `UNSUPPORTED` 응답으로 안내)**: Macro 05(Slot Intelligence 세부)/06(Audience Flow)/08(Content Efficiency)/09(Fatigue & Rerun)/10(Scheduling Intelligence 자연어화)/11(Portfolio Optimization), 그리고 ROI 등 CLAUDE.md "이번 범위에서 만들지 않는 것"에 이미 명시된 항목. 필요해지면 Intent Registry에 항목만 추가하는 방식으로 확장한다(새 아키텍처를 만들지 않음).

사용자 피드백 다수를 Page 1/2에 추가 반영했다(2026-08-20):
1. **0 표기**: 시청률이 반올림해서 0.000(skyUHD는 0.0000)이 되면 그냥 "0"으로 표시(NULL=데이터 없음과는 여전히 구분 — `formatRating`/`fmt` 공통 수정).
2. **오늘의 빠른 요약** 채널명 폰트를 그 채널 로고 색(`themeColor`)으로 bold 표시.
3. **헤더**: 새로고침 아이콘을 관리자 아이콘과 같은 크기(9×9 원형)로 줄이고, 그 왼쪽에 7개 채널 서브 페이지로 바로 이동하는 작은 로고 아이콘을 나열.
4. **로고 폭**: ONCE·skyUHD는 원본 워드마크 가로세로비가 유난히 넓어(실측 4.03·3.70, OLIFE 2.26) 높이만 맞추면 좁은 칸에서 오른쪽이 잘렸다 — `ChannelLogo`에 `maxWidthPx`(object-fit:contain 분기)를 추가해 이 두 채널만 OLIFE 폭에 맞춘다.
5. **채널 그리드 숫자 정렬**: 로고 칸 폭 고정 + 시청률 칸에 `tabular-nums`+고정폭+왼쪽정렬로 "0."이 모든 행에서 같은 위치에서 시작. skyUHD는 자릿수가 하나 더 많아(4자리) 폰트를 줄여 폭을 맞춤.
6. **조사(이/가·은/는·을/를) 자동 선택**: `src/lib/josa.ts` 신규 — 마지막 글자 받침 유무로 판정(한글 유니코드 종성 계산, 영문/숫자는 근사, 괄호·따옴표 등 뒤끝 기호는 무시하고 그 앞 글자 기준). "'나는SOLO'이(가)" 같은 병기 표현을 전부 실제 조사로 교체(Dashboard.tsx/ChannelDeepDive.tsx/intent 엔진 전체).
7. **채널별 인사이트 우선순위**: 연령대 시청률이 100% 빠져 0이 된 경우(표본 작은 연령대의 흔한 노이즈)는 최하 우선순위로 밀어 다른 의미 있는 변화가 있으면 아예 생략되게 함(`buildChannelNarrative`).
8. **전주 대비**: 채널 압축 카드에 전일 대비 배지 아래 "전주 대비"(정확히 7일 전, WoW — `get_rating_trend_summary`가 이미 계산) 작은 텍스트 추가.
9. **히트맵 3시간 단위**: "최근 12주 요일×시간대" 히트맵을 4구간(새벽/오전/오후/저녁심야) 대신 3시간 단위 8구간(02-04~23-25)으로 세분화. 자연어 질의 엔진(`CHANNEL_DAYPART` intent)이 재사용 중인 기존 4구간 함수(`get_channel_dow_daypart_pattern`)는 그대로 두고, 히트맵 전용 신규 함수 `get_channel_dow_hourblock_pattern`을 추가했다(공유 함수를 건드려 다른 기능에 영향 주지 않기 위함).
10. **WHAT TO SCHEDULE? 본방/재방 분리**: `<본>`/`<재>` 태그는 원래도 `programs.canonical_name`에서 제거돼 같은 프로그램으로 합쳐졌는데(TOP20·킬러콘텐츠·Original 리포트는 이 매칭에 의존해 그대로 둠), `programs.first_run`이 channel×canonical_name당 값 하나만 upsert로 덮어써 개별 회차 단위 구분이 불가능했다 — `ratings.is_first_run`(신규 컬럼, ingestion 시 `<본>`=true/`<재>`=false/태그없음=null로 저장)을 추가해 `refresh_fit_score_mart()`의 프로그램 시간대 분석(same_slot_pctl/same_daypart_pctl/current_daypart)에서만 `<재>` 회차를 제외하도록 했다(평균 시청률 등 전체 성과 점수는 그대로 본방+재방 전체 반영 — 사용자 지시가 "시간대 분석"만 분리하라는 것이었음). **알려진 한계**: 기존 230일치 과거 데이터는 원본 파일을 다시 파싱해야 채워지므로 `is_first_run`이 전부 NULL(태그 없음과 동일하게 처리됨) — 신규/향후 업로드분부터 정확히 분리된다. 과거분 백필이 필요하면 별도 스크립트로 로컬 `Nielsen Data/` 폴더를 재업로드 파이프라인으로 재처리하면 된다(아직 실행 안 함).

사용자 피드백(2026-08-20)으로 채널별 인사이트의 프로그램 단위 비교 버그를 고쳤다: "'나는SOLO'가 오늘 1.589로 최근 평균(0.196)보다 712% 높은 성적"처럼 오리지널 드라마·예능(주 1회 편성)의 등락률이 비정상적으로 부풀려져 있었다 — `get_channel_daily_narrative`의 top_program/decline_program 비교와 `get_channel_household_top_program`이 같은 canonical_name의 **모든 요일·모든 시간대 방영분(새벽 재방송 블록 포함)**을 그대로 평균 내고 있어서, 주 1회만 본방하는 프로그램은 매일 도는 낮은 재방송 시청률이 평균을 크게 끌어내렸던 것(진짜 데이터 문제가 아니라 비교 기준이 잘못된 계산 버그). 사용자 지시대로 "해당 채널의 본방송 기준으로 최근 8주 본방 평균과 당일을 비교"하도록, Fit Score MART가 이미 쓰던 "슬롯(요일+시간대, `same_slot_pctl`)" 정의를 그대로 재사용해 baseline을 "같은 요일 + 같은 시간대(start_time 시(hour) 단위)"로 좁히고 기간도 프로그램 비교 전용 파라미터(`p_program_baseline_weeks`, 기본 8주)로 분리했다(채널 단위 지표는 기존 4주/12주 baseline 그대로 유지, `supabase/migrations/20260820220000_channel_narrative_program_slot_baseline.sql`). 같은 작업 중 Original 성과 카드의 "전회 대비로는 1편 상승, 0편 하락했습니다" 문장도 화이트리스트가 1편뿐일 때 당연한 소리를 부자연스럽게 반복하는 것으로 읽힌다는 지적을 받아, 비교 대상이 2편 이상일 때만 이 집계 문장을 쓰도록 고쳤다(1편뿐이면 바로 아래 "가장 뚜렷하게 움직인 프로그램" 문장이 개별적으로 설명).

사용자가 규칙 3건을 추가로 지시했다(2026-08-20):
1. **자연어 검색 경쟁채널 예외**: "OOO채널의 경쟁채널과 비교"라고 물으면 Channel Master(`채널기본정보.xlsx` "채널 별 경쟁채널" 시트로 채워진 `competitors` 테이블, 이미 기존 아키텍처) 기준으로만 답하되, **ENA Play/ENA Drama는 ENA를 경쟁채널로 인식하지 않는다** — 실제로 Competitor Master 시트에 ENA가 등록돼 있어(같은 KT ENA 계열이라 시트에 올라간 것으로 보임) `get_competitor_insight_report`/`get_competitor_program_overlap` 결과에 ENA가 섞여 나오고 있었다. Page 2 COMPARED WITH?는 등록된 값을 그대로 보여줘야 하므로(사용자 지시가 "자연어 검색에서"로 범위를 명시적으로 좁힘) `competitors` 테이블이나 공유 SQL 함수는 건드리지 않고, 자연어 검색 전용 계층(`src/lib/intent/referenceData.ts`의 `NL_COMPETITOR_EXCLUSIONS`)에서만 필터링한다 — 파라미터 추출(`getCompetitorRefs`)과 실행 결과(executors.ts의 두 함수) 양쪽 다 적용.
2. **회차 번호 자동 계산**: "주요 콘텐츠 오리지널 회차는 사용자가 중간중간 알려줄테니 패턴을 파악해 다음 회차를 계산하라"는 지시 — `program_episode_counters`(2026-08-20 오전 추가, `나는SOLO 267회=2026-08-19` 이미 seed됨) + `get_episode_number()`가 이미 이 기능을 구현하고 있다(seed 이후 실제 방영일 수를 세어 자동 계산, 결방 있어도 정확). 사용자가 대화 중 새 회차 번호를 알려주면 이 테이블에 upsert로 seed를 갱신해야 한다(대화 속 기억만으로 두지 않음).
3. **주요 콘텐츠 관리(`featured_content`) 본방 비교 — 보류**: "주요 콘텐츠 관리 목록의 타이틀은 그 목록에 등록된 요일·시간을 본방송으로 인식하고, 회차가 여러 개면 최신 8~12회차 평균과, 신규 프로그램(1회부터)이면 1회~직전회차 평균과 본방을 비교하되 전회 대비 비교는 항상 함께 보여달라"는 지시 — `featured_content`(관리자 CRUD, `broadcast_day_of_week`/`broadcast_time` 보유)는 지금까지 Original 리포트에 카테고리 태그만 붙이는 용도였고 이런 비교 계산이 없었다. `original_review_programs` 기반 Page 1 Original 리포트(`get_original_content_daily`)에 이미 있는 전회 대비·회차 기능과 유사하지만 대상 목록과 baseline 방식(고정 회차 수 평균)이 달라, 어디에 반영할지(기존 채널별 인사이트/Original 리포트 확장 vs 새 섹션) 사용자 확인 후 착수한다(2026-08-20 시점 미착수).

다음은 [`PRD.md`의 "10. 개발 단위"](PRD.md) 21번(Vercel 배포 및 운영 전환)을 진행한다. 18번은 1차 슬라이스가 끝났고, 사용자가 필요하다고 판단하는 Intent를 추가하는 방식으로 계속 확장한다.

## Claude Code 작업 규칙

- 모든 설명과 주석은 한국어로 작성한다.
- 새 파일은 `my-app` 폴더 안에만 만든다.
- 코드를 바꾸면 반드시 무엇을 왜 바꿨는지 한 줄로 알려준다.
- `.env` 등 비밀 정보 파일과 `node_modules` 폴더는 `.gitignore`에 등록해 두고, 절대 커밋하지 않는다.
- 외부 서비스 인증이 필요하면 토큰 값을 사용자에게 묻거나 채팅에 출력하지 말고, `.env`에 있는 값을 읽어서 사용한다.
  - 예: Supabase 작업이 필요하면 Supabase CLI를 설치해 `.env`의 `SUPABASE_ACCESS_TOKEN`으로 작업한다.
  - 예: Vercel 작업(배포 등)이 필요하면 Vercel CLI를 설치해 `.env`의 `VERCEL_TOKEN`으로 인증해 작업한다.
- 파일을 지워야 할 때는 바로 삭제하지 말고, `trash-can` 폴더를 만들어 그 안으로 옮겨만 둔다. 삭제 여부는 사용자가 직접 확인한 뒤 결정한다.
- 이미 설치된 서브에이전트는 필요할 때마다 적극 활용한다.

## 고정된 아키텍처 결정 (임의로 바꾸지 말 것)

- **스택은 Next.js + Supabase(PostgreSQL)로 고정**이다. Day 1 실습 구성을 그대로 이어받아 3일차에 Vercel로 배포하기 위함이므로, 다른 프레임워크나 DB로 바꾸거나 마이그레이션을 제안하지 않는다. 배포는 Vercel을 사용한다.
- **별도의 SQL/Python 분석 엔진(백엔드 서비스)을 두지 않는다.** Claude가 Next.js API Route를 통해 Supabase를 직접 조회하고 계산까지 수행한다. 단, 계산은 암산이 아니라 **SQL 집계 쿼리(또는 필요시 Python 스크립트)를 실제로 실행**해서 나온 값이어야 하며, 원본 Excel 파일을 직접 열어 파싱하거나 계산하지 않는다. Fit Score처럼 여러 지표를 조합하는 계산은 `MART_*` 테이블에 SQL/Python으로 사전 계산해두고, Claude는 그 결과를 조회해 해석·설명만 담당한다.
- **DB 스키마는 최소 테이블부터.** 채널·프로그램·타깃·시청률·목표 시청률 등 당장 필요한 테이블만 먼저 만들고, PRD 원안에 있던 전체 차원 모델(DIM/FACT 다수 테이블)을 처음부터 다 구현하지 않는다. 확장은 필요할 때마다. skyUHD·2025년 연간 데이터는 별도 테이블로 분리하지 않고 메인 시청률 테이블에 `source_type` 구분 컬럼으로 함께 관리한다.
- **접근 제어는 의도적으로 최소화된 2단계 구조**다: 관리자 2명만 로그인(업로드 포함 전체 기능, 링크 재발급 권한 포함), 그 외 PD는 관리자가 발급한 **고정 공유 링크 하나**로 접속해 Morning Briefing 열람과 자연어 질문만 가능(업로드 불가, 개별 사용자 식별 없음). 회원가입 기능은 만들지 않는다.
- **분석 대상은 7개 채널**: ENA·ENA Drama·ENA Play·ENA Story·OLIFE·ONCE(전체 분석) + skyUHD(시청률만 별도 관리, 수기 업데이트 파일). Channel Master/Competitor Master/목표 시청률은 `채널기본정보.xlsx`로 이미 확보됨 — PRD.md 5번 "목표 대비 분석"·"경쟁채널 분석" 항목 참고.
- **데이터 유입은 2단계**다: (1) 2026-01-01~08-18 백필은 관리자가 Daily Excel을 수동 업로드(3월 14일만 결측, 원본은 프로젝트 폴더 내 `Nielsen Data/`에서 관리하며 `.gitignore`로 커밋 제외), (2) 그 이후는 christine@ktena.co.kr로 오는 `[닐슨] KTENA 일일 보고서 (YYMMDD)` 메일의 `닐슨_채널시청률(YYMMDD).xls` 첨부파일을 자동 수집(메일함 인증 방식은 미정 — 구현 전 논의 필요). 두 경로 모두 결과적으로 같은 파싱·적재 로직을 태워야 한다.
- **Nielsen Excel 원본 구조는 실제 샘플 파일로 확인 완료됨**: 시트 10개 고정(`유료방송가입가구`, `개인`, `ENA/ENA DRAMA/ENA PLAY/ONCE,OLIFE 경쟁채널시청률`, `ENA/ENA DRAMA/ENA PLAY/ONCE,OLIFE,ENA SPORTS 타깃상세`), 각 시트는 헤더 2행 + 타깃·채널 블록이 가로로 반복되는 다단 헤더 구조이며 단순 1행 헤더 테이블이 아니다. skyUHD(`26 UHD ALL` 시트, `시:분:초:프레임` 시간 형식)와 2025년 연간 파일은 각각 다른 구조다. 파싱 코드를 작성하기 전 `DATA_DICTIONARY.md`(개발 단위 6번에서 작성)를 먼저 만들어 문서화한다.
- **화면은 2페이지 구조**: Page 1(종합 대시보드) — 7개 채널 당일 성과 스캐닝, ENA 채널이 최우선 하이라이트. Page 2(채널별 딥다이브) — 채널 선택 시 8대 질문(WHAT HAPPENED?~WHAT TO SCHEDULE?)으로 섹션화된 상세 화면, 자연어 질문은 이 안의 한 섹션으로 배치.
- **계산 공식은 PRD.md에 명시된 것을 그대로 쓴다** (임의로 다른 공식을 만들지 않는다):
  - 목표 달성률 = 실제 평균 시청률 ÷ 목표 시청률 × 100, Gap = 실제 − 목표
  - Affinity = 특정 Target 구성비 ÷ 비교 기준 채널의 해당 Target 구성비 × 100 (최소 표본·최소 분모 조건 미달 시 표시하지 않음)
  - Competitive Pressure = 동시간대 상위 3개 경쟁채널 평균 시청률 ÷ 자사 프로그램 시청률 × 100 (100 초과 시 클램프)
  - 편성 추천은 **Fit Score(0~100) 기반**: 30% Target Performance + 20% Target Affinity + 15% Audience Engagement + 15% Slot Performance + 10% Competitive Opportunity + 10% Audience Flow (각 하위 지표는 최근 12주 percentile로 표준화). Fit Score 80~100 STRENGTHEN / 65~79 KEEP / 50~64 MOVE / 50미만 REPLACE, 단 표본 부족(Confidence 낮음)이면 Fit Score와 무관하게 TEST. 가중치는 CONFIG 테이블로 관리해 튜닝 가능하게 한다. 상세 산식은 PRD.md 5번 참고.

## Claude(에이전트)가 서비스 내에서 지켜야 할 규칙

이 프로젝트는 Claude 자신이 최종 서비스의 분석·응답 주체다. 아래는 기능 구현 시 반드시 지키게 만들어야 하는 동작 규칙이다 (전체는 [`PRD.md`](PRD.md) 5번 참고):

- Nielsen 일별 파일의 시트(유료방송가입가구/개인 랭킹, 각 채널 경쟁채널시청률, 각 채널 타깃상세)는 전부 파싱해 DB에 저장해두고(`src/lib/nielsenIngest.ts`/`nielsenDaily.ts`), 인사이트를 낼 때는 이 여러 출처를 한 번에 고려해 결론을 낸다 — 예: 목표 달성률(랭킹)만 보고 판단하지 않고 동시간대 경쟁 프로그램(§1.2)·타깃별 성과(§1.3)까지 함께 봐서 "그래서 무엇을 해야 하는가"를 낸다(사용자 지시, 2026-08-19).
- 경쟁채널은 Competitor Master에 등록된 것만 사용 — 존재하지 않는 채널/데이터를 임의로 만들지 않는다.
- NULL(데이터 없음)과 0을 구분해서 표시하고, NULL을 0으로 임의 변환하지 않는다.
- 데이터 품질 검증(파일·구조·값·완전성)에서 심각한 오류 발견 시 🔴 DATA QUALITY ALERT를 먼저 표시하고 해당 분석을 중단한다.
- Acquisition/Retention/Mass/Core 같은 콘텐츠 유형 분류는 절대적 속성으로 단정하지 말고 "최근 12주 데이터 기준" 등 분석 기간을 항상 함께 표시한다.
- 편성 추천에는 반드시 근거(Evidence)와 Confidence(신뢰도)를 함께 표시하며, 표본이 부족하면 "INSUFFICIENT SAMPLE"로 표시하고 단정하지 않는다.
- 상관관계를 인과관계로 단정하지 않는다.
- 자연어 질문에 답할 때는 항상 DB의 검증된 데이터만 근거로 하고, 근거가 없으면 추측하지 말고 "찾을 수 없습니다" 등으로 명확히 안내한다. 프로그램명은 띄어쓰기·회차/부제 차이 정도는 동일 프로그램으로 인식하되, 그래도 못 찾으면 사유를 밝힌다.

## 이번 범위에서 만들지 않는 것

[`PRD.md`](PRD.md) 6번 참고 — Content ROI(비용·매출 연동) 계산, 개인 단위 패널 이동 기반 Audience Flow 추적, 채널 간 Cannibalization 확정적 판별, 편성표 실제 반영(추천만 하고 확정은 PD가 별도 시스템에서), 회원가입/공개 계정 생성 기능. 이 범위를 벗어나는 기능을 임의로 추가하지 않는다.
