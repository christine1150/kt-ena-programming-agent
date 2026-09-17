# 📺 KT ENA 편성 AI Agent (`kt-ena-programming-agent`)

**Nielsen 시청률 및 편성 데이터 기반의 편성 PD 전용 AI 편성 비서**

> **"숫자를 보여주는 대시보드 → 숫자의 의미를 해석하는 분석 시스템 → 편성PD의 실제 의사결정을 지원하는 AI 편성 비서"**

[![Deployed on Vercel](https://img.shields.io/badge/deployed-vercel-black?logo=vercel)](https://kt-ena-programming-agent.vercel.app)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3ecf8e?logo=supabase)](https://supabase.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript)](https://www.typescriptlang.org/)

---

## 1. 프로젝트 개요 및 핵심 철학

본 프로젝트는 KT ENA의 다채널 편성 PD가 Nielsen 시청률 및 편성 데이터를 기반으로 **"무엇이 일어났는가 → 왜 그런가 → 누가 반응했는가 → 어느 시간대가 강하고 약한가 → 콘텐츠 문제인가, 시간대 문제인가 → 경쟁환경은 어떤가 → 무엇을 유지·변경·실험해야 하는가"**를 빠르고 정확하게 판단하도록 지원합니다.

### 💡 핵심 철학 (Core Philosophy)
* **DB / Analytics Layer = Source of Truth**: 모든 공식 KPI(시청률, 점유율, Reach, Time Spent, Fit Score 등) 산출, 통계, 집계 쿼리는 DB와 Analytics Mart에서 전담합니다.
* **LLM = Interpreter / Decision-Support Layer**: LLM은 데이터를 직접 생성하거나 임의 계산하지 않으며, 검증된 DB 데이터를 이해·해석하고 의사결정을 보조합니다.

---

## 2. 채널 KPI Architecture & 핵심 기능

### 🎯 채널 그룹별 KPI 관리
* **GROUP A (2049 CORE)**: `ENA`, `ENA Drama`, `ENA Play`
  * **PRIMARY KPI**: 수도권 2049 시청률 | **SECONDARY**: 유료방송가구
* **GROUP B (HOUSEHOLD CORE)**: `OLIFE`, `ONCE`, `ENA Story`, `skyUHD`
  * **PRIMARY KPI**: 유료방송가구 시청률 | **SECONDARY**: 수도권 2049

### 📊 Page 1 — Daily Briefing
* **오늘의 시청률**: ENA 핵심 KPI 중앙 정렬 및 전일 대비 순위 증감 표기, 하단 6개 채널 로고 중심 요약.
* **주요 콘텐츠 리뷰**: 동시간대 경쟁 프로그램 리뷰, 지정 Original 부재 시 최근 7일 내 유의미한 콘텐츠 자동 선택.
* **AI Daily Insight**: DB 실측값 기반의 최대 3줄 팩트 중심 일간 브리핑 (인과관계 단정 표현 배제).

### 🔍 Page 2 — Programming Intelligence & Slot Intelligence
* **8개 시간대 슬롯 분석 (8-Block Slot Intelligence)**
  * `02-05`, `05-08`, `08-11`, `11-14`, `14-17`, `17-20`, `20-23`, `23-02` 구간 정밀 진단.
  * 슬롯 분류: `PROTECT`, `DEFEND`, `IMPROVE`, `OPPORTUNITY`.
* **Program × Slot Fit (핵심 차별화 기능)**
  * 콘텐츠 고유 성과 vs 시간대 평균 성과 비교를 통해 **"콘텐츠 문제인가, 시간대 문제인가"**를 구별 (`CONTENT STRONG`, `SLOT MISMATCH`, `PROGRAM × SLOT SYNERGY`, `CONTENT WEAK`).
* **Channel DNA & KPI Gap**
  * Official KPI 대비 실제 강세 오디언스(M/F 20~60+) 비교를 통한 타깃 특화 및 Gap 해석.
* **Action Framework**: `KEEP`, `STRENGTHEN`, `WATCH`, `TEST`, `MOVE`, `REPLACE` 제안 (Mart 공식 판정 연동).

### 🤖 Advanced LLM Agent (DB-Grounded Interface)
* **Time Context 동적 주입**: KST 기준 `CURRENT_DATE` 시스템 시간 자동 주입으로 "어제", "최근 4주" 등 자연어 시간 표현 정밀 파싱.
* **Structured Output (JSON Schema)**: 시각화 필요 시 마크다운 섞임 없이 `line_chart`, `bar_chart`, `comparison`, `table`, `heatmap` 규격 JSON 반환 후 Frontend 렌더링.
* **Evidence UI**: 모든 분석 답변에 `HIGH / MEDIUM / LOW / INSUFFICIENT` 신뢰도 및 근거 데이터 제시.
* **Context-Aware Follow-up**: 질문 하단에 2~3개의 후속 추천 질문 칩 제공.

---

## 3. 시스템 아키텍처 & LLM 파이프라인

```
[사용자 자연어 질문 / UI 요청]
         │
         ▼
[Intent & Parameter Extraction (Time Context: CURRENT_DATE / KST)]
         │
         ▼
[Approved Analytics Layer / DB Query (Source of Truth)]
         │
         ▼
[Validated Analytics Data (No Hallucination)]
         │
  ───────┴───────────────────────────────┐
  │ USE_ADVANCED_LLM_AGENT = true       │ USE_ADVANCED_LLM_AGENT = false (or Fallback)
  ▼                                     ▼
[OpenAI Interpreter Layer]            [Rule-based Engine]
  │ (JSON Schema Output)                │
  ▼                                     ▼
[Evidence UI + Dynamic Recharts]      [Standard Report UI]
```

---

## 4. 핵심 분석 및 개발 원칙

1. **No Hallucination**: DB/Analytics Layer에 없는 시청률, 경쟁채널, 타깃 데이터 추정 엄금. 데이터 부재 시 `"현재 연결된 데이터에서는 해당 내용을 확인할 수 없습니다."` 명시.
2. **No Arbitrary SQL**: LLM이 임의로 SQL을 생성 및 실행하지 않으며, 승인된 Analytics API/Query만 사용.
3. **인과관계 단정 금지**: 데이터가 직접 증명하지 못하는 인과관계 주장 금지 (예: "경쟁채널 때문에 하락했습니다" → "동시간대 경쟁채널 상승과 자사 성과 하락이 동시에 관찰됩니다").
4. **Delta-Only**: 기존에 정상 동작하는 UI, SQL, API, Nielsen ETL, Fit Score 로직을 보존하며 정밀 수정.
5. **보안**: API Key 하드코딩 금지, Client-exposed 변수(`NEXT_PUBLIC_`)에 Secret Key 노출 금지.

---

## 5. 기술 스택 & 폴더 구조

* **Framework**: Next.js 16 (App Router, TypeScript)
* **Styling**: Tailwind CSS 4
* **Database**: Supabase (PostgreSQL) + SQL Analytics Mart
* **AI Engine**: OpenAI (`gpt-4o` / `gpt-4o-mini`) with Structured Outputs + Rule-based Fallback

```
src/
├── app/
│   ├── page.tsx                 # Page 1 종합 대시보드
│   ├── channel/[code]/           # Page 2 채널별 딥다이브
│   ├── admin/                    # 관리자 (업로드, 목표 시청률, 콘텐츠 관리)
│   └── api/                      # Analytics & LLM API Routes
├── components/                   # 공용 UI 컴포넌트 및 Chart 파서
├── lib/
│   ├── analytics/                # Analytics Queries & SQL Mart Wrappers
│   ├── intent/                   # Intent Registry, Parameter Extractor
│   └── llm/                      # Advanced LLM Agent, Time Context Injector, Schema Validator
supabase/
└── migrations/                   # SQL 마이그레이션 및 Analytics Mart 함수
```

---

## 6. Feature Flag & Fallback / Rollback 가이드

환경변수를 통해 LLM Agent 체계와 기존 Rule-based 체계를 즉시 전환할 수 있습니다.

* **환경변수 설정**: `USE_ADVANCED_LLM_AGENT=true` (또는 `false`)
* **자동 Fallback 조건**: OpenAI API 에러, Timeout, 인증 오류, Invalid JSON, DB 쿼리 실패 시 차트 및 대시보드 깨짐 없이 기존 Rule-based 로직으로 자동 전환됩니다.
* **Rollback 방법**: `.env` 파일 내 `USE_ADVANCED_LLM_AGENT=false` 변경 후 서버 재시작.

---

## 7. 환경변수 설정 (`.env.local`)

```bash
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
ADMIN_SESSION_SECRET=your_admin_session_secret
OPENAI_API_KEY=your_openai_api_key
USE_ADVANCED_LLM_AGENT=true
```