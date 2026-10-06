// 회차 범위 표기 해석(단계 06) — "#1~12", "#320~350, #337제외", "#412~453 #419~424, 435~440제외" 같은 표기를 읽는다.
// 읽을 수 없는 조각이 하나라도 있으면 범위 전체를 unknown(원문 보존)으로 둔다 — 일부만 해석해 허용 회차를 넓히지 않는다.
import type { EpisodeScope } from "./types";

const UNKNOWN_MARKERS = /^#?\s*(회차\s*(선택|셀렉)|정보\s*없음)/;

export function parseEpisodeScope(raw: unknown): EpisodeScope {
  if (raw === null || raw === undefined || String(raw).trim() === "") return { kind: "unknown", raw: null, reason: "회차 칸이 비어 있습니다" };
  const s = String(raw).trim().replace(/\s+제외/g, "제외");
  if (UNKNOWN_MARKERS.test(s)) return { kind: "unknown", raw: s, reason: `회차가 정해지지 않은 표기입니다("${s}")` };

  // 공백으로 나뉜 묶음. 쉼표로 끝난 조각은 다음 조각과 같은 묶음이다("#419~424, 435~440제외").
  const parts = s.split(/\s+/);
  const groups: string[] = [];
  for (const p of parts) {
    if (groups.length && groups[groups.length - 1].endsWith(",")) groups[groups.length - 1] += p;
    else groups.push(p);
  }

  const ranges: [number, number][] = [];
  const excluded: [number, number][] = [];
  for (const g of groups) {
    const items = g.split(",").map((x) => x.trim()).filter(Boolean);
    if (items.length === 0) continue;
    // 마지막으로 '#'로 시작한 항목부터 끝까지가 같은 덩어리다. 그 덩어리 안에 '제외'가 있으면 덩어리 전체가 제외 범위.
    let lastHash = 0;
    items.forEach((it, i) => {
      if (it.startsWith("#")) lastHash = i;
    });
    const excludeFrom = items.slice(lastHash).some((it) => it.endsWith("제외")) ? lastHash : -1;
    for (let i = 0; i < items.length; i++) {
      const token = items[i].replace(/제외$/, "").replace(/^#/, "").replace(/회$/, "").trim();
      const m = /^(\d+)(?:\s*~\s*(\d+))?$/.exec(token);
      if (!m) return { kind: "unknown", raw: s, reason: `읽을 수 없는 회차 표기: "${items[i]}"` };
      const a = Number(m[1]);
      const b = m[2] === undefined ? a : Number(m[2]);
      if (b < a) return { kind: "unknown", raw: s, reason: `회차 범위가 거꾸로입니다: "${items[i]}"` };
      (excludeFrom >= 0 && i >= excludeFrom ? excluded : ranges).push([a, b]);
    }
  }
  if (ranges.length === 0) return { kind: "unknown", raw: s, reason: "허용 회차 범위를 찾지 못했습니다" };
  return { kind: "ranges", ranges, excluded, raw: s };
}

export function episodeAllowed(scope: EpisodeScope, n: number): boolean | null {
  if (scope.kind === "all") return true;
  if (scope.kind === "unknown") return null;
  const inRanges = scope.ranges.some(([a, b]) => n >= a && n <= b);
  const inExcluded = scope.excluded.some(([a, b]) => n >= a && n <= b);
  return inRanges && !inExcluded;
}

/** 허용 회차 목록(상한 안에서). 범위가 매우 크면 잘라 돌려주지 않고 null — 호출부가 개수만 쓴다. */
export function listEpisodes(scope: EpisodeScope, cap = 5000): number[] | null {
  if (scope.kind !== "ranges") return null;
  const out: number[] = [];
  for (const [a, b] of scope.ranges) {
    if (b - a + 1 > cap) return null;
    for (let n = a; n <= b; n++) if (episodeAllowed(scope, n)) out.push(n);
    if (out.length > cap) return null;
  }
  return [...new Set(out)].sort((x, y) => x - y);
}

export function describeEpisodeScope(scope: EpisodeScope): string {
  if (scope.kind === "all") return "전 회차";
  if (scope.kind === "unknown") return `회차 미확인${scope.raw ? `(${scope.raw})` : ""}`;
  return scope.raw;
}
