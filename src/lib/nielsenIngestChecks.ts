// 닐슨 수집 단계 01 — DB를 쓰지 않는 순수 검증·계산 모음(파일 해시, 어댑터 상태, 시트 교차 검증, 재수신 차이).
// 적재 흐름(nielsenIngest.ts·nielsenFileDispatch.ts)이 호출하고, scripts/test-nielsen-ingest.ts가 직접 검증한다.
import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import { toChannelCode } from "@/lib/channelMaster";
import { resolveRankSheetTargetLabel } from "@/lib/targetResolution";
import type { QualityIssue } from "@/lib/dataQuality";
import { normalizeTime, type ProgramTargetRow, type RankRow, type Row } from "@/lib/nielsenDaily";
import type { NielsenPeriodType } from "@/lib/nielsenPeriod";

/** 파서·검증 규칙이 바뀌면 올린다 — 같은 파일이라도 버전이 다르면 재처리를 허용한다(멱등 판정 키). */
export const NIELSEN_PARSER_VERSION = "nielsen-ingest/2026-10-06.1";

export const fileSha256 = (buffer: Buffer): string => createHash("sha256").update(buffer).digest("hex");

export type AdapterStatus = "verified" | "provisional";

/** 주간은 원본(2026-09-28~10-04)으로 골든 대조를 마쳤다. 월간은 주간과 같은 랭킹 시트 구조라고 가정한 잠정 어댑터다. */
export function periodAdapterStatus(type: NielsenPeriodType): { status: AdapterStatus; note: string | null } {
  if (type === "weekly") return { status: "verified", note: null };
  return { status: "provisional", note: "월간 파일은 주간과 같은 랭킹 시트 구조로 가정한 잠정 어댑터입니다(이 저장소의 골든 대조는 일간·주간만 완료)." };
}

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const isoDow = (d: string) => (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7; // 0=월

/** 주간으로 판정된 기간이 월~일 7일이 아니면 경고(주간 비교·순위 계산이 어긋날 수 있다). */
export function checkWeeklyShape(from: string, to: string): QualityIssue[] {
  const ok = isoDow(from) === 0 && addDays(from, 6) === to;
  return ok ? [] : [{ severity: "warning", category: "structure", message: `주간 파일로 판정했지만 기간(${from}~${to})이 월~일 7일이 아닙니다.` }];
}

// ── 시트 내용 점검 ──────────────────────────────────────────────

export interface TargetBlockHeader {
  col: number;
  label: string;
}
export interface DailyInspection {
  sheetNames: string[];
  /** 랭킹 시트별 블록(7열 간격) 타깃 라벨 — 원본 헤더 */
  rankSheets: { sheet: string; labels: TargetBlockHeader[] }[];
  /** 타깃상세 시트의 채널 섹션별 타깃 라벨(5열 간격) — 원본 헤더 */
  targetDetail: { sheet: string; channel: string; labels: TargetBlockHeader[] }[];
  /** 경쟁채널시청률 시트 안의 자사 채널 블록 행(타깃상세와의 교차 검증용) */
  ownBlockRows: { sheet: string; channelCode: string; start: string; programName: string; ratings: { label: string; rating: number | null }[] }[];
}

const KNOWN_DETAIL_CHANNELS = new Set(["ENA", "ENA DRAMA", "ENA PLAY", "ONCE", "OLIFE", "ENA STORY"]);
const SELF_NAMES = new Set(["ENA", "ENA DRAMA", "ENA STORY", "ENA PLAY", "ONCE", "OLIFE"]);

const num = (raw: unknown): number | null => {
  if (raw === undefined || raw === null || raw === "") return null;
  const v = typeof raw === "number" ? raw : parseFloat(String(raw));
  return Number.isNaN(v) ? null : v;
};

export function inspectDailyWorkbook(buffer: Buffer): DailyInspection | null {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: "buffer" });
  } catch {
    return null;
  }
  const rowsOf = (sheet: string): Row[] => XLSX.utils.sheet_to_json<Row>(wb.Sheets[sheet], { header: 1, blankrows: true });
  const out: DailyInspection = { sheetNames: wb.SheetNames, rankSheets: [], targetDetail: [], ownBlockRows: [] };

  for (const sheet of ["유료방송가입가구", "개인"]) {
    if (!wb.Sheets[sheet]) continue;
    const rows = rowsOf(sheet);
    const noRow = rows.findIndex((r) => String(r?.[0] ?? "").trim() === "No.");
    if (noRow < 1) continue;
    const labelRow = rows[noRow - 1] ?? [];
    const labels: TargetBlockHeader[] = [];
    for (let col = 0; col < labelRow.length; col += 7) {
      const label = String(labelRow[col + 1] ?? "").trim().replace(/^-\s*/, "");
      if (label) labels.push({ col, label });
    }
    out.rankSheets.push({ sheet, labels });
  }

  for (const sheet of wb.SheetNames) {
    if (!/타깃상세$/.test(sheet)) continue;
    const rows = rowsOf(sheet);
    for (let r = 0; r < rows.length; r++) {
      const name = String(rows[r]?.[0] ?? "").trim();
      if (!KNOWN_DETAIL_CHANNELS.has(name) || String(rows[r + 1]?.[0] ?? "").trim() !== "시작시간") continue;
      const labels: TargetBlockHeader[] = [];
      const header = rows[r];
      for (let col = 3; col < header.length; col += 5) {
        const label = String(header[col] ?? "").trim();
        if (label) labels.push({ col, label });
      }
      out.targetDetail.push({ sheet, channel: toChannelCode(name), labels });
    }
  }

  for (const sheet of wb.SheetNames) {
    if (!/경쟁채널시청률$/.test(sheet)) continue;
    const rows = rowsOf(sheet);
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r] ?? [];
      for (let c = 0; c < row.length; c++) {
        if (String(row[c] ?? "").trim() !== "시작시간") continue;
        const name = String(rows[r - 1]?.[c] ?? "").trim();
        if (!SELF_NAMES.has(name)) continue;
        const labelRow = rows[r + 1] ?? [];
        const targets = [0, 1, 2].map((i) => ({ col: c + 3 + i, label: String(labelRow[c + 3 + i] ?? "").trim() })).filter((t) => t.label);
        for (let k = r + 2; k < rows.length; k++) {
          const first = String(rows[k]?.[c] ?? "").trim();
          if (first === "하루 전체" || first === "하루전체") break;
          if (!first) continue;
          const start = normalizeTime(rows[k][c]);
          const programName = String(rows[k]?.[c + 2] ?? "").trim();
          if (!start || !programName) continue;
          out.ownBlockRows.push({ sheet, channelCode: toChannelCode(name), start, programName, ratings: targets.map((t) => ({ label: t.label, rating: num(rows[k][t.col]) })) });
        }
      }
    }
  }
  return out;
}

/** 경쟁채널시청률 시트의 자사 블록 라벨(개인2049 등)을 타깃상세 시트 라벨(수도권 2049 등)로 옮긴다. 두 표기의 대응은
 *  targetResolution.ts가 DB 실측으로 확인해 둔 규칙(개인 타깃은 접두어 차이, 유료방송가구는 "전국 유료가구")을 그대로 쓴다. */
export function competitorLabelToDetailLabel(label: string): string | null {
  const t = label.trim();
  if (/^유료방송가(구|입가구)$/.test(t)) return "전국 유료가구";
  // 대응이 DB 실측으로 확인된 타깃만 옮긴다(개인2049·개인2039, 여자3049). 그 밖의 라벨은 단정하지 않고 비교에서 뺀다.
  if (t === "개인2049" || t === "개인2039") return `수도권 ${t.slice(2)}`;
  if (t === "여자3049") return "수도권 여3049";
  return null;
}

export interface CrossCheckResult {
  checked: number;
  matched: number;
  mismatches: { channelCode: string; start: string; programName: string; detailLabel: string; detailRating: number; competitorRating: number }[];
  issues: QualityIssue[];
}

/** 같은 방송이 타깃상세(programRows)와 경쟁채널시청률 시트의 자사 블록에 모두 있을 때 타깃별 시청률이 같은지 대조한다.
 *  다르면 타깃 열 매핑이 어긋난 신호(예: ENA PLAY 타깃상세는 D=2039, I=2049인데 고정 열로 읽는 경우)이므로 경고한다. */
export function crossCheckOwnChannelTargets(programRows: ProgramTargetRow[], inspection: DailyInspection | null, epsilon = 1e-6): CrossCheckResult {
  const result: CrossCheckResult = { checked: 0, matched: 0, mismatches: [], issues: [] };
  if (!inspection) return result;
  const detail = new Map<string, number | null>();
  for (const r of programRows) {
    if (r.isDailyAggregate || !r.startTime) continue;
    detail.set(`${r.channelCode}|${r.startTime}|${r.targetLabel}`, r.rating);
  }
  for (const own of inspection.ownBlockRows) {
    for (const { label, rating } of own.ratings) {
      const detailLabel = competitorLabelToDetailLabel(label);
      if (!detailLabel || rating === null) continue;
      const key = `${own.channelCode}|${own.start}|${detailLabel}`;
      if (!detail.has(key)) continue;
      const d = detail.get(key);
      if (d === null || d === undefined) continue;
      result.checked++;
      if (Math.abs(d - rating) <= epsilon) result.matched++;
      else result.mismatches.push({ channelCode: own.channelCode, start: own.start, programName: own.programName, detailLabel, detailRating: d, competitorRating: rating });
    }
  }
  if (result.mismatches.length > 0) {
    const s = result.mismatches[0];
    result.issues.push({
      severity: "warning",
      category: "structure",
      message: `타깃상세와 경쟁채널시청률 시트의 같은 방송 시청률이 ${result.mismatches.length}건 다릅니다(타깃 열 매핑 확인 필요) — 예: ${s.channelCode} ${s.start} ${s.programName} ${s.detailLabel} ${s.detailRating} vs ${s.competitorRating}`,
    });
  }
  return result;
}

/** 채널 KPI 타깃(랭킹 시트 라벨)이 이번 파일에 없으면 경고 — 헤더 변경으로 KPI가 통째로 빠지는 사고를 잡는다. */
export function checkKpiTargetCoverage(rankRows: RankRow[], primaryTargetByCode: Map<string, string | null>): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const present = new Set(rankRows.map((r) => `${r.channelCode}|${r.targetLabel}`));
  for (const [code, primary] of primaryTargetByCode) {
    if (!primary) continue;
    const need = resolveRankSheetTargetLabel(primary);
    if (!rankRows.some((r) => r.channelCode === code)) continue; // 채널 자체 누락은 checkChannelCoverage가 보고
    if (!present.has(`${code}|${need}`)) issues.push({ severity: "warning", category: "completeness", message: `${code}의 KPI 타깃(${need}) 행이 이 파일에 없습니다 — 시트 헤더가 바뀌었는지 확인하세요.` });
  }
  return issues;
}

// ── 재수신 차이 ────────────────────────────────────────────────

export interface RankSnapshotRow {
  channelCode: string;
  targetLabel: string;
  rank: number | null;
  rating: number | null;
}
export interface RankDiff {
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
  samples: { channelCode: string; targetLabel: string; before: { rank: number | null; rating: number | null }; after: { rank: number | null; rating: number | null } }[];
}

/** 같은 기간 수정본이 들어왔을 때 채널×타깃 단위(순위·시청률) 차이를 센다. */
export function diffRankRows(before: RankSnapshotRow[], after: RankSnapshotRow[], epsilon = 1e-9): RankDiff {
  const key = (r: RankSnapshotRow) => `${r.channelCode}|${r.targetLabel}`;
  const b = new Map(before.map((r) => [key(r), r]));
  const a = new Map(after.map((r) => [key(r), r]));
  const diff: RankDiff = { added: 0, removed: 0, changed: 0, unchanged: 0, samples: [] };
  for (const [k, ar] of a) {
    const br = b.get(k);
    if (!br) {
      diff.added++;
      continue;
    }
    const same = br.rank === ar.rank && (br.rating === ar.rating || (br.rating !== null && ar.rating !== null && Math.abs(br.rating - ar.rating) <= epsilon));
    if (same) diff.unchanged++;
    else {
      diff.changed++;
      if (diff.samples.length < 10) diff.samples.push({ channelCode: ar.channelCode, targetLabel: ar.targetLabel, before: { rank: br.rank, rating: br.rating }, after: { rank: ar.rank, rating: ar.rating } });
    }
  }
  for (const k of b.keys()) if (!a.has(k)) diff.removed++;
  return diff;
}

// ── 주간·월간 적재 행 ──────────────────────────────────────────

export interface PeriodRecord {
  period_type: NielsenPeriodType;
  date_from: string;
  date_to: string;
  channel_id: string;
  target_id: string;
  rank: number;
  rating: number | null;
  share: number | null;
  reach: number | null;
  time_spent_seconds: number | null;
  source_file: string;
  updated_at: string;
}

/** 주간·월간 랭킹 행을 nielsen_period_rank 행으로 바꾼다. 이 함수와 호출부는 ratings·programs를 건드리지 않는다
 *  (주간·월간 파일에는 프로그램 상세가 없다 — 기간 집계 입력이 일간 상세를 만들거나 지우지 않는 경계). */
export function buildPeriodRecords(
  parsed: { periodType: NielsenPeriodType; dateFrom: string; dateTo: string; rows: RankRow[] },
  fileName: string,
  channelIdByCode: Map<string, string>,
  targetIdByLabel: Map<string, string>,
  now: string
): { records: PeriodRecord[]; unknown: string[] } {
  const unknown = new Set<string>();
  const records: PeriodRecord[] = [];
  for (const r of parsed.rows) {
    const channelId = channelIdByCode.get(r.channelCode);
    const targetId = targetIdByLabel.get(r.targetLabel);
    if (!channelId || !targetId) {
      unknown.add(!channelId ? `채널:${r.channelCode}` : `타깃:${r.targetLabel}`);
      continue;
    }
    records.push({
      period_type: parsed.periodType,
      date_from: parsed.dateFrom,
      date_to: parsed.dateTo,
      channel_id: channelId,
      target_id: targetId,
      rank: r.rank,
      rating: r.rating,
      share: r.share,
      reach: r.reach,
      time_spent_seconds: r.timeSpentSeconds,
      source_file: fileName,
      updated_at: now,
    });
  }
  return { records, unknown: [...unknown] };
}

// ── 메일 재시도 정책 ──────────────────────────────────────────

export const MAIL_MAX_ATTEMPTS = 3;
export const MAIL_RETRY_MIN_INTERVAL_MIN = 30;

export type MailRetryState = "done" | "retry" | "waiting" | "dead_letter" | "in_progress";

/** mail_ingestion_log 한 행이 다시 처리 대상인지 판정한다. error만 재시도하며, 시도 횟수가 상한에 닿으면 dead-letter(자동 재시도 중단,
 *  관리자 확인 대상)이고 마지막 시도 후 최소 간격이 지나기 전에는 기다린다. processing은 선점한 실행이 아직 진행 중으로 본다. */
export function mailRetryState(row: { status: string; attemptCount?: number | null; processedAt?: string | null }, now: Date): MailRetryState {
  if (row.status === "processing") return "in_progress";
  if (row.status !== "error") return "done";
  const attempts = row.attemptCount ?? 1;
  if (attempts >= MAIL_MAX_ATTEMPTS) return "dead_letter";
  if (!row.processedAt) return "retry";
  return now.getTime() - Date.parse(row.processedAt) >= MAIL_RETRY_MIN_INTERVAL_MIN * 60000 ? "retry" : "waiting";
}
