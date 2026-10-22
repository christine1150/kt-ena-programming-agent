// 프로그램 성과 — 순수 계산 함수(DB·시계·난수 없음). 화면·LLM은 이 결과를 다시 계산하지 않는다.
// 지표 정의(docs/ena-features-plan.md §4):
//  - 작품 평균 = 선택 조건(채널·타깃·기간·본재)의 유효한 방영별 시청률 산술평균(방송시간 가중 아님)
//  - 채널 일평균 = 같은 채널·타깃·조회 기간의 닐슨 "채널 하루 시청률" 행을 날짜당 한 번씩 산술평균(공식 주간 값과 다름)
//  - 채널 일평균 대비 = 작품 평균 ÷ 채널 일평균(규모 참고 지표 — 시간대 효과를 뺀 효율이 아님)
//  - 동슬롯 대비 = 콘텐츠 적합도 엔진과 같은 "같은 칸 다른 프로그램 기대치" 대비 수축 배율(편성 효율 지표, 인과 아님)
import { CONTENT_FIT_CONFIG } from "@/lib/contentFit/config";
import type { AiringFilter, ChannelDailyBase, ChannelRow, Direction, GroupHeadline, MonthlyPoint, RatioValue, SplitStat, WorkClass, WorkClassification } from "./types";

/** 방향은 화면 표시 자릿수(배율 소수 둘째 자리)로 반올림한 값으로만 정한다 — 임의의 "유의 차이" 임계값을 만들지 않는다. */
const RATIO_DISPLAY_DIGITS = 2;
const DIFF_DISPLAY_DIGITS = 3;

function roundTo(x: number, d: number): number {
  const f = 10 ** d;
  return Math.round(x * f) / f;
}

export function directionOfRatio(ratio: number | null): Direction {
  if (ratio === null || !Number.isFinite(ratio)) return "NA";
  const r = roundTo(ratio, RATIO_DISPLAY_DIGITS);
  return r > 1 ? "HIGHER" : r < 1 ? "LOWER" : "SIMILAR";
}

function directionOfDiff(diff: number | null): Direction {
  if (diff === null || !Number.isFinite(diff)) return "NA";
  const d = roundTo(diff, DIFF_DISPLAY_DIGITS);
  return d > 0 ? "HIGHER" : d < 0 ? "LOWER" : "SIMILAR";
}

/** 배율·상대 차이·절대 차이. 기준값이 0/NULL이면 배율은 산출 불가(작은 분모를 임의 상수로 숨기지 않는다). 0인 실적과 양수 기준값은 유효한 0배다. */
export function ratioOf(value: number | null, base: number | null, naIfBaseMissing = "기준값 자료 없음"): RatioValue {
  if (value === null || !Number.isFinite(value)) {
    return { value: null, base, ratio: null, pct: null, diff: null, direction: "NA", naReason: "작품 실적 없음" };
  }
  if (base === null || !Number.isFinite(base)) {
    return { value, base: null, ratio: null, pct: null, diff: null, direction: "NA", naReason: naIfBaseMissing };
  }
  const diff = value - base;
  if (base <= 0) {
    return { value, base, ratio: null, pct: null, diff, direction: directionOfDiff(diff), naReason: "기준값이 0이라 배율을 낼 수 없음(절대 차이만 표시)" };
  }
  const ratio = value / base;
  return { value, base, ratio, pct: (ratio - 1) * 100, diff, direction: directionOfRatio(ratio), naReason: null };
}

/** 조회 기간의 일수(양 끝 포함). */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.floor((b - a) / 86_400_000) + 1;
}

export interface ChannelDayRow {
  date: string;
  rating: number | null;
  /** 적재 시각(정정·중복 시 최근 값을 쓰기 위한 정렬 키) */
  createdAt: string | null;
}

/**
 * 채널 하루 시청률 행 → 날짜당 한 값 → 산술평균. 같은 날 값이 같은 중복 행은 한 번만 센다.
 * 값이 서로 다르면(정정·중복 적재) 가장 최근 적재 값을 쓰고 충돌 일수로 보고한다. NULL은 측정 없음(유효 일수에서 뺀다).
 */
export function channelDailyMean(rows: ChannelDayRow[], from: string, to: string, targetLabel: string): ChannelDailyBase {
  const byDate = new Map<string, ChannelDayRow[]>();
  for (const r of rows) {
    if (r.date < from || r.date > to) continue;
    const list = byDate.get(r.date);
    if (list) list.push(r);
    else byDate.set(r.date, [r]);
  }
  let sum = 0;
  let n = 0;
  let conflictDays = 0;
  let first: string | null = null;
  let last: string | null = null;
  for (const date of [...byDate.keys()].sort()) {
    const vals = byDate.get(date)!.filter((r) => r.rating !== null && Number.isFinite(r.rating));
    if (vals.length === 0) continue;
    const distinct = new Set(vals.map((r) => r.rating));
    let v: number;
    if (distinct.size > 1) {
      conflictDays++;
      const latest = [...vals].sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""))[vals.length - 1];
      v = latest.rating as number;
    } else {
      v = vals[0].rating as number;
    }
    sum += v;
    n++;
    if (!first) first = date;
    last = date;
  }
  return { mean: n > 0 ? sum / n : null, validDays: n, periodDays: daysBetween(from, to), conflictDays, firstDate: first, lastDate: last, targetLabel };
}

export interface WorkAiring {
  programId: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  rating: number | null;
  firstRun: boolean | null;
  episode: number | null;
  createdAt?: string | null;
}

/** 같은 방영(프로그램·방송일·시작 시각)의 중복 행은 한 번만 센다 — ratings 행 수를 방영 수로 쓰지 않는다. 값이 다르면 최근 적재 값. */
export function dedupeAirings(rows: WorkAiring[]): WorkAiring[] {
  const map = new Map<string, WorkAiring>();
  for (const r of rows) {
    const k = `${r.programId}|${r.date}|${r.startTime ?? ""}`;
    const prev = map.get(k);
    if (!prev || (r.createdAt ?? "") > (prev.createdAt ?? "")) map.set(k, r);
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? "").localeCompare(b.startTime ?? "") || a.programId.localeCompare(b.programId));
}

/**
 * 본재 필터 — 원본 실측(2026-09-09): <본> 표시는 ENA에만 있고 <재> 표시(false)는 어느 채널에도 없다. 재방은 '표시 없음(null)'으로만 남는다.
 * 그래서 '본방' = <본> 표시가 있는 방영, '본방 외' = 표시가 없거나 <재>인 방영으로 정의한다(표시 없음을 재방으로 단정하지 않는다 — 화면 이름도 '본방 표시 없음').
 */
export function matchesAiringFilter(firstRun: boolean | null, f: AiringFilter): boolean {
  if (f === "all") return true;
  if (f === "first") return firstRun === true;
  return firstRun !== true;
}

export function splitStat(rows: WorkAiring[]): SplitStat {
  const vals = rows.flatMap((r) => (r.rating === null || !Number.isFinite(r.rating) ? [] : [r.rating]));
  return { airings: rows.length, days: new Set(rows.map((r) => r.date)).size, avg: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null };
}

/** 표본 상태 — 콘텐츠 적합도와 같은 일수 기준(3일 미만 판단 보류, 8일 미만 표본 적음). */
export function sampleStateOf(days: number): "OK" | "SMALL" | "NONE" {
  if (days < CONTENT_FIT_CONFIG.minDays) return "NONE";
  if (days < CONTENT_FIT_CONFIG.fullDays) return "SMALL";
  return "OK";
}

const ORIGINAL_DRAMA = "오리지널드라마";
const ORIGINAL_VARIETY = "오리지널예능";

/**
 * 작품 분류 — 승인 메타데이터(featured_content.category, 관리자 업로드 "KT ENA 오리지널" 시트)만 쓴다.
 * 제목·높은 시청률·<본> 표시·ENA 방영 사실로 추론하지 않는다. 기록이 없으면 미확인(비오리지널로 확정하지 않음).
 * 같은 작품의 채널별 분류가 서로 다르면 충돌로 표시한다(독점예능·브랜디드·구매예능은 오리지널로 바꾸지 않는다).
 */
export function classifyWork(categories: string[]): WorkClassification {
  const set = [...new Set(categories.map((c) => c.replace(/\s+/g, "")).filter(Boolean))].sort();
  const source = "주요 콘텐츠 목록(관리자 업로드 'KT ENA 오리지널' 시트)";
  if (set.length === 0) return { cls: "UNCONFIRMED", categories: [], source, note: "주요 콘텐츠 목록에 이 작품의 분류가 없습니다. 오리지널 여부는 확인되지 않았습니다." };
  if (set.length > 1) return { cls: "CONFLICT", categories: set, source, note: `채널별 분류가 서로 다릅니다(${set.join(", ")}). 관리 화면에서 확인이 필요합니다.` };
  const c = set[0];
  if (c === ORIGINAL_DRAMA) return { cls: "ORIGINAL_DRAMA", categories: set, source, note: "" };
  if (c === ORIGINAL_VARIETY) return { cls: "ORIGINAL_VARIETY", categories: set, source, note: "" };
  return { cls: "OTHER_FEATURED", categories: set, source, note: `주요 콘텐츠 분류: ${c}(자사 오리지널 드라마·예능 분류가 아님)` };
}

export const WORK_CLASS_LABEL: Record<WorkClass, string> = {
  ORIGINAL_DRAMA: "오리지널 드라마",
  ORIGINAL_VARIETY: "오리지널 예능",
  OTHER_FEATURED: "주요 콘텐츠(오리지널 외)",
  UNCONFIRMED: "분류 미확인",
  CONFLICT: "분류 확인 필요",
};

function monthEnd(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

function nextMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/**
 * 월간 추이 — 조회 기간의 각 달에서 (작품 방영별 평균, 같은 구간의 채널 일평균)을 짝지어 낸다.
 * 분자·분모 모두 '달 ∩ 조회 기간' 같은 구간을 쓴다(9월 월간 값과 9/24~ 작품 평균을 섞지 않음). 방영이 없는 달은 작품 평균 NULL.
 * 채널 일평균의 정의는 표의 채널 평균과 같다(사내 월간 추이 '채널평균'과 ENA 2026년 1~8월 소수 셋째 자리까지 일치 확인, 2026-10-22).
 */
export function monthlySeries(airings: WorkAiring[], dayRows: ChannelDayRow[], from: string, to: string, targetLabel: string): MonthlyPoint[] {
  const out: MonthlyPoint[] = [];
  if (!from || !to || from > to) return out;
  for (let ym = from.slice(0, 7); ym <= to.slice(0, 7); ym = nextMonth(ym)) {
    const mFrom = `${ym}-01` < from ? from : `${ym}-01`;
    const mTo = monthEnd(ym) > to ? to : monthEnd(ym);
    const st = splitStat(airings.filter((a) => a.date >= mFrom && a.date <= mTo));
    const cd = channelDailyMean(dayRows, mFrom, mTo, targetLabel);
    out.push({
      month: ym,
      from: mFrom,
      to: mTo,
      partial: mFrom !== `${ym}-01` || mTo !== monthEnd(ym),
      airings: st.airings,
      days: st.days,
      programAvg: st.avg,
      channelAvg: cd.mean,
      channelValidDays: cd.validDays,
      periodDays: cd.periodDays,
      vsChannel: st.airings === 0 ? { ...ratioOf(null, cd.mean), naReason: "이 달 방영 없음" } : ratioOf(st.avg, cd.mean, "이 달 채널 하루 시청률 자료 없음"),
    });
  }
  return out;
}

const HEAD_DIR: Record<Direction, string> = { HIGHER: "상회", LOWER: "하회", SIMILAR: "비슷", NA: "산출 불가" };

/**
 * KPI 그룹별 핵심 한 줄 — 서버가 확정한 채널 평균 대비 방향과 표본 상태만으로 만드는 템플릿(LLM 없음).
 * 관측 상태의 서술이지 편성 권고가 아니다. 표본이 8일 미만인 채널은 이름을 밝혀 '방향성 참고'로 붙인다.
 */
export function headlineFor(kpiGroup: "2049" | "HH", targetLabel: string, rows: ChannelRow[]): GroupHeadline {
  const obs = rows.filter((r) => r.status === "OBSERVED" && r.airings > 0);
  if (obs.length === 0) return { kpiGroup, targetLabel, text: `${targetLabel}: 이 조건의 방영 관측 없음.` };
  const order: Direction[] = ["HIGHER", "LOWER", "SIMILAR", "NA"];
  const byDir = order.map((d) => ({ d, names: obs.filter((r) => r.vsChannel.direction === d).map((r) => r.channelName) })).filter((x) => x.names.length);
  let body: string;
  if (byDir.length === 1 && obs.length > 1 && byDir[0].d !== "NA") body = `${obs.length}개 채널 모두 채널 평균 ${HEAD_DIR[byDir[0].d]}`;
  else if (byDir.length === 1 && byDir[0].d !== "NA") body = `${byDir[0].names[0]} 채널 평균 ${HEAD_DIR[byDir[0].d]}`;
  else body = byDir.map((x) => `${x.names.join("·")} ${HEAD_DIR[x.d]}`).join(", ");
  const small = obs.filter((r) => r.sampleState === "SMALL").map((r) => r.channelName);
  const none = obs.filter((r) => r.sampleState === "NONE").map((r) => r.channelName);
  const notes = [small.length ? `방송일 8일 미만 ${small.join("·")} — 방향성 참고` : "", none.length ? `방송일 3일 미만 ${none.join("·")} — 판단 유보` : ""].filter(Boolean);
  const tail = notes.length ? ` (${notes.join("; ")})` : "";
  return { kpiGroup, targetLabel, text: `${targetLabel}: ${body}${tail}.` };
}

const DIR_KO: Record<Direction, string> ={ HIGHER: "높음", SIMILAR: "비슷", LOWER: "낮음", NA: "산출 불가" };

/**
 * 두 기준을 함께 읽는 한 줄 설명 — 관측 방향의 서술이지 편성 권고가 아니다(강화·교체 권고로 바꾸지 않는다).
 * 표본이 적거나 값이 없으면 우열을 정하지 않고 상태를 말한다.
 */
export function describeRow(vsChannel: Direction, vsSlot: Direction, sample: "OK" | "SMALL" | "NONE"): string {
  if (sample === "NONE") return "방영 3일 미만 — 판단 보류(수치만 참고).";
  const suffix = sample === "SMALL" ? " 표본이 적어(8일 미만) 판단은 보류합니다." : "";
  if (vsChannel === "NA" || vsSlot === "NA") {
    const parts = [vsChannel === "NA" ? "채널 일평균 대비는 산출 불가" : `채널 일평균보다 ${DIR_KO[vsChannel]}`, vsSlot === "NA" ? "동슬롯 대비는 산출 불가" : `동슬롯 기준보다 ${DIR_KO[vsSlot]}`];
    return `${parts.join(", ")}.${suffix}`;
  }
  if (vsChannel === "SIMILAR" || vsSlot === "SIMILAR") {
    return `채널 일평균 대비 ${DIR_KO[vsChannel]}, 동슬롯 대비 ${DIR_KO[vsSlot]}.${suffix}`;
  }
  let text: string;
  if (vsChannel === "HIGHER" && vsSlot === "HIGHER") text = "채널 일평균과 배정된 슬롯 기준을 모두 웃돎.";
  else if (vsChannel === "HIGHER" && vsSlot === "LOWER") text = "채널 일평균보다 높지만, 배정된 슬롯의 기준에는 못 미침.";
  else if (vsChannel === "LOWER" && vsSlot === "HIGHER") text = "채널 일평균보다 낮지만, 해당 슬롯에서는 기준을 웃돎.";
  else text = "채널 일평균과 슬롯 기준을 모두 밑돎. 교체 여부는 현재 판정·근거를 따로 확인.";
  return `${text}${suffix}`;
}
