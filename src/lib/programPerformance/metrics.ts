// 프로그램 성과 — 순수 계산 함수(DB·시계·난수 없음). 화면·LLM은 이 결과를 다시 계산하지 않는다.
// 지표 정의(docs/ena-features-plan.md §4):
//  - 작품 평균 = 선택 조건(채널·타깃·기간·본재)의 유효한 방영별 시청률 산술평균(방송시간 가중 아님)
//  - 채널 일평균 = 같은 채널·타깃·조회 기간의 닐슨 "채널 하루 시청률" 행을 날짜당 한 번씩 산술평균(공식 주간 값과 다름)
//  - 채널 일평균 대비 = 작품 평균 ÷ 채널 일평균(규모 참고 지표 — 시간대 효과를 뺀 효율이 아님)
//  - 동슬롯 대비 = 콘텐츠 적합도 엔진과 같은 "같은 칸 다른 프로그램 기대치" 대비 수축 배율(편성 효율 지표, 인과 아님)
import { CONTENT_FIT_CONFIG } from "@/lib/contentFit/config";
import { formatRatingValue, formatSigned } from "@/lib/ui/metricFormat";
import type { AiringFilter, AiringRef, ChannelDailyBase, ChannelLine, ChannelRow, Direction, EpisodePoint, MonthlyPoint, RatioValue, RowAnalysis, SlotLine, SplitStat, WorkClass, WorkClassification } from "./types";

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
  /** 닐슨 방영별 점유율(%) — 시청시간 비율(time_spent_share)과 다른 열 */
  share?: number | null;
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

/**
 * 채널별 첫 줄 — "{기간} 기간 동안 {채널}({타깃})에서 평균 시청률 {값}({n}회)로 채널 평균 대비 {±%}. {판단}" (사용자 지정 형식, 2026-10-22).
 * 서버가 확정한 작품 평균·채널 평균 대비·표본 상태로만 만든다(LLM 없음). 판단은 채널 평균보다 높은지·낮은지의 서술이며,
 * 방송일 3일 미만은 판단하지 않고 8일 미만은 '자료 적음'을 붙인다(콘텐츠 적합도와 같은 표본 기준).
 */
export function channelLine(r: ChannelRow, from: string, to: string): ChannelLine {
  const head = `${from} ~ ${to} 기간 동안 ${r.channelName}(${r.targetLabel})에서 평균 시청률 ${formatRatingValue(r.programAvg, r.channelCode)}(${r.airings}회)로`;
  const v = r.vsChannel;
  let text: string;
  if (v.ratio === null || v.pct === null) text = `${head} 채널 평균과 비교할 수 없습니다(${v.naReason ?? "기준값 없음"}).`;
  else {
    const vs = `${head} 채널 평균 대비 ${formatSigned(v.pct, 0)}%.`;
    if (r.sampleState === "NONE") text = `${vs} 방송일 ${r.days}일뿐이라 판단은 보류합니다.`;
    else {
      const judge = v.direction === "HIGHER" ? "채널 평균보다 높아 채널 시청률에 도움이 되고 있습니다." : v.direction === "LOWER" ? "채널 평균보다 낮아 채널 시청률에 도움이 되지 못하고 있습니다." : "채널 평균과 비슷한 수준입니다.";
      text = `${vs} ${judge}${r.sampleState === "SMALL" ? ` (자료 적음 · ${r.days}일)` : ""}`;
    }
  }
  return { channelCode: r.channelCode, direction: v.direction, sampleState: r.sampleState, text };
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

// ───────────────────────── 선택 채널 분석(2×2, 2026-10-22) ─────────────────────────
// 화면은 이 결과를 표시만 한다. 새 점수·가중치·판정 알고리즘이 아니라 이미 있는 지표(방영별 시청률·채널 평균 대비·같은 시간대 대비)를
// 짧은 고정 문구로 잇는 것이다. 같은 유형 평균·순위는 앱 자료로 검증되지 않아 쓰지 않는다(F1_SIMPLIFY.md §3).

export const DOW_KO = ["일", "월", "화", "수", "목", "금", "토"];
export const slotLabel = (dow: number, hb: number) => `${DOW_KO[dow]} ${hb}시대`;

function meanOf(vals: number[]): number | null {
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

/** 방영별 점유율 산술평균(값이 있는 방영만). 기간 공식 점유율이 아니다. */
export function shareStat(rows: WorkAiring[]): { avg: number | null; airings: number } {
  const vals = rows.flatMap((r) => (r.share === null || r.share === undefined || !Number.isFinite(r.share) ? [] : [r.share]));
  return { avg: meanOf(vals), airings: vals.length };
}

/** 회차별 추이 — <본> 표시가 있고 회차 번호가 있는 방영만. 재방·본방 여부 미확인 방영은 넣지 않는다(같은 회차 재방을 다음 회차처럼 잇지 않음). */
export function episodeSeries(rows: WorkAiring[]): EpisodePoint[] {
  const by = new Map<number, WorkAiring[]>();
  for (const r of rows) {
    if (r.firstRun !== true || r.episode === null) continue;
    by.set(r.episode, [...(by.get(r.episode) ?? []), r]);
  }
  return [...by.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([episode, list]) => ({ episode, date: list[0].date, airings: list.length, avg: meanOf(list.flatMap((r) => (r.rating === null ? [] : [r.rating]))) }));
}

const pctText = (v: number | null, code: string) => formatRatingValue(v, code, { unit: true });
const DIR_TREND: Record<Direction, string> = { HIGHER: "상승", LOWER: "하락", SIMILAR: "비슷", NA: "" };

/**
 * 흐름 한 줄. 정의(테스트로 고정):
 *  - 본방 회차 4개 이상: 회차 번호 순 앞 절반 평균 vs 뒤 절반 평균(홀수면 가운데 회차 제외)
 *  - 본방 회차 2~3개: 첫 회차 vs 마지막 회차
 *  - 그 외: 방영이 있는 첫 달과 마지막 달의 채널 평균 대비(같은 달 채널 평균 기준이라 달마다 채널 수준이 달라도 비교 가능)
 *  - 근거가 하나뿐이면 '추이 자료 부족'(증감 0을 안정으로 읽지 않음)
 * 방향은 표시 자릿수 반올림 배율로만 정한다(임의 임계값 없음).
 */
export function trendTextOf(eps: EpisodePoint[], monthly: MonthlyPoint[], code: string): string {
  const ev = eps.filter((e) => e.avg !== null);
  if (ev.length >= 4) {
    const n = Math.floor(ev.length / 2);
    const a = meanOf(ev.slice(0, n).map((e) => e.avg as number));
    const b = meanOf(ev.slice(ev.length - n).map((e) => e.avg as number));
    const dir = a !== null && a > 0 && b !== null ? directionOfRatio(b / a) : "NA";
    const head = dir === "NA" ? "전반·후반 회차 비교" : dir === "SIMILAR" ? "전반·후반 회차 평균 비슷" : `후반 회차 평균 ${DIR_TREND[dir]}`;
    return `${head} · 전반 ${pctText(a, code)} → 후반 ${pctText(b, code)} (본방 ${n}회씩)`;
  }
  if (ev.length >= 2) {
    const f = ev[0];
    const l = ev[ev.length - 1];
    const dir = (f.avg as number) > 0 ? directionOfRatio((l.avg as number) / (f.avg as number)) : "NA";
    return `${dir === "NA" || dir === "SIMILAR" ? "첫 회차와 최근 회차 비슷" : `최근 회차 ${DIR_TREND[dir]}`} · ${f.episode}회 ${pctText(f.avg, code)} → ${l.episode}회 ${pctText(l.avg, code)}`;
  }
  const ms = monthly.filter((m) => m.airings > 0 && m.vsChannel.pct !== null);
  if (ms.length >= 2) {
    const f = ms[0];
    const l = ms[ms.length - 1];
    const fp = Math.round(f.vsChannel.pct as number);
    const lp = Math.round(l.vsChannel.pct as number);
    const head = lp > fp ? "채널 평균 대비 높아짐" : lp < fp ? "채널 평균 대비 낮아짐" : "채널 평균 대비 비슷";
    const mt = (m: MonthlyPoint) => `${Number(m.month.slice(5))}월`;
    return `${head} · ${mt(f)} ${formatSigned(fp, 0)}% → ${mt(l)} ${formatSigned(lp, 0)}%`;
  }
  return "추이 자료 부족 — 비교할 회차·달이 하나뿐입니다.";
}

/** 최고·최저·최근 방영(선택 기간·방송 구분 안). 시청률 값이 있는 방영이 2건 미만이면 null. 동률은 먼저 방영한 것. */
export function extremesOf(rows: WorkAiring[]): RowAnalysis["extremes"] {
  const vals = rows.filter((r) => r.rating !== null && Number.isFinite(r.rating));
  if (vals.length < 2) return null;
  const ref = (r: WorkAiring): AiringRef => ({ date: r.date, startTime: r.startTime, episode: r.episode, firstRun: r.firstRun, rating: r.rating as number });
  let best = vals[0];
  let worst = vals[0];
  for (const r of vals) {
    if ((r.rating as number) > (best.rating as number)) best = r;
    if ((r.rating as number) < (worst.rating as number)) worst = r;
  }
  return { best: ref(best), worst: ref(worst), recent: ref(vals[vals.length - 1]) };
}

export function extremesTextOf(x: RowAnalysis["extremes"]): string {
  if (!x) return "방영이 1건뿐이라 최고·최저를 나누지 않습니다.";
  const same = (a: AiringRef, b: AiringRef) => a.date === b.date && a.startTime === b.startTime;
  const label = (a: AiringRef) => (a.episode !== null ? `${a.episode}회` : `${Number(a.date.slice(5, 7))}/${Number(a.date.slice(8))} 방영`);
  if (same(x.recent, x.best)) return "최근 방영이 선택 기간 최고";
  if (same(x.recent, x.worst)) return "최근 방영이 선택 기간 최저";
  return `최고는 ${label(x.best)}, 최근 방영은 그보다 낮음`;
}

export interface CompAiring {
  date: string;
  startTime: string | null;
  rating: number;
}

function hourBlockOfTime(t: string | null): number | null {
  if (!t || t.length < 2) return null;
  const h = Number(t.slice(0, 2));
  if (!Number.isFinite(h)) return null;
  return h < 2 ? h + 24 : h;
}
const dowOfDate = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();

/**
 * 실제 방영한 요일·시간대별 비교 — 작품 방영별 평균 vs 같은 채널·타깃·비교 창에서 같은 요일·시(시작 시각 기준)의 다른 프로그램 방영 단순 평균.
 * 표의 '같은 시간대 대비'(콘텐츠 적합도 수축 배율)와 다른 지표다. 비교 방송이 minOther건 미만이면 산출하지 않는다(콘텐츠 적합도와 같은 최소 건수).
 * 방영하지 않은 시간대는 만들지 않는다(미방영 시간대 예측은 기능 2).
 */
export function slotLinesOf(work: WorkAiring[], others: CompAiring[], minOther: number): SlotLine[] {
  const comp = new Map<string, number[]>();
  const compHour = new Map<number, number[]>();
  for (const o of others) {
    const hb = hourBlockOfTime(o.startTime);
    if (hb === null || !Number.isFinite(o.rating)) continue;
    const k = `${dowOfDate(o.date)}|${hb}`;
    comp.set(k, [...(comp.get(k) ?? []), o.rating]);
    compHour.set(hb, [...(compHour.get(hb) ?? []), o.rating]);
  }
  const cells = new Map<string, WorkAiring[]>();
  for (const r of work) {
    const hb = hourBlockOfTime(r.startTime);
    if (hb === null) continue;
    const k = `${dowOfDate(r.date)}|${hb}`;
    cells.set(k, [...(cells.get(k) ?? []), r]);
  }
  const out: SlotLine[] = [];
  for (const [k, list] of cells) {
    const [dow, hb] = k.split("|").map(Number);
    const st = splitStat(list);
    // 같은 요일·시 비교 방송이 부족하면 같은 시(모든 요일)로 넓힌다 — 콘텐츠 적합도 기대치의 단계적 확장과 같은 취지, 어느 기준인지 함께 낸다
    const exact = comp.get(k) ?? [];
    const wide = compHour.get(hb) ?? [];
    const basis: SlotLine["basis"] = exact.length >= minOther ? "DOW_HOUR" : wide.length >= minOther ? "HOUR" : "NONE";
    const c = basis === "DOW_HOUR" ? exact : basis === "HOUR" ? wide : [];
    const compAvg = basis === "NONE" ? null : meanOf(c);
    const vs = basis === "NONE" ? { ...ratioOf(st.avg, null), naReason: `같은 시 비교 방송 ${wide.length}건(${minOther}건 미만)` } : ratioOf(st.avg, compAvg);
    out.push({ dow, hourBlock: hb, airings: st.airings, days: st.days, avg: st.avg, compAvg, compAirings: c.length, basis, vs, sampleState: sampleStateOf(st.days) });
  }
  // 판단 가능한 구간(방송일 3일 이상) 먼저, 그다음 방영 많은 순
  return out.sort((a, b) => Number(b.sampleState !== "NONE") - Number(a.sampleState !== "NONE") || b.airings - a.airings || a.dow - b.dow || a.hourBlock - b.hourBlock);
}

/** 판단에 쓸 구간 — 비교 가능하고 방송일 3일 이상 */
const judgeable = (s: SlotLine) => s.vs.pct !== null && s.sampleState !== "NONE";
const SLOT_WORD: Record<Direction, string> = { HIGHER: "높음", LOWER: "낮음", SIMILAR: "비슷", NA: "" };

export function slotTextOf(slots: SlotLine[]): string {
  const ok = slots.filter((s) => s.vs.pct !== null);
  if (ok.length === 0) return "같은 시간대 비교 근거가 부족합니다.";
  if (ok.length === 1) return `${slotLabel(ok[0].dow, ok[0].hourBlock)} 같은 시간대 평균보다 ${SLOT_WORD[ok[0].vs.direction]}${ok[0].sampleState !== "OK" ? ` (자료 적음 · ${ok[0].days}일)` : ""}`;
  const j = ok.filter(judgeable);
  if (j.length === 0) return "구간마다 방송일이 3일 미만이라 시간대 우열을 판단하기 어렵습니다.";
  const hi = j.filter((s) => s.vs.direction === "HIGHER");
  const lo = j.filter((s) => s.vs.direction === "LOWER");
  if (hi.length && lo.length) {
    // 극단값이 아니라 방영이 가장 많은 구간을 대표로 고른다(작은 표본의 최고 수치만 골라 강조하지 않음)
    const rep = (xs: SlotLine[]) => [...xs].sort((a, b) => b.days - a.days || b.airings - a.airings || a.dow - b.dow || a.hourBlock - b.hourBlock)[0];
    const top = rep(hi);
    const bot = rep(lo);
    const small = top.sampleState !== "OK" || bot.sampleState !== "OK" ? " 구간별 방송일이 8일 미만이라 참고만 하세요." : "";
    return `좋은 시간대(${slotLabel(top.dow, top.hourBlock)} ${formatSigned(top.vs.pct, 0)}%)와 낮은 시간대(${slotLabel(bot.dow, bot.hourBlock)} ${formatSigned(bot.vs.pct, 0)}%)가 나뉩니다.${small}`;
  }
  if (hi.length === j.length) return `방송일 3일 이상인 ${j.length}개 시간대 모두 같은 시간대 평균보다 높음`;
  if (lo.length === j.length) return `방송일 3일 이상인 ${j.length}개 시간대 모두 같은 시간대 평균보다 낮음`;
  return "시간대별로 같은 시간대 평균과 비슷하거나 엇갈립니다.";
}

/**
 * 종합 평가 — 결론 한 줄 + 근거 최대 두 개. 채널 평균 대비(vsChannel)와 같은 시간대 대비(slot, 수축 배율)의 방향만 잇는다.
 * 태그·권고(강화·교체)는 붙이지 않는다. 방송일 3일 미만이면 판단하지 않는다.
 */
export function verdictOf(input: { vsChannel: Direction; vsSlot: Direction; sampleState: "OK" | "SMALL" | "NONE"; days: number; slots: SlotLine[]; nonFirst: { vs: RatioValue; days: number } | null }): { verdict: string; reasons: string[] } {
  if (input.sampleState === "NONE") return { verdict: "현재 자료로는 편성 적합성을 판단하기 어렵습니다.", reasons: [`방송일 ${input.days}일(3일 미만)`] };
  const c = input.vsChannel;
  const s = input.vsSlot;
  let verdict: string;
  if (c === "NA") verdict = "채널 평균과 비교할 수 없어 편성 적합성을 판단하기 어렵습니다.";
  else if (s === "NA") verdict = `채널 평균보다 ${c === "HIGHER" ? "높지만" : c === "LOWER" ? "낮고" : "비슷하지만"}, 같은 시간대 비교 근거가 부족합니다.`;
  else if (c === "HIGHER" && s === "HIGHER") verdict = "채널 평균과 같은 시간대 기준을 모두 웃돌았습니다.";
  else if (c === "HIGHER" && s === "LOWER") verdict = "채널 평균은 웃돌지만, 같은 시간대의 비교 프로그램보다 낮습니다.";
  else if (c === "LOWER" && s === "HIGHER") verdict = "채널 평균보다 낮지만, 같은 시간대 기준은 웃돌았습니다.";
  else if (c === "LOWER" && s === "LOWER") verdict = "채널 평균과 같은 시간대 기준을 모두 밑돌았습니다.";
  else verdict = `채널 평균과 ${c === "SIMILAR" ? "비슷하고" : c === "HIGHER" ? "비교해 높고" : "비교해 낮고"}, 같은 시간대 기준과는 ${s === "SIMILAR" ? "비슷합니다" : s === "HIGHER" ? "비교해 높습니다" : "비교해 낮습니다"}.`;
  const reasons: string[] = [];
  const j = input.slots.filter(judgeable);
  if (j.some((x) => x.vs.direction === "HIGHER") && j.some((x) => x.vs.direction === "LOWER")) reasons.push("시간대에 따라 성과가 다릅니다.");
  const nf = input.nonFirst;
  if (nf && c === "HIGHER" && nf.days >= CONTENT_FIT_CONFIG.minDays && nf.vs.direction === "LOWER") reasons.push(`전체 평균과 달리, 본방 외 방영은 채널 평균보다 낮습니다(${formatSigned(nf.vs.pct, 0)}%).`);
  if (input.sampleState === "SMALL" && reasons.length < 2) reasons.push(`자료 적음 · ${input.days}일`);
  return { verdict, reasons: reasons.slice(0, 2) };
}
