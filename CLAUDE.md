# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

본 저장소는 **KT ENA 편성 AI Agent (`kt-ena-programming-agent`)** — Nielsen 시청률 및 편성 데이터를 자동 집계·분석하고, 편성 PD에게 Daily Briefing, Slot Intelligence, 자연어 질의응답 및 5대 편성 액션 추천(KEEP/MOVE/REPLACE/STRENGTHEN/TEST)을 제공하는 AI 의사결정 지원 서비스다.

- **현재 상태**: Vercel 배포 완료, Next.js 16(App Router, TypeScript, Tailwind 4) + Supabase(PostgreSQL) 기반 아키텍처 구동 중.
- **LLM 파이프라인**: OpenAI (`gpt-4o` / `gpt-4o-mini`) 기반 Structured Output Agent + Rule-based Engine Fallback 구조 구축 완료 (`USE_ADVANCED_LLM_AGENT` 환경변수로 제어).

---

## 1. 개발 & 운영 명령 모음

- **개발 서버 실행**: `npm run dev` (http://localhost:3000)
- **프로덕션 빌드**: `npm run build`
- **코드 린트**: `npm run lint`
- **헬스 체크**: `npm run dev` 실행 후 `http://localhost:3000/api/health`
- **Intent 라우터 테스트**: `npm run test:intent`
- **DB 스키마 변경**: `supabase migration new <migration_name>` 작성 후 `supabase db push` (기존 마이그레이션 파일 수정 금지, 항상 신규 추가)
- **관리자 계정 추가/재설정**: `node --env-file=.env scripts/seed-admin.mjs <email> [password]`
- **배포 전 로컬 검토(Claude 전용)**: `npm run mint-review-session` → 출력된 안내대로 로컬 브라우저에 세션 쿠키를 심으면 로그인 없이 `npm run dev` 화면을 그대로 확인 가능(`.env.local`의 별도 `ADMIN_SESSION_SECRET`으로만 서명되며 프로덕션에는 통하지 않음, 2026-09-03 도입)

---

## 2. 고정된 핵심 아키텍처 & 개발 원칙

1. **DB / Analytics Layer = Source of Truth**: 모든 공식 KPI(시청률, 점유율, Reach, Time Spent, Fit Score 등) 계산 및 집계 쿼리는 DB(Postgres / SQL Mart)에서 전담한다. LLM이나 프론트엔드가 수치를 직접 계산하거나 암산하지 않는다.
2. **LLM = Interpreter / Decision-Support Layer**: LLM은 검증된 DB 데이터를 이해 및 해석하고 의사결정을 보조하며, 무조건 Structured Output (JSON Schema) 형태로 응답한다.
3. **No Hallucination & No Arbitrary SQL**: DB/Mart에 없는 수치나 타깃을 임의 추정하지 않으며, LLM이 프롬프트에서 동적으로 SQL을 생성/실행하는 행위를 엄금한다 (승인된 API/RPC/Mart만 사용).
4. **Time Context 동적 주입**: 자연어 질문 파싱 시 항상 KST 기준 `CURRENT_DATE` 시스템 시각을 동적으로 주입하여 상대적 시간 표현("어제", "지난주", "최근 4주")을 정확히 해결한다.
5. **Delta-Only 변경**: 기존 정상 동작하는 UI, SQL, Nielsen ETL, Fit Score 산출 로직을 보존하며 정밀 수정한다.
6. **보안 지침**: API Key 및 Secret Key 하드코딩 금지. `.env` 파일과 `node_modules`는 절대 커밋하지 않는다.

---

## 3. 핵심 시스템 구성 & 데이터 처리 지침

### 📺 대상 채널 그룹 (7개)
- **Group A (2049 Core)**: `ENA`, `ENA Drama`, `ENA Play` (Primary KPI: 수도권 2049)
- **Group B (Household Core)**: `OLIFE`, `ONCE`, `ENA Story`, `skyUHD` (Primary KPI: 유료방송가구)

### 📊 주요 파이프라인 및 기능
- **Page 1 (Daily Briefing)**: 7개 채널 현황 카드 그리드, 화이트리스트 기반 Original 콘텐츠 리포트, 팩트 중심 일간 브리핑.
- **Page 2 (Programming & Slot Intelligence)**: 8대 시간대 슬롯(`02-05`~`23-02`) 진단, Program × Slot Fit 분석, Channel DNA & Target Gap, 5대 Action Framework.
- **Natural Language Agent (`/api/ask`)**: Intent Registry + Time Resolver + Parameter Extractor 기반. 1차 규칙 기반 라우팅 → 미매칭 시 OpenAI(`gpt-4o-mini`) 라우팅 → DB RPC 실행 → Evidence UI + Dynamic Recharts 차트 반환.
- **Fit Score (편성 추천 엔진)**: 30% Target Performance + 20% Target Affinity + 15% Audience Engagement + 15% Slot Performance + 10% Competitive Opportunity + 10% Audience Flow (최근 12주 Percentile 표준화).

### ⚠️ 데이터 파싱 및 도메인 유의사항 (Data Traps)
- **Nielsen 파일 특성**: `ENA Story`는 일별 파일에 프로그램 단위 데이터가 일부 기간 부재하므로 채널 단위 처리 예외를 명시한다.
- **타깃 명칭 동의어 매칭**: Channel Master("수도권 개인2049") / 타깃상세 시트("수도권 2049") / 랭킹 시트("개인2049") 간 표기 차이는 `targetResolution.ts` 동의어 폴백으로 처리한다.
- **프로그램명 매칭**: 공백, 쉼표, 문장부호 및 회차 태그(`<본>`, `<재>`)를 제거한 Canonical Name 기준으로 회차 통합 및 본/재방 시간대 분석을 수행한다.
- **skyUHD**: 별도 수기 누적 파일(`26 skyUHD 시청률 (MMDD).xlsx`) 업로드 처리. 초 단위 저장 및 `target_id` 비움 유지.

---

## 4. Claude Code 작업 규칙

- **언어 설정**: 모든 주석, 커밋 설명, 문서 작업은 한국어로 작성한다.
- **변경 설명**: 코드를 수정할 때마다 무엇을 왜 변경했는지 한 줄로 명확히 작성한다.
- **파일 관리**: 파일 삭제 시 즉시 지우지 않고 `trash-can/` 폴더로 이동시킨다 (사용자 최종 확인 후 삭제).
- **외부 CLI 활용**: Supabase CLI 및 Vercel CLI 사용 시 `.env` 내의 토큰/인증 정보를 활용하며, 터미널이나 대화창에 키 값을 직접 출력하지 않는다.
- **범위 제한**: ROI(비용/매출) 직접 계산, 개인 패널 이동 추적, 외주 시스템 실제 편성표 확정 연동 등 Scope를 벗어나는 기능을 임의로 추가하지 않는다 (`PRD.md` 참조).