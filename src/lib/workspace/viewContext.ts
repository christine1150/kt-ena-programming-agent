// 화면 문맥(ViewContext, 단계 07) — 채널·기간·비교기간·홈 보기(일간/주간/월간)를 URL 하나로 표현한다.
// 새로고침·북마크·뒤로가기·보고서 링크가 모두 같은 문맥을 이어받게 하는 단일 출처다. 화면이 따로 쓰던
// 쿼리 이름(date·dateFrom·dateTo·preset·compareFrom·compareTo, 편성 화면의 channel)을 그대로 쓰므로
// 이미 공유된 링크와 호환된다. 알 수 없는 값은 조용히 고치지 않고 issues로 돌려준다.
import { PERIOD_PRESET_LABELS, type PeriodPreset } from "@/lib/audienceReport/periodPresets";

export const CHANNEL_CODES = ["ENA", "ENA_DRAMA", "ENA_PLAY", "ENA_STORY", "OLIFE", "ONCE", "SKYUHD"] as const;
export type ChannelCode = (typeof CHANNEL_CODES)[number];

export const HOME_VIEWS = ["daily", "weekly", "monthly"] as const;
export type HomeView = (typeof HOME_VIEWS)[number];
export const HOME_VIEW_LABEL: Record<HomeView, string> = { daily: "일간", weekly: "주간", monthly: "월간" };

export interface ViewContext {
  /** 채널 코드. 홈(전 채널)은 null */
  channel: string | null;
  /** 홈 보기. 기본 일간 */
  view: HomeView;
  /** 기준일(YYYY-MM-DD). null = 최신 수신일 */
  date: string | null;
  /** 채널 분석 기간 프리셋 */
  preset: PeriodPreset | null;
  dateFrom: string | null;
  dateTo: string | null;
  compareFrom: string | null;
  compareTo: string | null;
  /** 동요일(SDoW) 프리셋에서 고른 요일(0=일 … 6=토). null = 기준일의 요일에 자동 매칭 */
  dow: number | null;
}

export const EMPTY_CONTEXT: ViewContext = {
  channel: null,
  view: "daily",
  date: null,
  preset: null,
  dateFrom: null,
  dateTo: null,
  compareFrom: null,
  compareTo: null,
  dow: null,
};

export interface ParsedContext {
  ctx: ViewContext;
  /** 버려진 값과 이유(조용히 보정하지 않는다) */
  issues: string[];
}

/** 실제 달력에 있는 YYYY-MM-DD인지(2026-02-30 같은 값 거부). */
export function isIsoDate(s: string | null | undefined): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}

const isChannel = (c: string): c is ChannelCode => (CHANNEL_CODES as readonly string[]).includes(c);
const isPreset = (p: string): p is PeriodPreset => Object.prototype.hasOwnProperty.call(PERIOD_PRESET_LABELS, p);
const isView = (v: string): v is HomeView => (HOME_VIEWS as readonly string[]).includes(v);

/** URL 쿼리(또는 경로의 채널)에서 문맥을 읽는다. 잘못된 값은 버리고 issues에 이유를 남긴다. */
export function parseViewContext(get: (key: string) => string | null, opts: { channelFromPath?: string | null } = {}): ParsedContext {
  const issues: string[] = [];
  const ctx: ViewContext = { ...EMPTY_CONTEXT };

  const rawChannel = (opts.channelFromPath ?? get("channel") ?? "").trim().toUpperCase();
  if (rawChannel) {
    if (isChannel(rawChannel)) ctx.channel = rawChannel;
    else issues.push(`알 수 없는 채널 "${rawChannel}"을(를) 무시했습니다.`);
  }

  const rawView = get("view");
  if (rawView) {
    if (isView(rawView)) ctx.view = rawView;
    else issues.push(`알 수 없는 보기 "${rawView}"을(를) 무시하고 일간으로 표시합니다.`);
  }

  const dateField = (key: "date" | "dateFrom" | "dateTo" | "compareFrom" | "compareTo") => {
    const v = get(key);
    if (!v) return null;
    if (isIsoDate(v)) return v;
    issues.push(`${key}="${v}"은(는) 올바른 날짜가 아니라 무시했습니다.`);
    return null;
  };
  ctx.date = dateField("date");
  ctx.dateFrom = dateField("dateFrom");
  ctx.dateTo = dateField("dateTo");
  ctx.compareFrom = dateField("compareFrom");
  ctx.compareTo = dateField("compareTo");

  const rawPreset = get("preset");
  if (rawPreset) {
    if (isPreset(rawPreset)) ctx.preset = rawPreset;
    else issues.push(`알 수 없는 기간 프리셋 "${rawPreset}"을(를) 무시했습니다.`);
  }

  // 시작일이 종료일보다 늦어도 버리지 않는다: 화면의 기간 계산(computePeriodPreset)이 순서를 정렬해 받아들이는 기존 동작이며,
  // 날짜 칸에 연도를 입력하는 중간 값이 일시적으로 거꾸로 되어도 입력 중인 값이 지워지지 않게 한다.
  if ((ctx.compareFrom === null) !== (ctx.compareTo === null)) {
    issues.push("비교 기간은 시작일과 종료일이 함께 있어야 해서 무시했습니다.");
    ctx.compareFrom = null;
    ctx.compareTo = null;
  } else if (ctx.compareFrom && ctx.compareTo && ctx.compareFrom > ctx.compareTo) {
    issues.push("비교 기간 시작일이 종료일보다 늦어 무시했습니다.");
    ctx.compareFrom = null;
    ctx.compareTo = null;
  }
  // "직접 선택"은 날짜를 고르는 중간 상태(시작일·종료일이 아직 없음)도 유효한 화면 상태다. 프리셋을 버리면
  // 사용자가 고르는 순간 선택이 오늘로 되돌아간다. 보고서 링크는 기간이 없으면 만들지 않는다(reportQuery).
  const rawDow = get("dow");
  if (rawDow !== null && rawDow !== "") {
    const n = Number(rawDow);
    if (Number.isInteger(n) && n >= 0 && n <= 6) ctx.dow = n;
    else issues.push(`dow="${rawDow}"은(는) 0~6 정수가 아니라 무시했습니다.`);
  }
  return { ctx, issues };
}

/** 문맥을 쿼리 문자열로. 키 순서가 고정이라 같은 문맥은 항상 같은 문자열이다. 기본값(일간)은 생략한다. */
export function serializeContext(ctx: ViewContext, opts: { includeChannel?: boolean } = {}): URLSearchParams {
  const q = new URLSearchParams();
  if (opts.includeChannel && ctx.channel) q.set("channel", ctx.channel);
  if (ctx.view !== "daily") q.set("view", ctx.view);
  if (ctx.date) q.set("date", ctx.date);
  if (ctx.preset) q.set("preset", ctx.preset);
  if (ctx.dateFrom) q.set("dateFrom", ctx.dateFrom);
  if (ctx.dateTo) q.set("dateTo", ctx.dateTo);
  if (ctx.compareFrom) q.set("compareFrom", ctx.compareFrom);
  if (ctx.compareTo) q.set("compareTo", ctx.compareTo);
  if (ctx.dow !== null) q.set("dow", String(ctx.dow));
  return q;
}

export function sameContext(a: ViewContext, b: ViewContext): boolean {
  return serializeContext(a, { includeChannel: true }).toString() === serializeContext(b, { includeChannel: true }).toString();
}

/**
 * 데이터 요청 키 — 이 키가 바뀌면 값을 다시 받아야 한다. 홈의 일간·주간·월간 보기 전환은 같은 응답을 쓰므로
 * view는 키에 넣지 않는다(보기만 바꿨는데 다시 받아 깜박이지 않게).
 */
export function dataKey(ctx: ViewContext, scope: "home" | "channel"): string {
  if (scope === "home") return `home|${ctx.date ?? "latest"}`;
  return ["channel", ctx.channel ?? "-", ctx.preset ?? "today", ctx.dateFrom ?? "", ctx.dateTo ?? "", ctx.date ?? "", ctx.compareFrom ?? "", ctx.compareTo ?? "", ctx.dow ?? ""].join("|");
}

/**
 * 보고서 화면이 읽는 쿼리. 채널 화면의 기존 규칙과 같다: 오늘·어제는 date, 직접 선택은 dateFrom/dateTo,
 * 나머지 프리셋은 preset+dateTo. 종료일(최신일 포함)을 알 수 없으면 null(링크를 만들지 않는다).
 */
export function reportQuery(ctx: ViewContext, resolvedDateTo?: string | null): URLSearchParams | null {
  const to = ctx.dateTo ?? ctx.date ?? resolvedDateTo ?? null;
  if (!to) return null;
  const preset = ctx.preset ?? "today";
  const q = new URLSearchParams();
  if (preset === "today" || preset === "yesterday") {
    q.set("date", to);
    return q;
  }
  if (preset === "custom") {
    if (!ctx.dateFrom) return null;
    const [from, end] = ctx.dateFrom <= to ? [ctx.dateFrom, to] : [to, ctx.dateFrom];
    q.set("dateFrom", from);
    q.set("dateTo", end);
    return q;
  }
  q.set("preset", preset);
  q.set("dateTo", to);
  return q;
}

/** 슬롯 강조용 시(방송일 기준 확장 시각: 2~27). 정수가 아니거나 범위를 벗어나면 null(조용히 보정하지 않는다). */
export function parseFocusHour(v: string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 2 && n <= 27 ? n : null;
}

/** 화면 안에서 URL을 다시 쓸 때 지켜야 하는 액션 문맥 쿼리(결정 카드에서 이어진 검토). */
export const ACTION_QUERY_KEYS = ["from", "ft", "sj", "hour", "date", "cut"] as const;

/** 현재 쿼리에서 액션 문맥만 뽑아 `&k=v` 꼴로 이어 붙일 문자열로 만든다(없으면 빈 문자열). */
export function actionQuerySuffix(get: (key: string) => string | null): string {
  return ACTION_QUERY_KEYS.filter((k) => get(k)).map((k) => `&${k}=${encodeURIComponent(get(k) as string)}`).join("");
}

/** 종료일을 모를 때 보고서 링크: 기간 프리셋(오늘·어제·직접 선택 제외)만 싣는다. 보고서 화면이 종료일을 최신으로 채운다. */
export function presetOnlyQuery(ctx: ViewContext): URLSearchParams | null {
  const p = ctx.preset;
  if (!p || p === "today" || p === "yesterday" || p === "custom") return null;
  const q = new URLSearchParams();
  q.set("preset", p);
  return q;
}

export type Destination = "home" | "channel" | "portfolio" | "report" | "schedule_grid" | "ideal_schedule" | "purchase" | "admin";

const withQuery = (path: string, q: URLSearchParams | null): string => {
  const s = q?.toString() ?? "";
  return s ? `${path}?${s}` : path;
};

/**
 * 한 문맥에서 다른 화면으로 가는 링크. 각 화면이 이미 읽는 쿼리 이름으로 문맥을 옮긴다.
 * `extra`는 화면별 추가 값(run·from·focus·snap 등)이며 값이 비면 붙이지 않는다.
 * 편성 화면(schedule-grid·ideal-schedule)은 기간 대신 channel만 읽으므로 기간은 붙이지 않는다.
 */
export function hrefFor(dest: Destination, ctx: ViewContext, extra: Record<string, string | null | undefined> = {}, resolvedDateTo?: string | null): string {
  const channel = ctx.channel ?? "ENA";
  const q = new URLSearchParams();
  const addExtra = (target: URLSearchParams) => {
    for (const [k, v] of Object.entries(extra)) if (v) target.set(k, v);
    return target;
  };
  switch (dest) {
    case "home": {
      const hq = serializeContext({ ...EMPTY_CONTEXT, view: ctx.view, date: ctx.date });
      return withQuery("/", addExtra(hq));
    }
    case "channel": {
      // 채널 화면은 기준일(date)을 읽지 않는다 — 기준일만 있으면 그날 하루를 '직접 선택'으로 연다(과거 날짜 문맥이 이어지게).
      const base: ViewContext = { ...ctx, channel, view: "daily" };
      const dayOnly: ViewContext = base.date && !base.preset ? { ...base, preset: "custom", dateFrom: base.date, dateTo: base.date } : base;
      const cq = serializeContext({ ...dayOnly, date: null });
      return withQuery(`/channel/${encodeURIComponent(channel)}`, addExtra(cq));
    }
    case "portfolio":
      return withQuery("/audience-report/portfolio", addExtra(reportQuery(ctx, resolvedDateTo) ?? presetOnlyQuery(ctx) ?? new URLSearchParams()));
    case "report":
      return withQuery(`/audience-report/${encodeURIComponent(channel)}`, addExtra(reportQuery(ctx, resolvedDateTo) ?? presetOnlyQuery(ctx) ?? new URLSearchParams()));
    case "schedule_grid":
      q.set("channel", channel);
      return withQuery("/schedule-grid", addExtra(q));
    case "ideal_schedule":
      q.set("channel", channel);
      return withQuery("/ideal-schedule", addExtra(q));
    case "purchase":
      q.set("channel", channel);
      return withQuery("/ideal-schedule/purchase", addExtra(q));
    case "admin":
      return withQuery("/admin", addExtra(q));
  }
}
