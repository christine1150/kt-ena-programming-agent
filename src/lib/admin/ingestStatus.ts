// 자료 수신 현황 계산(단계 05) — 채널 × 자료 종류별로 "수집됨"과 "분석 반영 완료"를 분리해 보여 준다.
// 순수 함수다. 호출부(API)가 원장·ratings·마트 조회 결과를 사실(ReceiptFact)로 만들어 넘긴다.
// 수집 성공(received~validated, partial, applied) ≠ 분석 반영 완료(applied이고 마트 재계산까지 끝남).
export type DataKind = "nielsen_daily" | "skyuhd" | "nielsen_weekly" | "nielsen_monthly" | "olife_epg";
export type FactState = "received" | "parsed" | "validated" | "partial" | "applied" | "failed";

export interface ReceiptFact {
  channel: string;
  kind: DataKind;
  /** 일간은 방송일, 주간·월간은 기간 종료일 */
  date: string;
  state: FactState;
  /** 반영 시각(ISO). 없으면 모름 */
  appliedAt?: string | null;
  /** 이 날짜의 사전 계산 마트가 마지막으로 계산된 시각(ISO). 없으면 아직 계산 안 됨 */
  martComputedAt?: string | null;
  /** 이 자료가 사전 계산 마트에 의존하는지(닐슨 일간만 true). false면 반영 = 분석 반영 완료 */
  martRequired?: boolean;
}

export type Expectation = "daily" | "irregular" | "weekly" | "monthly";

export const KIND_LABEL: Record<DataKind, string> = {
  nielsen_daily: "닐슨 일간",
  skyuhd: "skyUHD 수기",
  nielsen_weekly: "닐슨 주간",
  nielsen_monthly: "닐슨 월간",
  olife_epg: "EPG(일일운행표)",
};

export const KIND_EXPECTATION: Record<DataKind, Expectation> = {
  nielsen_daily: "daily",
  olife_epg: "daily",
  skyuhd: "irregular",
  nielsen_weekly: "weekly",
  nielsen_monthly: "monthly",
};

/** 채널별로 받아야 하는 자료 종류. 해당 없는 조합은 행을 만들지 않는다(없는 것을 "미수신"으로 세지 않기 위해). */
export const APPLICABLE: Record<string, DataKind[]> = {
  ENA: ["nielsen_daily", "nielsen_weekly", "nielsen_monthly", "olife_epg"],
  ENA_DRAMA: ["nielsen_daily", "nielsen_weekly", "nielsen_monthly", "olife_epg"],
  ENA_PLAY: ["nielsen_daily", "nielsen_weekly", "nielsen_monthly", "olife_epg"],
  ENA_STORY: ["nielsen_daily", "nielsen_weekly", "nielsen_monthly", "olife_epg"],
  OLIFE: ["nielsen_daily", "nielsen_weekly", "nielsen_monthly", "olife_epg"],
  ONCE: ["nielsen_daily", "nielsen_weekly", "nielsen_monthly", "olife_epg"],
  SKYUHD: ["skyuhd"],
};

export type Health = "ok" | "delayed" | "missing" | "failed" | "unknown";

export interface ReceiptRow {
  channel: string;
  kind: DataKind;
  expectation: Expectation;
  latestCollectedDate: string | null;
  latestAppliedDate: string | null;
  /** 반영됐고 마트까지 계산된 가장 최근 날짜 */
  latestAnalysisReadyDate: string | null;
  missingDates: string[];
  failedDates: string[];
  partialDates: string[];
  /** 수집은 됐지만 아직 분석에 반영되지 않은 날짜(received·parsed·validated) */
  collectedNotApplied: string[];
  /** 반영은 됐지만 마트 재계산을 기다리는 날짜 */
  recomputePending: string[];
  health: Health;
}

const DAY = 86400000;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
const RANK: Record<FactState, number> = { failed: 0, received: 1, parsed: 2, validated: 3, partial: 4, applied: 5 };

/** 같은 날짜에 사실이 여럿이면 가장 진행된 상태를 쓰되, 성공 상태가 있으면 이전 실패는 덮인 것으로 본다. */
function bestByDate(facts: ReceiptFact[]): Map<string, ReceiptFact> {
  const m = new Map<string, ReceiptFact>();
  for (const f of facts) {
    const cur = m.get(f.date);
    // 같은 진행 상태가 여럿이면 반영 시각이 더 늦은 것(재업로드로 다시 반영된 것)이 현재 상태다.
    const newer = cur && RANK[f.state] === RANK[cur.state] && !!f.appliedAt && (!cur.appliedAt || f.appliedAt > cur.appliedAt);
    if (!cur || RANK[f.state] > RANK[cur.state] || newer) m.set(f.date, f);
  }
  return m;
}

const STALE_AFTER_DAYS: Record<Exclude<Expectation, "daily" | "irregular">, number> = { weekly: 10, monthly: 40 };

export function computeReceiptMatrix(args: { channels: string[]; window: { from: string; to: string }; facts: ReceiptFact[]; today: string }): ReceiptRow[] {
  const rows: ReceiptRow[] = [];
  // 일간 자료는 보통 다음 날 아침에 오므로 어제까지를 기대한다.
  const expectedThrough = addDays(args.today, -1);
  for (const channel of args.channels) {
    for (const kind of APPLICABLE[channel] ?? []) {
      const expectation = KIND_EXPECTATION[kind];
      const byDate = bestByDate(args.facts.filter((f) => f.channel === channel && f.kind === kind));
      const dates = [...byDate.keys()].sort();
      const applied = dates.filter((d) => ["applied", "partial"].includes(byDate.get(d)!.state));
      const ready = applied.filter((d) => {
        const f = byDate.get(d)!;
        if (f.state !== "applied") return false;
        if (f.martRequired === false) return true;
        return !!f.martComputedAt && (!f.appliedAt || f.martComputedAt >= f.appliedAt);
      });
      const missingDates: string[] = [];
      if (expectation === "daily") {
        const through = expectedThrough < args.window.to ? expectedThrough : args.window.to;
        for (let d = args.window.from; d <= through; d = addDays(d, 1)) if (!byDate.has(d)) missingDates.push(d);
      }
      const failedDates = dates.filter((d) => byDate.get(d)!.state === "failed");
      const partialDates = dates.filter((d) => byDate.get(d)!.state === "partial");
      const collectedNotApplied = dates.filter((d) => ["received", "parsed", "validated"].includes(byDate.get(d)!.state));
      const recomputePending = dates.filter((d) => byDate.get(d)!.state === "applied" && !ready.includes(d));

      const latestApplied = applied.length ? applied[applied.length - 1] : null;
      let health: Health;
      if (failedDates.length > 0 && missingDates.length + failedDates.length > 0 && (!latestApplied || failedDates[failedDates.length - 1] > latestApplied)) health = "failed";
      else if (expectation === "daily") health = latestApplied === null ? (dates.length === 0 ? "missing" : "delayed") : missingDates.length > 0 || collectedNotApplied.length > 0 ? "delayed" : "ok";
      else if (expectation === "irregular") health = latestApplied ? "ok" : "unknown";
      else health = latestApplied === null ? "missing" : daysBetween(latestApplied, args.today) > STALE_AFTER_DAYS[expectation] ? "delayed" : "ok";

      rows.push({
        channel,
        kind,
        expectation,
        latestCollectedDate: dates.length ? dates[dates.length - 1] : null,
        latestAppliedDate: latestApplied,
        latestAnalysisReadyDate: ready.length ? ready[ready.length - 1] : null,
        missingDates,
        failedDates,
        partialDates,
        collectedNotApplied,
        recomputePending,
        health,
      });
    }
  }
  return rows;
}

export interface ReceiptSummary {
  total: number;
  ok: number;
  delayed: number;
  missing: number;
  failed: number;
  unknown: number;
  missingDays: number;
  failedDays: number;
  collectedNotApplied: number;
  recomputePending: number;
}

export function summarizeReceipts(rows: ReceiptRow[]): ReceiptSummary {
  const s: ReceiptSummary = { total: rows.length, ok: 0, delayed: 0, missing: 0, failed: 0, unknown: 0, missingDays: 0, failedDays: 0, collectedNotApplied: 0, recomputePending: 0 };
  for (const r of rows) {
    s[r.health]++;
    s.missingDays += r.missingDates.length;
    s.failedDays += r.failedDates.length;
    s.collectedNotApplied += r.collectedNotApplied.length;
    s.recomputePending += r.recomputePending.length;
  }
  return s;
}
