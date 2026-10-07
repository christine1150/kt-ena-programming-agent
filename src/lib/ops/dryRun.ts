// 단계 16 — 읽기 전용 원본 대조·backfill dry-run의 순수 계산(DB·파일 접근 없음). 로컬 원본을 지금 파서로 읽은 값과 저장된 값을 견주어
// 어디가 얼마나 다른지, 만약 다시 반영(backfill)한다면 어떤 범위가 바뀌는지를 계산한다. 이 모듈도 스크립트도 아무것도 쓰지 않는다.
export interface RankRecord {
  date: string;
  channelCode: string;
  targetLabel: string;
  rank: number | null;
  rating: number | null;
  share: number | null;
  reach: number | null;
  timeSpentSeconds: number | null;
}

export type DiffKind = "changed" | "missing_in_db" | "extra_in_db";
export interface RankDiff {
  date: string;
  channelCode: string;
  targetLabel: string;
  kind: DiffKind;
  /** changed일 때 값이 다른 필드 이름 */
  fields: string[];
}

const key = (r: RankRecord) => `${r.date}|${r.channelCode}|${r.targetLabel}`;
const num = (a: number | null, b: number | null, eps: number) => (a === null || b === null ? a === b : Math.abs(a - b) <= eps);

/** 원본(지금 파서 출력)과 저장값을 (날짜·채널·타깃)으로 맞춰 비교한다. 빈 값(null)과 0은 다르게 취급한다. */
export function compareRankRecords(source: RankRecord[], stored: RankRecord[], eps = 1e-6): { matched: number; diffs: RankDiff[] } {
  const s = new Map(source.map((r) => [key(r), r]));
  const d = new Map(stored.map((r) => [key(r), r]));
  const diffs: RankDiff[] = [];
  let matched = 0;
  for (const [k, a] of s) {
    const b = d.get(k);
    if (!b) {
      diffs.push({ date: a.date, channelCode: a.channelCode, targetLabel: a.targetLabel, kind: "missing_in_db", fields: [] });
      continue;
    }
    const fields: string[] = [];
    if (a.rank !== b.rank) fields.push("rank");
    if (!num(a.rating, b.rating, eps)) fields.push("rating");
    if (!num(a.share, b.share, eps)) fields.push("share");
    if (!num(a.reach, b.reach, eps)) fields.push("reach");
    if (a.timeSpentSeconds !== b.timeSpentSeconds) fields.push("timeSpentSeconds");
    if (fields.length === 0) matched++;
    else diffs.push({ date: a.date, channelCode: a.channelCode, targetLabel: a.targetLabel, kind: "changed", fields });
  }
  for (const [k, b] of d) if (!s.has(k)) diffs.push({ date: b.date, channelCode: b.channelCode, targetLabel: b.targetLabel, kind: "extra_in_db", fields: [] });
  return { matched, diffs };
}

/** 다시 반영했을 때 영향을 받는 저장물(읽어서 센 값을 호출하는 쪽이 넘긴다) */
export interface ImpactCounts {
  /** 날짜별 사전 계산(마트) 행 수 */
  martRowsByDate: Record<string, number>;
  /** 날짜별 AI 문장 캐시 행 수 */
  llmTextRowsByDate: Record<string, number>;
  /** 저장된 보고서 스냅샷 수(불변 — 재생성 대상이 아님) */
  reportSnapshotCount: number | null;
}

export interface BackfillPlan {
  comparedRows: number;
  matchedRows: number;
  diffRows: number;
  byKind: Record<DiffKind, number>;
  affectedChannels: string[];
  affectedDates: string[];
  /** 갱신될 ratings 행 수(changed + missing_in_db: 새로 넣을 행). extra_in_db는 지우지 않고 보고만 한다 */
  rowsToWrite: number;
  /** 지우지 않고 사람이 확인할 행(저장돼 있으나 원본에 없음) */
  rowsToReview: number;
  martDatesToRecompute: string[];
  martRowsAffected: number;
  llmTextRowsAffected: number;
  reportSnapshotCount: number | null;
  /** 값이 바뀐 필드별 건수 */
  fieldCounts: Record<string, number>;
}

export function planBackfill(compared: { matched: number; diffs: RankDiff[] }, impact: ImpactCounts): BackfillPlan {
  const byKind: Record<DiffKind, number> = { changed: 0, missing_in_db: 0, extra_in_db: 0 };
  const fieldCounts: Record<string, number> = {};
  const channels = new Set<string>();
  const dates = new Set<string>();
  for (const d of compared.diffs) {
    byKind[d.kind]++;
    channels.add(d.channelCode);
    dates.add(d.date);
    for (const f of d.fields) fieldCounts[f] = (fieldCounts[f] ?? 0) + 1;
  }
  const affectedDates = [...dates].sort();
  const sum = (m: Record<string, number>) => affectedDates.reduce((a, dt) => a + (m[dt] ?? 0), 0);
  return {
    comparedRows: compared.matched + compared.diffs.filter((d) => d.kind !== "extra_in_db").length,
    matchedRows: compared.matched,
    diffRows: compared.diffs.length,
    byKind,
    affectedChannels: [...channels].sort(),
    affectedDates,
    rowsToWrite: byKind.changed + byKind.missing_in_db,
    rowsToReview: byKind.extra_in_db,
    martDatesToRecompute: affectedDates,
    martRowsAffected: sum(impact.martRowsByDate),
    llmTextRowsAffected: sum(impact.llmTextRowsByDate),
    reportSnapshotCount: impact.reportSnapshotCount,
    fieldCounts,
  };
}

export const ROLLBACK_STEPS = [
  "실행 전 대상 날짜의 ratings(채널 집계 행)를 백업한다 — 수집 파이프라인이 이미 하는 백업(nielsen 적재 전 스냅샷)과 같은 방식을 쓴다.",
  "적용은 날짜 단위로 한다. 한 날짜의 반영이 실패하면 그 날짜만 백업으로 되돌리고 나머지는 건드리지 않는다.",
  "되돌림 후 해당 날짜의 사전 계산(마트)을 다시 계산하면 화면 값이 이전으로 돌아온다(마트는 ratings에서 만들어지는 파생값).",
  "AI 문장 캐시는 입력 지문 기반이라 값이 되돌아오면 이전 문장이 다시 쓰인다(별도 삭제 불필요).",
  "보고서 스냅샷은 불변이라 건드리지 않는다. 새 값으로 보고서를 다시 만들면 새 ID로 저장되고 옛 보고서는 그대로 남는다.",
];

export function renderDryRunMarkdown(title: string, scope: { files: number; dateFrom: string | null; dateTo: string | null }, plan: BackfillPlan): string {
  const lines: string[] = [];
  lines.push(`# ${title}`, "");
  lines.push("**읽기 전용 점검 결과다. 운영 데이터를 바꾸지 않았다.**", "");
  lines.push(`- 원본 파일 ${scope.files}개, 기간 ${scope.dateFrom ?? "—"} ~ ${scope.dateTo ?? "—"}`);
  lines.push(`- 비교한 채널 집계 행 ${plan.comparedRows}개: 일치 ${plan.matchedRows}개, 다름 ${plan.diffRows}개`);
  lines.push(`- 다름의 종류: 값이 다름 ${plan.byKind.changed} · 저장돼 있지 않음 ${plan.byKind.missing_in_db} · 저장돼 있으나 원본에 없음 ${plan.byKind.extra_in_db}`);
  if (Object.keys(plan.fieldCounts).length) lines.push(`- 값이 다른 필드: ${Object.entries(plan.fieldCounts).map(([k, v]) => `${k} ${v}건`).join(", ")}`);
  lines.push("", "## 다시 반영한다면(backfill 가정)", "");
  lines.push(`- 영향 채널: ${plan.affectedChannels.join(", ") || "없음"}`);
  lines.push(`- 영향 날짜: ${plan.affectedDates.join(", ") || "없음"}`);
  lines.push(`- 쓸 ratings 행: ${plan.rowsToWrite}개(값 갱신 ${plan.byKind.changed} + 새로 넣기 ${plan.byKind.missing_in_db}) — 저장돼 있으나 원본에 없는 ${plan.rowsToReview}개는 지우지 않고 사람이 확인한다`);
  lines.push(`- 사전 계산(마트) 다시 계산할 날짜 ${plan.martDatesToRecompute.length}일, 영향 행 ${plan.martRowsAffected}개`);
  lines.push(`- 지워질 AI 문장 캐시 ${plan.llmTextRowsAffected}개(입력이 바뀐 날짜 기준, 다시 생성됨)`);
  lines.push(`- 보고서 스냅샷 ${plan.reportSnapshotCount ?? "—"}개: 불변이라 재생성 대상이 아니다(다시 만든 보고서는 새 ID)`);
  lines.push("", "## rollback", "");
  ROLLBACK_STEPS.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
  lines.push("", "> 이 보고서는 적용 승인 전 판단 자료다. 운영 재계산·덮어쓰기는 별도 승인 전에는 실행하지 않는다.", "");
  return lines.join("\n");
}
