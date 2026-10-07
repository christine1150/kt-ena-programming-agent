// 내보내기 머리 정보(OPT06) — 순수 함수. 편성안·모델·데이터·권리 버전, 기준 기간, 예측 한계, 확인이 필요한 슬롯을 한 곳에서 만든다.
//
// 엑셀·인쇄·JSON이 모두 같은 함수를 쓰므로 "상단·격자·내보내기가 같은 편성안을 가리킨다"가 코드로 보장된다.
// 방송 후 회고는 OPT05의 채택 스냅샷(adoption.ts)과 같은 블록·같은 버전으로 연결된다 — adoptionInputFrom이 그 변환이다.
import { sealOf, type AdoptionBlock, type AdoptionInput } from "./adoption";
import type { WorkingStateInfo } from "./planVersion";

export interface ExportBlock {
  weekday: number;
  start_min: number | string;
  end_min: number | string;
  candidate_key: string;
  program_key: string;
  program_name: string;
  content_type: string;
  expected_kpi: number | null;
  fallback_level: number | null;
  confidence_score: number | null;
  expected_kpi_type?: string | null;
}

export interface ExportMetaInput {
  runId: string;
  planVersion: string;
  weekStart: string;
  asOfDate: string;
  /** 비교 기준 주(CURRENT)의 시작일 — 없으면 null */
  currentWeekStart: string | null;
  targetLabel: string;
  versions: { model: string; features: string; genreDigest: string; constraintsDigest: string; configDigest: string; rangeBasis: "BACKTEST" | "TRAINING" | "NONE"; validated: boolean } | null;
  rights: { status: "not_configured" | "applied" | "error" | "unknown"; inventoryVersion: string | null; mode: string | null };
  working: WorkingStateInfo;
  edits: { from: string; to: string; weekday: number; startMin: number; reason: string | null }[];
  searchKind: "SEARCHED_BEST" | null;
  robustness: { pPositive: number | null; p10: number | null; residualN: number } | null;
  /** 확인이 필요한 칸(확정 준비 검사 결과 중 실행 가능이 아닌 칸) */
  needsConfirm: { weekday: number; startMin: number; programName: string; state: string; reasons: string[] }[];
  generatedAt: string;
  blocks: ExportBlock[];
}

export interface ExportMeta {
  /** [항목, 값] — 엑셀 설정 시트·인쇄 머리글에 그대로 쓴다 */
  rows: [string, string][];
  limits: string[];
  needsConfirm: ExportMetaInput["needsConfirm"];
  /** 같은 스냅샷(편성안 내용 + 평가값 + 버전)의 봉인 — 방송 후 회고가 같은 스냅샷인지 확인한다 */
  snapshotId: string;
}

const WD = ["", "월", "화", "수", "목", "금", "토", "일"];
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(Math.round(min % 60)).padStart(2, "0")}`;
const r6 = (v: number | null) => (v === null ? null : Math.round(v * 1e6) / 1e6);

export function snapshotIdOf(planVersion: string, blocks: ExportBlock[], versions: ExportMetaInput["versions"]): string {
  const rows = blocks
    .map((b) => [b.weekday, Math.round(Number(b.start_min) * 1000) / 1000, Math.round(Number(b.end_min) * 1000) / 1000, b.candidate_key, r6(b.expected_kpi)])
    .sort((a, b) => (a[0] as number) - (b[0] as number) || (a[1] as number) - (b[1] as number));
  return `S${sealOf(JSON.stringify({ planVersion, rows, versions }))}`;
}

export function buildExportMeta(i: ExportMetaInput): ExportMeta {
  const v = i.versions;
  const rows: [string, string][] = [
    ["편성안 버전", i.planVersion],
    ["스냅샷 ID", snapshotIdOf(i.planVersion, i.blocks, v)],
    ["실행 ID", i.runId],
    ["대상 주(월요일)", i.weekStart],
    ["자료 기준일(이 날까지의 방영·시청률만 사용)", i.asOfDate],
    ["비교 기준 주(기준안)", i.currentWeekStart ?? "없음"],
    ["최적화 타깃", i.targetLabel],
    ["모델 버전", v ? `${v.model} / 특징 ${v.features}` : "기록 없음(오래된 편성안)"],
    ["입력 버전(장르·제약·설정)", v ? `${v.genreDigest} / ${v.constraintsDigest} / ${v.configDigest}` : "기록 없음"],
    ["예측 범위 근거", v ? (v.rangeBasis === "BACKTEST" ? "과거 주 검증 오차" : v.rangeBasis === "TRAINING" ? "과거 변동(검증 전)" : "범위 없음") : "기록 없음"],
    ["모델 검증", v ? (v.validated ? "시간 순서 검증 완료" : "검증 전") : "기록 없음"],
    ["권리(Avail) 목록 버전", i.rights.status === "applied" ? `${i.rights.inventoryVersion ?? "-"} (${i.rights.mode ?? "-"})` : i.rights.status === "not_configured" ? "Avail 자료 미입력 — 권리 미확인" : i.rights.status === "error" ? "권리 판정 실패 — 권리 미확인" : "기록 없음"],
    ["편성안 상태", i.working.label],
    ["생성 시각", i.generatedAt],
  ];
  if (i.edits.length) {
    rows.push(["수동 수정", `${i.edits.length}칸`]);
    for (const e of i.edits) rows.push([`  ${WD[e.weekday] ?? e.weekday} ${hhmm(e.startMin)}`, `${e.from} → ${e.to}${e.reason ? ` (이유: ${e.reason})` : ""}`]);
  }

  const limits: string[] = [
    "예상 시청률은 같은 모델이 계산한 기대값이며 방송 결과가 아닙니다. 기준안과의 차이도 같은 모델끼리의 비교입니다.",
    "방송하지 않은 안의 실제 시청률은 관측되지 않습니다 — 개선율은 실제 효과가 아니라 모델상 차이입니다.",
  ];
  if (!v || !v.validated) limits.push("이 모델은 실제 자료로 시간 순서 검증을 마치지 않았습니다(검증 전) — 예상값을 목표값으로 쓰지 마세요.");
  if (i.searchKind === "SEARCHED_BEST") limits.push("이 편성안은 탐색된 최선안이며 최적임을 증명하지 않았습니다.");
  limits.push("여러 후보 중 높은 값을 고르는 과정에서 생기는 낙관(선택 편향)은 덜어내지 않았습니다.");
  if (i.robustness) limits.push(`검증 오차를 반영한 시나리오에서 개선이 유지되는 비율 ${i.robustness.pPositive === null ? "-" : `${(i.robustness.pPositive * 100).toFixed(0)}%`}(잔차 ${i.robustness.residualN}건) — 선택 편향은 반영하지 않은 값입니다.`);
  if (i.working.state !== "COMPUTED") limits.push(i.working.detail);
  if (i.rights.status !== "applied") limits.push("권리(Avail)를 확인하지 못해 모든 칸이 '권리 미확인'입니다 — 실행 가능으로 보지 않습니다.");
  if (i.needsConfirm.length) limits.push(`확인이 필요한 칸 ${i.needsConfirm.length}개(아래 목록) — 실행 가능으로 표시하지 않았습니다.`);

  return { rows, limits, needsConfirm: i.needsConfirm, snapshotId: snapshotIdOf(i.planVersion, i.blocks, v) };
}

/**
 * 같은 편성안을 OPT05 채택 스냅샷 입력으로 바꾼다(방송 후 회고 연결). 호출부가 채택 결정(상태·이유·결정자)과 권리·타깃 버전을 준다.
 * 예상값은 지금 편성안의 값 그대로다 — 내보낸 값과 회고가 대조하는 값이 같아야 하기 때문이다.
 */
export function adoptionInputFrom(args: {
  runId: string;
  weekStart: string;
  targetLabel: string;
  blocks: ExportBlock[];
  versions: { model: string; features: string; genreDigest: string; constraintsDigest: string; configDigest: string };
  rightsInventory: string | null;
  planFingerprint: string;
  decision: AdoptionInput["decision"];
  context: AdoptionInput["context"];
}): AdoptionInput {
  const gradeOf = (b: ExportBlock): AdoptionBlock["grade"] => {
    if (b.expected_kpi === null) return null;
    const lv = b.fallback_level ?? 6;
    return lv >= 4 ? "C" : lv === 3 || (b.confidence_score !== null && b.confidence_score < 0.005) ? "B" : "A";
  };
  return {
    runId: args.runId,
    weekStart: args.weekStart,
    targetLabel: args.targetLabel,
    blocks: args.blocks
      .filter((b) => b.content_type !== "COMPETITOR_BENCHMARK")
      .map((b) => ({ weekday: b.weekday, startMin: Number(b.start_min), endMin: Number(b.end_min), programKey: b.program_key, programName: b.program_name, expected: b.expected_kpi, grade: gradeOf(b) })),
    versions: { ...args.versions, rights: args.rightsInventory, planFingerprint: args.planFingerprint },
    decision: args.decision,
    context: args.context,
  };
}
