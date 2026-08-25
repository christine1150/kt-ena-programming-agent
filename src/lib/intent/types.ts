// 자연어 질의 엔진(18번, 규칙 기반 Rule-based Prototype) 공용 타입.
// USER QUESTION → TIME RESOLVER → PARAMETER EXTRACTOR → INTENT REGISTRY → (라우팅) →
// METRIC/RULE ENGINE(SQL 함수 실행) → EVIDENCE → RESPONSE TEMPLATE 구조를 그대로 구현한다.
// 나중에 Anthropic API 키가 생겨 LLM을 붙이더라도, LLM은 "자연어 → Intent/Parameter JSON"
// 변환만 새로 맡고, 그 아래(Registry/실행/Evidence/템플릿)는 이 파일들을 그대로 재사용한다
// (CLAUDE.md 원칙: LLM이 계산을 직접 하지 않는다 — 계산은 항상 SQL 함수가 담당).

// ── TIME RESOLVER ────────────────────────────────────────────────────────
// Rolling(최근 N일/주/개월)과 Calendar(이번 주/지난달/이번 분기 등)를 구분한다
// (스펙 4번: "최근 7일 ≠ 이번 주, 최근 4주 ≠ 지난달").
export type TimeMode = "rolling" | "calendar" | "single_day" | "ytd";

export interface TimeContext {
  raw: string | null; // 질문에서 매칭된 시간 표현 원문 (없으면 null → 기본값 "오늘")
  mode: TimeMode;
  dateFrom: string; // YYYY-MM-DD
  dateTo: string;
  label: string; // 사람이 읽는 라벨, 예: "최근 7일", "이번 주(2026-08-17~08-23)"
  // 비교 기준 기간(전일/전주/전월/전분기/전년 동기 등) — "OO 대비" 질문에서만 채워진다.
  compareDateFrom: string | null;
  compareDateTo: string | null;
  compareLabel: string | null; // 예: "전일 대비", "전년 동기 대비"
}

// ── PARAMETER EXTRACTOR ──────────────────────────────────────────────────
export interface ExtractedParameters {
  channelCode: string | null; // channels.code, 예: "ENA_DRAMA"
  channelName: string | null; // 사람이 읽는 이름, 예: "ENA Drama"
  competitorName: string | null; // competitors.competitor_name과 일치(대소문자 무시)
  targetLabel: string | null; // targets.label과 일치하는 정확한 라벨(스코프 확정 후)
  targetRaw: string | null; // 질문에서 매칭된 원문(예: "2049", "여3049")
  rankingLimit: number | null; // "TOP 5", "상위 10" 등 → 5, 10. "가장/제일"만 있으면 1.
  rankingDirection: "top" | "bottom" | null; // 가장 잘한/부진한
}

// 추출하지 못한 파라미터는 임의로 추정하지 않는다(스펙 5번) — null로 남긴다.

// ── INTENT REGISTRY ──────────────────────────────────────────────────────
export type MacroIntentId =
  | "PORTFOLIO_HEALTH"
  | "CHANNEL_PERFORMANCE"
  | "PROGRAM_PERFORMANCE"
  | "AUDIENCE_INTELLIGENCE"
  | "COMPETITIVE_INTELLIGENCE";

export interface IntentDefinition {
  intent_id: string;
  macro_intent: MacroIntentId;
  description: string;
  examples: string[];
  // 이 Intent가 매칭되려면 질문에 아래 키워드 중 최소 하나가 있어야 한다(1차 후보 판별).
  keywords: string[];
  required_parameters: (keyof ExtractedParameters)[];
  data_mart: string; // 실제로 호출하는 Postgres 함수/뷰 이름(계산은 전부 여기서 — CLAUDE.md 원칙)
  // 여러 Intent가 동시에 후보일 때 우선순위(클수록 먼저 선택 — 스펙 31번 "가장 구체적인 Intent 우선").
  specificity: number;
}

export type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT_SAMPLE";

// 사용자 지시(2026-08-25, 감사 후속: 원 명세 30/31번) — SQL이 이미 계산해 둔 값을 그대로
// 막대그래프로 보여줄 수 있는 최소 구조. LLM은 이 구조를 채우지 않는다(responseTemplates.ts가
// SQL 결과에서 그대로 뽑아 채운다) — 새 수치를 만들지 않는다는 원칙 그대로.
export interface VisualizationSpec {
  type: "bar";
  title: string;
  series: { label: string; value: number | null }[];
}

export interface RouteResult {
  ok: true;
  intent_id: string;
  macro_intent: MacroIntentId;
  parameters: ExtractedParameters;
  timeContext: TimeContext;
  data_mart: string;
}

export interface UnsupportedResult {
  ok: false;
  reason: "no_intent_matched" | "missing_required_parameter";
  missing?: (keyof ExtractedParameters)[];
  candidateIntentIds?: string[];
}

// ── EVIDENCE-FIRST RESPONSE (스펙 26번: 결론→핵심수치→비교기준→Evidence→해석→Action→Confidence) ──
export interface EvidenceAnswer {
  intent_id: string;
  macro_intent: MacroIntentId;
  conclusion: string; // 1. 결론
  keyNumbers: string; // 2. 핵심 수치
  comparisonBasis: string; // 3. 비교 기준
  evidence: string; // 4. Evidence
  interpretation: string; // 5. 해석
  programmingAction: string; // 6. Programming Action
  confidence: ConfidenceLevel; // 7. Confidence
  confidenceNote: string;
  raw: unknown; // 원본 SQL 결과(디버깅/추가 표시용)
  // 사용자 지시(2026-08-25, 감사 후속: 원 명세 30/31번). 둘 다 선택 필드 — 의미 있는 값이
  // 없으면(예: 목록이 1개뿐이거나 애초에 미지원 답변) 그냥 비워둔다(억지로 채우지 않음).
  visualization?: VisualizationSpec; // 30번: SQL 결과를 그대로 옮긴 구조화 시각화
  followups?: string[]; // 31번: 같은 화면에서 바로 이어 물을 수 있는 후속 질문 후보
}
