// 출연자 명단 ↔ 관리자 입력 글 변환(순수 함수). 사용자 지시(2026-11-15): 명단을 관리자 화면에서 고친다.
// 한 줄 = 한 작품:  구분 | 프로그램 | 이름, 이름, …
//   구분: 예정(방영 중·예정 자사 작품) / 지난(지난 자사 작품) / 솔로(일반인 프로그램 — 이름 없이 프로그램 단위)
// '#'으로 시작하는 줄과 빈 줄은 무시한다.
import type { CastEntry, CastScope } from "./cast";

const SCOPE_BY_LABEL: Record<string, Exclude<CastScope, "other">> = { 예정: "own_upcoming", 방영: "own_upcoming", 지난: "own_past", 종영: "own_past", 솔로: "solo", 일반인: "solo" };
const LABEL_BY_SCOPE: Record<Exclude<CastScope, "other">, string> = { own_upcoming: "예정", own_past: "지난", solo: "솔로" };

export interface RosterParseResult {
  entries: CastEntry[];
  /** 읽지 못한 줄(줄 번호·이유) */
  errors: string[];
}

export function parseRosterText(raw: string): RosterParseResult {
  const entries: CastEntry[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  raw.split(/\r?\n/).forEach((line, i) => {
    const t = line.trim();
    if (!t || t.startsWith("#")) return;
    const parts = t.split("|").map((s) => s.trim());
    if (parts.length < 2) return void errors.push(`${i + 1}줄: '구분 | 프로그램 | 이름, 이름' 형식이 아닙니다`);
    const scope = SCOPE_BY_LABEL[parts[0]];
    if (!scope) return void errors.push(`${i + 1}줄: 구분은 예정·지난·솔로 중 하나여야 합니다('${parts[0]}')`);
    const program = parts[1];
    if (!program) return void errors.push(`${i + 1}줄: 프로그램 이름이 비었습니다`);
    if (scope === "solo") {
      const key = `solo|${program}`;
      if (!seen.has(key)) entries.push({ name: "", program, scope });
      seen.add(key);
      return;
    }
    const names = (parts[2] ?? "").split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
    if (names.length === 0) return void errors.push(`${i + 1}줄: 출연자 이름이 없습니다(캐스팅 전이면 줄을 빼 두세요)`);
    for (const name of names) {
      if (name.length < 2) {
        errors.push(`${i + 1}줄: 한 글자 이름 '${name}'은 오탐이 많아 받지 않습니다(본명으로 적어 주세요)`);
        continue;
      }
      const key = `${scope}|${program}|${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ name, program, scope });
    }
  });
  return { entries, errors };
}

/** 명단 → 입력 글(같은 구분·프로그램끼리 한 줄, 처음 나온 순서 유지) */
export function rosterToText(entries: CastEntry[]): string {
  const lines = new Map<string, { label: string; program: string; names: string[] }>();
  for (const e of entries) {
    if (e.scope === "other") continue;
    const key = `${e.scope}|${e.program}`;
    if (!lines.has(key)) lines.set(key, { label: LABEL_BY_SCOPE[e.scope], program: e.program, names: [] });
    if (e.name) lines.get(key)!.names.push(e.name);
  }
  return [...lines.values()].map((l) => (l.label === "솔로" ? `${l.label} | ${l.program}` : `${l.label} | ${l.program} | ${l.names.join(", ")}`)).join("\n") + "\n";
}
