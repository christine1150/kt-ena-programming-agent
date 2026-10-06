// Avail 어댑터 공통(단계 06) — 해시·채널·플랫폼 표기 정규화와 기본 규칙 틀.
import { createHash } from "node:crypto";
import type { ChannelScope, Rules, Tri } from "../types";

export const sha1 = (text: string): string => createHash("sha1").update(text).digest("hex");

/** 원본 열 전체의 안정 해시 — 같은 원본 행이면 같고, 한 칸이라도 바뀌면 달라진다. */
export function rowHashOf(columns: Record<string, unknown>): string {
  const keys = Object.keys(columns).sort();
  return sha1(JSON.stringify(keys.map((k) => [k, columns[k] ?? null]))).slice(0, 16);
}

const CHANNEL_CANON: Record<string, string> = {
  ena: "ENA",
  enadrama: "ENA Drama",
  enaplay: "ENA Play",
  olife: "OLIFE",
  once: "ONCE",
  enastory: "ENA Story",
  skyuhd: "skyUHD",
};

/** 채널 비교용 키 — 대소문자·공백 차이를 흡수한다("ENA DRAMA" = "ENA Drama"). */
export const channelKey = (raw: string): string => raw.toLowerCase().replace(/[\s_\-]+/g, "");

/** 시스템 채널 코드로 표준화한다. 시스템 7개 채널 밖의 이름(CHING·ONT 등)은 원문을 그대로 쓴다. */
export const canonicalChannelId = (raw: string): string => CHANNEL_CANON[channelKey(raw)] ?? raw.trim();

const isEmptyChannelCell = (v: unknown) => v === null || v === undefined || String(v).trim() === "" || String(v).trim() === "-";

/** 방영채널1~3 → 채널 범위. ALL이 있으면 전 채널. 첫 칸이 비어 있으면 어느 채널인지 모른다(무제한으로 가정하지 않음). */
export function channelScopeFromCells(cells: unknown[]): ChannelScope {
  const raws = cells.filter((c) => !isEmptyChannelCell(c)).map((c) => String(c).trim());
  if (raws.length === 0 || isEmptyChannelCell(cells[0])) return { kind: "unknown", raw: cells.map((c) => (c === null || c === undefined ? "" : String(c))).join("|") };
  if (raws.some((r) => r.toUpperCase() === "ALL")) return { kind: "all" };
  return { kind: "list", ids: [...new Set(raws.map(canonicalChannelId))] };
}

/** 방영범위 약어 → 플랫폼 이름. 약어 풀이는 권리 담당자 확인 전의 제안이다(docs/agent-improvement/AVAIL_ADAPTER_NOTES.md). */
const PLATFORM_MAP: Record<string, string> = {
  위: "위성",
  위성: "위성",
  케: "케이블",
  케이블: "케이블",
  ip: "IPTV",
  iptv: "IPTV",
  모: "모바일",
  n: "N스크린",
  n스크린: "N스크린",
  인: "인터넷",
  ott: "OTT",
  지: "지상파",
};
export const LINEAR_PLATFORMS = ["위성", "케이블", "IPTV"] as const;

export function parsePlatforms(raw: unknown): { raw: string[]; mapped: string[]; unmapped: string[] } {
  if (raw === null || raw === undefined || String(raw).trim() === "") return { raw: [], mapped: [], unmapped: [] };
  const parts = String(raw)
    .split(/[\/+]/)
    .map((p) => p.trim())
    .filter(Boolean);
  const mapped: string[] = [];
  const unmapped: string[] = [];
  for (const p of parts) {
    // "모N"처럼 붙어 있는 약어는 문자 단위로 풀지 않는다(해석 불가로 둔다)
    const m = PLATFORM_MAP[p.toLowerCase()];
    if (m) mapped.push(m);
    else unmapped.push(p);
  }
  return { raw: parts, mapped: [...new Set(mapped)], unmapped };
}

export function emptyRules(): Rules {
  return {
    count: { limit: { state: "unknown", raw: null }, raw: null },
    daysOfWeek: { state: "not_applicable" },
    timeOfDay: { state: "not_applicable" },
    blackouts: [],
    minRerunGapDays: { state: "not_applicable" },
    episodeOrder: { state: "not_applicable" },
    platformsRaw: [],
    firstWindowGate: null,
  };
}

/** "[8106]", "[5059] [5584]", "[]" → 계약 식별자 목록(민감 원문 대신 식별자만). */
export function parseContractRefs(raw: unknown): string[] {
  if (raw === null || raw === undefined) return [];
  return [...String(raw).matchAll(/\[([^\]]+)\]/g)].map((m) => m[1].trim()).filter(Boolean);
}

/** "4방" → 4, "제한없음" → 무제한, 그 외는 unknown(원문 보존). */
export function parseCountCell(raw: unknown): { limit: Tri<number>; raw: string | null } {
  if (raw === null || raw === undefined || String(raw).trim() === "") return { limit: { state: "unknown", raw: null }, raw: null };
  const s = String(raw).trim();
  if (/^제한\s*없음$/.test(s)) return { limit: { state: "unbounded" }, raw: s };
  const m = /^(\d+)\s*방?$/.exec(s);
  if (m) return { limit: { state: "value", value: Number(m[1]) }, raw: s };
  return { limit: { state: "unknown", raw: s }, raw: s };
}

export const text = (v: unknown): string | null => (v === null || v === undefined || String(v).trim() === "" ? null : String(v).trim());
