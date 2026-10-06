// 1페이지 "해당일 상위 프로그램 TOP 12"(2026-10-06 사용자 지시, 2026-10-07 9개→12개) — 순수 함수.
// 기준: 그날 수도권 개인2049 채널 순위 1~20위 채널의 프로그램(뉴스 제외)을 수도권 2049 시청률 높은 순으로 12개(괄호 안은 유료방송가구).
// 새 지표를 계산하지 않는다 — 저장된 프로그램 시청률을 골라 정렬할 뿐이다. 프로그램 단위 자료가 없는 채널은 후보에 들 수 없다(자료 범위는 화면에 밝힌다).
import { broadcastHour } from "@/lib/workspace/dates";

export const TOP_PROGRAM_LIMIT = 12;
export const CHANNEL_RANK_LIMIT = 20;

export type TargetKind = "p2049" | "household" | "other";

/** 타깃 라벨 → 구분. 시트마다 표기가 달라("개인2049", "수도권 2049", "유료방송가구", "전국 유료가구") 표기 차이만 흡수한다. */
export function classifyTargetLabel(label: string | null | undefined): TargetKind {
  const t = (label ?? "").replace(/\s+/g, "");
  if (/^(수도권)?(개인)?2049$/.test(t)) return "p2049";
  if (t.includes("가구")) return "household";
  return "other";
}

/** 뉴스 프로그램 여부(사용자 지시 2026-10-07: 뉴스는 제외하고 계산). 장르 자료가 없는 경쟁채널까지 같은 기준으로 거르려고 프로그램명으로 판정한다("뉴스데스크", "SBS8뉴스", "KBS9시뉴스", "뉴스룸" 등). */
export const isNewsProgram = (name: string): boolean => /뉴스|news/i.test(name);

/** 프로그램명에서 본/재 표시를 걷어낸다(회차·부제는 이 화면에서 쓰지 않는다). */
export function cleanProgramName(raw: string): string {
  return raw.replace(/<\s*[본재]\s*>/g, "").replace(/\s+/g, " ").trim();
}

// 채널명과 프로그램명 앞머리가 겹치는 경우를 정리한다(사용자 지시 2026-10-07): 칩에 채널명이 이미 있는데 프로그램명도 "KBS1일일드라마(엄마가미쳤어요)"처럼
// 채널명으로 시작하면, 채널명을 떼고 "일일드라마-엄마가미쳤어요"로 줄인다. 채널명이 겹칠 때만 괄호를 "-"로 바꾸고, 겹치지 않는 이름은 그대로 둔다.
// 영문 채널명의 한글 표기("TV CHOSUN" ↔ "TV조선")도 같은 채널명으로 본다.
const CHANNEL_NAME_ALIASES: Record<string, string[]> = { "tvchosun": ["TV조선", "티비조선"], "채널a": ["채널A"] };
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function displayProgramName(channelName: string, programName: string): string {
  const key = channelName.replace(/\s+/g, "").toLowerCase();
  const candidates = [channelName, ...(CHANNEL_NAME_ALIASES[key] ?? [])].map((c) => c.replace(/\s+/g, "")).filter(Boolean).sort((a, b) => b.length - a.length);
  for (const c of candidates) {
    // 글자 사이 공백이 있어도("TV 조선") 같은 이름으로 본다.
    const re = new RegExp("^" + [...c].map(escapeRe).join("\\s*") + "\\s*", "i");
    const m = programName.match(re);
    if (!m) continue;
    const rest = programName.slice(m[0].length).trim();
    if (!rest) return programName;
    const open = rest.indexOf("(");
    if (open > 0) {
      const base = rest.slice(0, open).trim();
      const inner = rest.slice(open + 1).replace(/\)\s*$/, "").trim();
      if (base && inner) return `${base}-${inner}`;
    }
    return rest;
  }
  return programName;
}

/** 시작 시각 표기 — 이 앱의 방송일 관행(02~26시): 새벽 0~1시대는 24~25시로 이어서 쓴다. 예: "21:10", "24:35". */
export function displayStartTime(startTime: string | null | undefined): string {
  if (!startTime || !/^\d{2}:\d{2}/.test(startTime)) return "";
  return `${String(broadcastHour(startTime)).padStart(2, "0")}:${startTime.slice(3, 5)}`;
}

export interface ProgramSample {
  channelName: string;
  /** 자사 채널이면 true */
  own: boolean;
  /** 그날 수도권 개인2049 채널 순위 */
  channelRank: number;
  programName: string;
  startTime: string;
  target: TargetKind;
  rating: number | null;
}

export interface TopProgramRow {
  rank: number;
  channelName: string;
  own: boolean;
  channelRank: number;
  programName: string;
  /** 표시용 시작 시각("21:10") */
  startTime: string;
  /** 수도권 개인2049 시청률 */
  rating: number;
  /** 같은 프로그램의 유료방송가구 시청률(없으면 null) */
  householdRating: number | null;
}

/**
 * 프로그램 표본(타깃별 1행)을 (채널·시작·프로그램)로 묶어 2049 시청률 순 상위 N개를 고른다.
 * 채널 순위가 한도(기본 20) 밖이거나 2049 시청률이 없는 프로그램은 후보에서 뺀다. 같은 시청률이면 채널 순위가 높은(숫자가 작은) 쪽, 그다음 이름순.
 */
export function pickTopPrograms(samples: ProgramSample[], limit = TOP_PROGRAM_LIMIT, rankLimit = CHANNEL_RANK_LIMIT): TopProgramRow[] {
  const byKey = new Map<string, { base: ProgramSample; p2049: number | null; hh: number | null }>();
  for (const s of samples) {
    if (s.target === "other") continue;
    if (!(s.channelRank >= 1 && s.channelRank <= rankLimit)) continue;
    const name = cleanProgramName(s.programName);
    if (!name || isNewsProgram(name)) continue; // 뉴스는 순위 계산에서 뺀다(빠진 자리는 다음 프로그램이 채운다)
    const key = `${s.channelName}|${s.startTime.slice(0, 5)}|${name}`;
    const cur = byKey.get(key) ?? { base: { ...s, programName: name }, p2049: null, hh: null };
    if (s.target === "p2049") cur.p2049 = s.rating;
    else cur.hh = s.rating;
    byKey.set(key, cur);
  }
  const rows = [...byKey.values()]
    .filter((v) => v.p2049 !== null && Number.isFinite(v.p2049))
    .sort((a, b) => (b.p2049 as number) - (a.p2049 as number) || a.base.channelRank - b.base.channelRank || a.base.programName.localeCompare(b.base.programName, "ko"));
  return rows.slice(0, Math.max(0, limit)).map((v, i) => ({
    rank: i + 1,
    channelName: v.base.channelName,
    own: v.base.own,
    channelRank: v.base.channelRank,
    programName: v.base.programName,
    startTime: displayStartTime(v.base.startTime),
    rating: v.p2049 as number,
    householdRating: v.hh !== null && Number.isFinite(v.hh) ? v.hh : null,
  }));
}

/** 시청률 표기: 일반 채널은 소수 셋째 자리까지(앱의 기존 표기). */
export function formatRating(v: number | null | undefined): string {
  return v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toFixed(3);
}
