// 운영자 입력 권리(단계 06 확장, 2026-10-07) — 원본 Avail 파일에 아직 없는 콘텐츠의 "편성 가능 시점"을 채널별로 직접 넣는다.
// 순수 함수(DB 접근 없음). 알려진 것만 넣고 나머지(종료일·방수·편수·플랫폼)는 비워 둔다 — 빈칸은 무제한이 아니라 unknown이다(명세 A14).
//  · 시작 전(시작일 + 시각 이전)에 시작하는 방송은 종료일을 몰라도 *불가*로 판정한다(evaluate.ts의 window.startMin).
//  · 시작 뒤에도 종료일·방수가 비어 있으면 '권리 미확인'이라 실행 가능으로 표시되지 않는다.
//  · Avail 파일에 같은 제목이 올라오면 파일이 우선이다(운영자 입력은 manual.override로 표시되어 파일이 덮지 않고 충돌로 보인다).
import { canonicalChannelId, emptyRules, rowHashOf } from "./adapters/common";
import { titleVariants } from "./identity";
import type { Grant } from "./types";

const SYSTEM_CHANNELS = ["ENA", "ENA Drama", "ENA Play", "ENA Story", "OLIFE", "ONCE", "skyUHD"];

export interface ManualWindowInput {
  /** 이 시작 시점이 적용되는 채널(시스템 채널 이름) */
  channels: string[];
  /** 편성 가능 시작일 YYYY-MM-DD */
  startDate: string;
  /** 그날 이 시각 이후 시작하는 방송부터 가능 — HH:MM(24시간제, 24시 넘김은 24:30처럼 쓸 수 있다). 없으면 시작일 0시 */
  startTime?: string | null;
}

export interface ManualGrantInput {
  title: string;
  windows: ManualWindowInput[];
  actor: string;
  enteredAt: string;
  /** 같은 제목의 기존 revision(있으면 새 revision이 이어받는다) */
  existing?: Grant[];
  note?: string | null;
}

export type ManualGrantResult = { ok: true; grants: Grant[] } | { ok: false; message: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** "23:50" → 방송일 분(1430). 24:30은 1470. 형식이 틀리면 null */
export function parseStartTime(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const m = /^(\d{1,2}):([0-5]\d)$/.exec(raw.trim());
  if (!m) return null;
  const h = Number(m[1]);
  if (h > 29) return null;
  return h * 60 + Number(m[2]);
}

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

export function buildManualGrants(i: ManualGrantInput): ManualGrantResult {
  const title = i.title.trim();
  if (!title) return { ok: false, message: "제목이 필요합니다." };
  if (!i.windows.length) return { ok: false, message: "편성 가능 시점이 하나 이상 필요합니다." };
  const seen = new Set<string>();
  const grants: Grant[] = [];
  const tv = titleVariants(title);
  for (const w of i.windows) {
    if (!DATE.test(w.startDate) || Number.isNaN(Date.parse(`${w.startDate}T00:00:00Z`))) return { ok: false, message: `시작일 형식이 올바르지 않습니다(YYYY-MM-DD): ${w.startDate}` };
    const startMin = parseStartTime(w.startTime ?? null);
    if (w.startTime && startMin === null) return { ok: false, message: `시작 시각 형식이 올바르지 않습니다(HH:MM): ${w.startTime}` };
    const channels = [...new Set(w.channels.map(canonicalChannelId))];
    if (!channels.length) return { ok: false, message: "채널을 하나 이상 골라 주세요." };
    const bad = channels.filter((c) => !SYSTEM_CHANNELS.includes(c));
    if (bad.length) return { ok: false, message: `시스템 채널이 아닙니다: ${bad.join(", ")}` };
    for (const c of channels) {
      if (seen.has(c)) return { ok: false, message: `${c} 채널이 두 번 들어 있습니다 — 채널마다 시작 시점은 하나입니다.` };
      seen.add(c);
    }
    const sortedKey = [...channels].sort().join("+");
    const grantId = `MANUAL:${tv.mainKey}:${sortedKey}`;
    const columns = { title, channels: sortedKey, startDate: w.startDate, startTime: startMin === null ? null : hhmm(startMin) };
    const rowHash = rowHashOf(columns);
    const prev = (i.existing ?? []).filter((g) => g.grantId === grantId).sort((a, b) => (a.enteredAt < b.enteredAt ? -1 : 1));
    const last = prev[prev.length - 1] ?? null;
    if (last && last.rowHash === rowHash) continue; // 같은 입력을 다시 넣은 것 — 새 revision을 만들지 않는다
    const rules = emptyRules();
    grants.push({
      grantId,
      revisionId: `${grantId}#${rowHash}`,
      rowHash,
      supersedesRevisionId: last ? last.revisionId : null,
      status: "active",
      contractRefs: [],
      rightsHolder: null,
      source: { kind: "manual", batchId: "manual", file: "운영자 입력", sheet: null, row: null, columns },
      enteredAt: i.enteredAt,
      content: { titleRaw: title, canonicalKey: tv.mainKey, sourceCode: null, genreRaw: null, originRaw: null, aliases: [], productionYear: { state: "unknown", raw: null }, origination: "unknown", runtimeMin: { state: "unknown", raw: null }, episodeCount: { state: "unknown", raw: null } },
      scope: { episodes: { kind: "all" }, channels: { kind: "list", ids: channels }, season: { state: "not_applicable" }, version: { state: "not_applicable" }, territory: { state: "not_applicable" } },
      // 종료일은 모른다 — 무기한으로 보지 않는다. 시작 시각은 window.startMin
      window: { start: { state: "value", value: w.startDate }, end: { state: "unknown", raw: null }, termRaw: null, appliesRaw: i.note ?? null, anchor: "fixed_start", grouping: "none", ...(startMin === null ? {} : { startMin }) },
      rules,
      conditions: [],
      usageBaseline: "unknown",
      mergedInto: null,
      manual: { override: true, by: i.actor },
      optionalCommercial: null,
    });
  }
  return { ok: true, grants };
}
