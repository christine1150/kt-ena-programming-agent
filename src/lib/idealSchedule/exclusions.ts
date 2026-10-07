// 제외 편성(사용자 지시 2026-10-06/07) — 종영·방영권 만료·사용 비권장·임시 중단으로 편성표에 넣지 않을 프로그램.
// 엔진의 slotAllowed 게이트(권리 게이트와 같은 자리)에 합쳐 AI가 이 제목을 새로 배치하지 못하게 하고, 현재 편성에 있으면 교체 대상이 되게 한다.
// 필수 편성(LOCK 등)으로 사용자가 직접 넣은 칸은 건드리지 않는다(사용자가 명시한 것이 우선).
import { supabase } from "@/lib/supabase";
import { normalizeProgramCanonicalName } from "@/lib/programNameMatch";
import type { EngineCandidate } from "./scoring";

export interface ExclusionRow {
  id: string;
  channel_id: string | null;
  program_name: string;
  reason: string | null;
  active_from: string | null;
  active_to: string | null;
  created_by: string | null;
  created_at: string;
}

/** 이름 비교용 정규화 — 공백·기호·대소문자를 없앤다("풍향 GO" = "풍향go"). */
export function exclusionKey(name: string): string {
  return normalizeProgramCanonicalName(name).replace(/[\s\-_.,·'"()[\]<>]/g, "").toLowerCase();
}

/** 이 채널에 적용되는(채널 지정 또는 전 채널) 제외 항목 중 대상 주(7일)와 기간이 겹치는 것. 표가 없으면 빈 목록. */
export async function loadActiveExclusions(channelId: string, weekStart: string): Promise<ExclusionRow[]> {
  const weekEnd = new Date(Date.parse(`${weekStart}T00:00:00Z`) + 6 * 86400000).toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("ideal_schedule_exclusions")
    .select("*")
    .or(`channel_id.eq.${channelId},channel_id.is.null`);
  if (error) return [];
  return ((data ?? []) as ExclusionRow[]).filter((r) => (!r.active_from || r.active_from <= weekEnd) && (!r.active_to || r.active_to >= weekStart));
}

/** 후보 이름이 제외 제목을 포함하면 제외(예: 제외 "풍향GO" → "풍향GO2사전모임"도 제외). 너무 짧은 제목(2자 미만)은 오탐을 막으려 무시한다. */
export function buildExcludedPredicate(rows: ExclusionRow[]): ((c: EngineCandidate) => boolean) | null {
  const keys = rows.map((r) => exclusionKey(r.program_name)).filter((k) => k.length >= 2);
  if (keys.length === 0) return null;
  return (c) => {
    if (c.contentType === "ARCHETYPE") return false; // 장르 원형은 특정 프로그램이 아니다
    const k = exclusionKey(c.programName);
    return keys.some((x) => k.includes(x));
  };
}

/** 이름만으로 제외 여부 판정(후보 객체가 없는 화면·API용 — 적합도 목록·후보 감소 안내 등). 규칙은 buildExcludedPredicate와 같다. */
export function isTitleExcluded(rows: ExclusionRow[], name: string | null | undefined): boolean {
  if (!name) return false;
  const k = exclusionKey(name);
  return rows.some((r) => {
    const x = exclusionKey(r.program_name);
    return x.length >= 2 && k.includes(x);
  });
}

/** 캐시 키 등에 쓰는 짧은 지문 */
export function exclusionFingerprint(rows: ExclusionRow[]): string {
  return rows.map((r) => `${r.id}`).sort().join(",");
}
