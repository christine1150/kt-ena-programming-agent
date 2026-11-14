// 페이지·API 체감 속도 계측의 순수 함수(고도화 계획 E1) — DB·브라우저 접근 없음.
// 클라이언트 비콘이 보내는 값을 서버가 검증·정규화하는 규칙과 요약용 백분위 계산을 한곳에 둔다.
// 개인정보 원칙: 쿼리스트링·해시·uuid·채널 코드를 저장하지 않고 경로 패턴으로만 남긴다.

export type TimingMetric = "ttfb" | "fcp" | "lcp" | "load" | "api";
export const TIMING_METRICS: readonly TimingMetric[] = ["ttfb", "fcp", "lcp", "load", "api"];

export interface TimingEntry {
  metric: TimingMetric;
  /** 정규화된 /api/* 경로(metric='api'만) */
  apiPath?: string | null;
  durationMs: number;
}

export interface TimingBeacon {
  path: string;
  viewport: "mobile" | "desktop";
  entries: TimingEntry[];
}

/** 한 번에 받는 최대 항목 수 — 한 화면이 /api를 수십 번 부르는 경우에도 상한을 둔다. */
export const MAX_ENTRIES_PER_BEACON = 60;
/** 한 사용자가 24시간에 보낼 수 있는 비콘 수(남용 방지, 가정값 — 정상 사용의 수 배). */
export const DAILY_BEACON_LIMIT = 600;
export const MAX_DURATION_MS = 120_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHANNEL_CODES = new Set(["ENA", "ENA_DRAMA", "ENA_PLAY", "ENA_STORY", "OLIFE", "ONCE", "SKYUHD"]);

/** 쿼리·해시를 떼고 동적 구간을 [패턴]으로 바꾼다. 알 수 없는 긴 구간은 [id]로. 잘못된 입력은 null. */
export function normalizeTimingPath(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 200) return null;
  let p = raw.split("#")[0].split("?")[0];
  if (!p.startsWith("/")) return null;
  if (p.length > 1) p = p.replace(/\/+$/, "");
  const segs = p.split("/").slice(1);
  const out: string[] = [];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (s === "") continue;
    const prev = out[out.length - 1];
    if (UUID.test(s) || /^\d{3,}$/.test(s)) out.push("[id]");
    else if (prev === "channel" && CHANNEL_CODES.has(s.toUpperCase())) out.push("[code]");
    else if (prev === "audience-report" && s !== "portfolio" && s !== "view") out.push("[channel]");
    else if (prev === "view" && out[out.length - 2] === "audience-report") out.push("[id]");
    else if (s.length > 40) out.push("[id]");
    else out.push(s.replace(/[^A-Za-z0-9\-_.]/g, "_"));
  }
  const norm = "/" + out.join("/");
  return norm.length <= 80 ? norm : null;
}

/** /api/* 경로 정규화 — 같은 규칙, 단 /api로 시작하지 않으면 null. */
export function normalizeApiPath(raw: unknown): string | null {
  const p = normalizeTimingPath(raw);
  return p && (p === "/api" || p.startsWith("/api/")) ? p : null;
}

/** 클라이언트가 보낸 본문을 검증한다 — 잘못된 항목은 버리고, 쓸 항목이 없으면 null. */
export function sanitizeBeacon(body: unknown): TimingBeacon | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const path = normalizeTimingPath(b.path);
  if (!path || path.startsWith("/api")) return null;
  const viewport = b.viewport === "mobile" ? "mobile" : "desktop";
  if (!Array.isArray(b.entries)) return null;
  const entries: TimingEntry[] = [];
  for (const e of b.entries.slice(0, MAX_ENTRIES_PER_BEACON)) {
    if (!e || typeof e !== "object") continue;
    const r = e as Record<string, unknown>;
    if (typeof r.metric !== "string" || !(TIMING_METRICS as readonly string[]).includes(r.metric)) continue;
    const ms = typeof r.durationMs === "number" ? r.durationMs : NaN;
    if (!Number.isFinite(ms) || ms < 0 || ms > MAX_DURATION_MS) continue;
    const metric = r.metric as TimingMetric;
    if (metric === "api") {
      const api = normalizeApiPath(r.apiPath);
      if (!api) continue;
      entries.push({ metric, apiPath: api, durationMs: Math.round(ms) });
    } else {
      entries.push({ metric, apiPath: null, durationMs: Math.round(ms) });
    }
  }
  return entries.length ? { path, viewport, entries } : null;
}

/** 선형 보간 백분위(percentile_cont와 같은 정의). 빈 배열은 null. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const i = (s.length - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(i);
  const hi = Math.min(lo + 1, s.length - 1);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}

/** 속도 목표(계획 E1, 측정 후 확정) 대비 판정 — 첫 화면(lcp) p75 기준. */
export const TIMING_TARGET_MS: Record<string, number> = { "/": 2000, "/channel/[code]": 3000 };
