// 주간 편성 비교(단계 10) — 순수 함수. 화면은 여기서 만든 라벨·모드·색 값만 쓴다.
//  · 주 표기: "지난주"는 실제로 지난주일 때만 쓴다. 그 외에는 실제 기간("09-14 ~ 09-20 주")으로 쓴다(사용자 결정 2026-10-06).
//  · 비교 모드: 같은 채널 주간 / 같은 주 채널 비교 / 계획 vs 실적 / 모두 다름 — 좌우가 다른 점(채널·타깃·기간·출처)을 항상 알려 준다.
//  · 색: 기존(채널 기준)은 그대로 두고, 공통 절대·0 중심 차이는 선택 모드로 추가한다. 같은 색이 같은 시청률이라는 오해를 막는 안내를 함께 낸다.
import { PRIME, PRIME_LABEL } from "@/lib/audienceReport/primeTime";
import { hexToRgb, intensityColor, mixRgb, rgbToHex } from "@/lib/scheduleGridLayout";
import { addDays, daysBetween } from "./dates";

// ───────────── 주 표기 ─────────────

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
/** YYYY-MM-DD 형식이고 실제 존재하는 날짜인가(옛 저장본의 빈 값·깨진 값이 화면 전체를 죽이지 않게 막는다). */
export function validIso(iso: string | null | undefined): iso is string {
  if (!iso || !ISO_RE.test(iso)) return false;
  const t = Date.parse(`${iso}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === iso;
}

/** 주어진 날짜가 속한 주의 월요일. */
export function mondayOfIso(iso: string): string {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0=일
  return addDays(iso, -((dow + 6) % 7));
}

export type WeekRelation = "this" | "last" | "next" | "other";

/** 월요일 기준 주 간격(오늘이 속한 주 = 0, 지난주 = −1). 월요일이 아닌 값은 그 날이 속한 주로 본다. */
export function weekOffset(weekStart: string, today: string): number {
  return Math.round(daysBetween(mondayOfIso(today), mondayOfIso(weekStart)) / 7);
}

export function weekRelation(weekStart: string, today: string): WeekRelation {
  if (!validIso(weekStart) || !validIso(today)) return "other";
  const o = weekOffset(weekStart, today);
  return o === 0 ? "this" : o === -1 ? "last" : o === 1 ? "next" : "other";
}

/** "09-14 ~ 09-20" — 오늘과 해(年)가 다르면 연도를 붙인다. */
export function periodText(weekStart: string, today: string, weekEnd?: string): string {
  if (!validIso(weekStart) || !validIso(today)) return weekStart || "기간 미확인";
  const end = weekEnd && validIso(weekEnd) ? weekEnd : addDays(weekStart, 6);
  const sameYear = weekStart.slice(0, 4) === today.slice(0, 4) && end.slice(0, 4) === today.slice(0, 4);
  return sameYear ? `${weekStart.slice(5)} ~ ${end.slice(5)}` : `${weekStart} ~ ${end}`;
}

/** 지난주·이번 주·다음 주는 상대 표현 + 기간, 그 외는 기간만("09-14 ~ 09-20 주"). */
export function weekLabel(weekStart: string, today: string, weekEnd?: string): string {
  const p = periodText(weekStart, today, weekEnd);
  switch (weekRelation(weekStart, today)) {
    case "last":
      return `지난주(${p})`;
    case "this":
      return `이번 주(${p})`;
    case "next":
      return `다음 주(${p})`;
    default:
      return `${p} 주`;
  }
}

/** 문장 속 짧은 말("지난주 대비"의 "지난주" 자리) — 실제 지난주일 때만 "지난주", 아니면 기간. */
export function weekWord(weekStart: string | null | undefined, today: string): string {
  if (!weekStart || !validIso(weekStart)) return "기준 주";
  const rel = weekRelation(weekStart, today);
  if (rel === "last") return "지난주";
  if (rel === "this") return "이번 주";
  if (rel === "next") return "다음 주";
  return `${periodText(weekStart, today)} 주`;
}

// ───────────── 좌우 비교 모드 ─────────────

export type GridSource = "upload" | "db" | "db+upload";

export interface SideMeta {
  channelCode: string;
  channelName: string;
  /** 월요일 */
  week: string;
  /** 시청률·순위의 타깃(알 수 없으면 null) */
  targetLabel: string | null;
  source: GridSource | null;
}

export type CompareMode = "identical" | "same_week_variant" | "same_channel_weeks" | "same_week_channels" | "plan_vs_actual" | "mixed";

export interface SideDiffFlags {
  channel: boolean;
  period: boolean;
  target: boolean;
  source: boolean;
}

export interface CompareReading {
  mode: CompareMode;
  title: string;
  /** 모드 설명 한 줄 */
  detail: string;
  /** 직접 비교에 주의가 필요한 이유(없으면 빈 배열) */
  cautions: string[];
  differs: SideDiffFlags;
  /** 다른 항목 이름(칩으로 보여 줄 용도) */
  differsList: string[];
}

export const SOURCE_LABEL: Record<GridSource, string> = {
  upload: "업로드 원본(계획 문서)",
  db: "DB 재구성(실제 방송 기록)",
  "db+upload": "DB 재구성 + 업로드 회차·부제",
};

const isPlanLike = (s: GridSource | null) => s === "upload";
const isActualLike = (s: GridSource | null) => s === "db" || s === "db+upload";

export function compareSides(l: SideMeta, r: SideMeta): CompareReading {
  const sameChannel = l.channelCode === r.channelCode;
  const samePeriod = l.week === r.week;
  const sameTarget = l.targetLabel === r.targetLabel;
  const sameSource = l.source === r.source;
  const differs: SideDiffFlags = { channel: !sameChannel, period: !samePeriod, target: !sameTarget, source: !sameSource };
  const differsList = [differs.channel && "채널", differs.period && "기간", differs.target && "타깃", differs.source && "자료 출처"].filter(Boolean) as string[];

  let mode: CompareMode;
  let title: string;
  let detail: string;
  if (sameChannel && samePeriod) {
    if ((isPlanLike(l.source) && isActualLike(r.source)) || (isActualLike(l.source) && isPlanLike(r.source))) {
      mode = "plan_vs_actual";
      title = "계획(업로드 편성표) vs 실적(DB 재구성)";
      detail = "같은 채널·같은 주의 편성 문서와 실제 방송 기록을 나란히 봅니다. 시청률·순위는 실제 방송 기준이며 계획안에는 실적 순위가 없습니다.";
    } else if (differs.source) {
      mode = "same_week_variant";
      title = "같은 채널·같은 주를 다른 구성으로 보고 있습니다";
      detail = "시청률 값은 같고 회차·부제 같은 표기 구성만 다를 수 있습니다. 다른 주나 채널과 비교하려면 한쪽을 바꾸세요.";
    } else {
      mode = "identical";
      title = "같은 편성표를 두 번 보고 있습니다";
      detail = "좌우의 채널·기간·자료 출처가 같습니다. 비교하려면 한쪽의 채널이나 주를 바꾸세요.";
    }
  } else if (sameChannel) {
    mode = "same_channel_weeks";
    title = "같은 채널 주간 비교";
    detail = "한 채널의 서로 다른 두 주를 비교합니다.";
  } else if (samePeriod) {
    mode = "same_week_channels";
    title = "같은 주 채널 비교(동시간대 경쟁)";
    detail = "같은 주에 방송한 서로 다른 두 채널을 비교합니다.";
  } else {
    mode = "mixed";
    title = "채널·기간이 모두 다릅니다";
    detail = "채널과 주가 모두 달라 차이의 원인을 하나로 말할 수 없습니다. 한쪽을 맞춰 보는 것을 권합니다.";
  }

  const cautions: string[] = [];
  if (differs.target) {
    cautions.push(`좌우의 시청률 타깃이 다릅니다(${l.targetLabel ?? "미확인"} ≠ ${r.targetLabel ?? "미확인"}) — 시청률 값과 순위를 직접 비교할 수 없습니다.`);
  }
  if (l.targetLabel === null && r.targetLabel === null) {
    cautions.push("양쪽 모두 시청률 타깃을 확인하지 못했습니다 — 같은 타깃인지 알 수 없습니다.");
  }
  if (differs.source && mode !== "plan_vs_actual") {
    cautions.push("자료 출처가 다릅니다(DB 재구성과 업로드 원본의 구성이 다를 수 있습니다).");
  }
  if (differs.channel && differs.period) cautions.push("채널과 주가 함께 달라 차이를 한 가지 원인으로 읽으면 안 됩니다.");
  return { mode, title, detail, cautions, differs, differsList };
}

// ───────────── 같은 시간대 차이 ─────────────

export interface GridCell {
  /** 1=월 … 7=일 */
  dow: number;
  /** 방송일 기준 확장 분(02:00 = 120, 다음날 01:00 = 1500) */
  startMin: number;
  endMin: number;
  rating: number | null;
}

/** 다른 편 칸들이 이 칸의 시간을 덮는 비율(시청률이 있는 칸만)과 겹친 분 가중 평균. 덮는 비율이 모자라면 평균을 내지 않는다(추정 금지). */
export function otherSideAverage(cell: Pick<GridCell, "dow" | "startMin" | "endMin">, others: GridCell[], minCoverage = 0.5): { avg: number | null; coverage: number } {
  const len = cell.endMin - cell.startMin;
  if (len <= 0) return { avg: null, coverage: 0 };
  let covered = 0;
  let weighted = 0;
  for (const o of others) {
    if (o.dow !== cell.dow || o.rating === null) continue;
    const overlap = Math.min(cell.endMin, o.endMin) - Math.max(cell.startMin, o.startMin);
    if (overlap <= 0) continue;
    covered += overlap;
    weighted += overlap * o.rating;
  }
  const coverage = Math.min(1, covered / len);
  return { avg: covered > 0 && coverage >= minCoverage ? weighted / covered : null, coverage };
}

/** 이 칸 시청률 − 반대편 같은 요일·시간대의 평균. 어느 한쪽이 없으면 null. */
export function cellDiff(cell: GridCell, others: GridCell[]): { diff: number | null; other: number | null; coverage: number } {
  const { avg, coverage } = otherSideAverage(cell, others);
  if (cell.rating === null || avg === null) return { diff: null, other: avg, coverage };
  return { diff: cell.rating - avg, other: avg, coverage };
}

/** 두 편 전체의 차이 절댓값 최댓값 — 0 중심 색 척도의 한계(없으면 null). */
export function maxAbsDiff(a: GridCell[], b: GridCell[]): number | null {
  let m: number | null = null;
  for (const [cells, others] of [[a, b], [b, a]] as const) {
    for (const c of cells) {
      const { diff } = cellDiff(c, others);
      if (diff !== null) m = Math.max(m ?? 0, Math.abs(diff));
    }
  }
  return m;
}

// ───────────── 색 ─────────────

export type ColorMode = "channel" | "absolute" | "diff";
export const COLOR_MODE_LABEL: Record<ColorMode, string> = { channel: "채널 기준(기존)", absolute: "공통 절대", diff: "차이(0 중심)" };
export const COLOR_MODE_HELP: Record<ColorMode, string> = {
  channel: "채널마다 연평균 시청률의 2배를 가장 진한 색으로 칠합니다. 채널·타깃이 다르면 같은 색이 같은 시청률이 아닙니다.",
  absolute: "모든 칸을 같은 눈금(시청률 0~1.0)으로 칠합니다. 같은 색은 같은 시청률입니다(타깃이 같을 때).",
  diff: "각 칸이 반대편의 같은 요일·시간대보다 높으면 파랑, 낮으면 빨강, 같으면 흰색입니다.",
};

/** 공통 절대 눈금의 가장 진한 값(시청률). 이보다 높으면 같은 색. */
export const ABSOLUTE_MAX = 1.0;
export const ABSOLUTE_HUE = "#0f766e";
/** 이 값보다 작은 차이는 "같음"(흰색)으로 본다. */
export const DIFF_EPSILON = 0.0005;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function absoluteColor(rating: number): { bg: string; isDark: boolean } {
  return intensityColor(ABSOLUTE_HUE, clamp01(rating / ABSOLUTE_MAX));
}

const WHITE: [number, number, number] = [255, 255, 255];
const BLUE: [number, number, number] = hexToRgb("#2563eb");
const RED: [number, number, number] = hexToRgb("#dc2626");

/** 0 중심 차이 색. 양(+)=파랑, 음(−)=빨강, |차이|가 척도 한계 이상이면 가장 진함. 빨강은 진해져도 글자색을 바꾸지 않는다(기존 규칙). */
export function divergingColor(diff: number, maxAbs: number): { bg: string; isDark: boolean } {
  if (!(maxAbs > 0) || Math.abs(diff) < DIFF_EPSILON) return { bg: "#ffffff", isDark: false };
  const t = clamp01(Math.abs(diff) / maxAbs);
  if (diff > 0) {
    const rgb = mixRgb(WHITE, BLUE, t);
    const lum = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
    return { bg: rgbToHex(rgb), isDark: lum < 0.5 };
  }
  return { bg: rgbToHex(mixRgb(WHITE, RED, t)), isDark: false };
}

/** 부호 있는 차이 표기("+0.123", "−0.045"). */
export function signedDiffText(diff: number, decimals: number): string {
  return `${diff > 0 ? "+" : diff < 0 ? "−" : "±"}${Math.abs(diff).toFixed(decimals)}`;
}

// ───────────── 보기 설정(범위·요일·밀도·색) ─────────────

export type HourRangeKey = "all" | "prime";
/** 프라임은 평일 19~23·주말 18~23의 합집합(18~23시)을 보여 준다 — 평일 18시대는 프라임이 아님을 라벨에 적는다. */
export const HOUR_RANGES: Record<HourRangeKey, { fromHour: number; toHour: number; label: string }> = {
  all: { fromHour: 2, toHour: 26, label: "하루 전체(02~26시)" },
  prime: { fromHour: PRIME.weekendFrom, toHour: PRIME.weekdayTo, label: `프라임 ${PRIME.weekendFrom}~${PRIME.weekdayTo}시(${PRIME_LABEL})` },
};

export type Density = "balanced" | "value" | "title";
export const DENSITY_LABEL: Record<Density, string> = { balanced: "기본", value: "수치 크게", title: "제목 크게" };

/** 기준 높이(px) — 하루 전체를 이 높이에 맞춘 값이 기존 눈금(0.6px/분)이다. 범위가 좁으면 같은 높이로 확대한다. */
export const BASE_GRID_HEIGHT_PX = 864;
export const MAX_PX_PER_MIN = 3;

export interface GridGeometry {
  startMin: number;
  endMin: number;
  pxPerMin: number;
  heightPx: number;
  hourTicks: number[];
  /** 글자 확대 배율(범위·요일을 좁혀 칸이 커졌을 때) */
  fontScale: number;
}

export function gridGeometry(range: HourRangeKey, dayFilter: number | null): GridGeometry {
  const { fromHour, toHour } = HOUR_RANGES[range];
  const startMin = fromHour * 60;
  const endMin = toHour * 60;
  const span = endMin - startMin;
  const pxPerMin = Math.min(MAX_PX_PER_MIN, BASE_GRID_HEIGHT_PX / span);
  const hourTicks: number[] = [];
  for (let h = fromHour; h < toHour; h++) hourTicks.push(h);
  // 시간 범위를 좁히면 칸 높이가 커지고, 요일 하나만 보면 칸 폭이 커진다 — 글자도 같이 키워 읽을 수 있게 한다.
  const heightScale = pxPerMin / 0.6;
  const fontScale = Math.min(1.5, 1 + (heightScale - 1) * 0.12 + (dayFilter !== null ? 0.2 : 0));
  return { startMin, endMin, pxPerMin, heightPx: span * pxPerMin, hourTicks, fontScale: Math.round(fontScale * 100) / 100 };
}

export interface CompareViewPrefs {
  range: HourRangeKey;
  /** 1=월 … 7=일, null=전체 주 */
  day: number | null;
  density: Density;
  color: ColorMode;
}

export const DEFAULT_PREFS: CompareViewPrefs = { range: "all", day: null, density: "balanced", color: "channel" };

export interface CompareSideQuery {
  channel: string;
  week: string;
}

export interface CompareQuery {
  prefs: CompareViewPrefs;
  left: Partial<CompareSideQuery>;
  right: Partial<CompareSideQuery>;
}

const WEEK_RE = /^\d{4}-\d{2}-\d{2}$/;
// 채널 코드: 영문 대문자·숫자·밑줄 또는 경쟁채널 인코딩(COMPETITOR::이름) — 길이·문자를 제한한다.
// 경쟁채널은 encodeURIComponent로 인코딩된 이름(한글 1자 = 9자)이라 길이 상한을 넉넉히 두고, 디코딩이 되는 값만 받는다.
const CHANNEL_RE = /^(?:[A-Z0-9_]{1,24}|COMPETITOR::[^\s&=?#/\\]{1,300})$/u;

function validWeek(v: string | null): string | undefined {
  if (!v || !WEEK_RE.test(v)) return undefined;
  const t = Date.parse(`${v}T00:00:00Z`);
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== v) return undefined;
  return v;
}
function validChannel(v: string | null): string | undefined {
  if (!v || !CHANNEL_RE.test(v)) return undefined;
  if (v.startsWith("COMPETITOR::")) {
    try {
      decodeURIComponent(v.slice("COMPETITOR::".length));
    } catch {
      return undefined; // 깨진 % 인코딩은 서버 디코딩에서 오류가 나므로 받지 않는다
    }
  }
  return v;
}

/** URL → 비교 화면 설정. 잘못된 값은 버리고 기본값을 쓴다. */
export function parseCompareQuery(get: (k: string) => string | null): CompareQuery {
  const range = get("rng") === "prime" ? "prime" : "all";
  const dayN = Number(get("day"));
  const day = Number.isInteger(dayN) && dayN >= 1 && dayN <= 7 ? dayN : null;
  const d = get("dens");
  const density: Density = d === "value" || d === "title" ? d : "balanced";
  const c = get("clr");
  const color: ColorMode = c === "absolute" || c === "diff" ? c : "channel";
  return {
    prefs: { range, day, density, color },
    left: { channel: validChannel(get("lc")), week: validWeek(get("lw")) },
    right: { channel: validChannel(get("rc")), week: validWeek(get("rw")) },
  };
}

/** 비교 화면 설정 → 쿼리 조각(기본값은 생략). 채널 코드는 인코딩한다. */
export function serializeCompareQuery(q: CompareQuery): URLSearchParams {
  const sp = new URLSearchParams();
  if (q.prefs.range !== DEFAULT_PREFS.range) sp.set("rng", q.prefs.range);
  if (q.prefs.day !== null) sp.set("day", String(q.prefs.day));
  if (q.prefs.density !== DEFAULT_PREFS.density) sp.set("dens", q.prefs.density);
  if (q.prefs.color !== DEFAULT_PREFS.color) sp.set("clr", q.prefs.color);
  if (q.left.channel) sp.set("lc", q.left.channel);
  if (q.left.week) sp.set("lw", q.left.week);
  if (q.right.channel) sp.set("rc", q.right.channel);
  if (q.right.week) sp.set("rw", q.right.week);
  return sp;
}

// ───────────── 키보드 이동 ─────────────

export interface NavCell {
  dow: number;
  startMin: number;
  endMin: number;
}

/**
 * 방향키로 이웃 칸을 고른다. 위·아래는 같은 요일의 이전·다음 칸, 좌·우는 이웃 요일에서 현재 칸의 시작 시각을 덮는(없으면 가장 가까운) 칸.
 * 이동할 칸이 없으면 null(제자리).
 */
export function neighborCell(cells: NavCell[], index: number, key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight"): number | null {
  const cur = cells[index];
  if (!cur) return null;
  const sameDay = cells.map((c, i) => ({ c, i })).filter((x) => x.c.dow === cur.dow).sort((a, b) => a.c.startMin - b.c.startMin);
  if (key === "ArrowUp" || key === "ArrowDown") {
    const pos = sameDay.findIndex((x) => x.i === index);
    const next = sameDay[pos + (key === "ArrowDown" ? 1 : -1)];
    return next ? next.i : null;
  }
  const step = key === "ArrowRight" ? 1 : -1;
  for (let dow = cur.dow + step; dow >= 1 && dow <= 7; dow += step) {
    const col = cells.map((c, i) => ({ c, i })).filter((x) => x.c.dow === dow);
    if (col.length === 0) continue;
    const covering = col.find((x) => x.c.startMin <= cur.startMin && cur.startMin < x.c.endMin);
    if (covering) return covering.i;
    return col.sort((a, b) => Math.abs(a.c.startMin - cur.startMin) - Math.abs(b.c.startMin - cur.startMin))[0].i;
  }
  return null;
}
