// 라인업 제목 줄임말 — 이미 정리해 둔 기록을 모아 쓴다(사용자 지시 2026-11-25: 방영성과·브리핑 등에서 훑어 정리한 줄임말을 반영).
// 우선순위: ① 작품 상세에서 직접 정한 줄임말(lineup_works.short_title) ② 주요 콘텐츠 관리의 표시명(featured_content.display_name — 예: 카우몰)
//          ③ 프로그램 줄임말 사전(docs/iptv/program_abbrev.json, 2026-11-11 전체 훑어 정리) ④ 화면 약칭 규칙(programAlias.ts).
// 표시용일 뿐 키·집계는 바꾸지 않는다. 풀네임이 한 줄에 들어가면 호출부(캘린더)가 풀네임을 쓴다.
import abbrevFile from "../../../docs/iptv/program_abbrev.json";
import { shortProgramName } from "@/lib/programAlias";

/** 사전 키 규칙과 같다 — 공백·문장부호를 빼고 소문자. */
export const shortKey = (t: string) => t.toLowerCase().replace(/[\s,.·'"‘’“”~!?:\-()[\]<>]/g, "");

// provisional(사용자 확인 전 임시 줄임말)도 abbrev에 이미 들어 있다.
const DICT = new Map<string, string>(Object.entries((abbrevFile as { abbrev: Record<string, string> }).abbrev));

/** 주요 콘텐츠 표시명 목록 → 조회용(키: 원제목 정규화). 표시명이 원제목보다 짧을 때만 줄임말로 본다. */
export function featuredShortMap(rows: { name: string; displayName: string }[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of rows) if (r.displayName && shortKey(r.displayName).length < shortKey(r.name).length) m.set(shortKey(r.name), r.displayName.trim());
  return m;
}

/** 제목의 줄임말(없으면 null). 제목 표기가 조금 달라도(줄은 몰랐습니다만 ↔ 줄 몰랐습니다만) 앞 10글자가 같으면 같은 작품으로 본다. */
export function resolveShortTitle(title: string, featured: Map<string, string>): string | null {
  const k = shortKey(title);
  const exact = featured.get(k);
  if (exact) return exact;
  if (k.length >= 10) for (const [fk, v] of featured) if (fk.length >= 10 && fk.slice(0, 10) === k.slice(0, 10)) return v;
  const d = DICT.get(k);
  if (d) return d;
  const a = shortProgramName(title);
  return a !== title ? a : null;
}
