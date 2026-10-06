// 1페이지 "해당일 상위 프로그램 TOP 9"(2026-10-06 사용자 지시) — 순수 함수.
// 기준: 그날 수도권 개인2049 채널 순위 1~20위 채널의 프로그램을 수도권 2049 시청률 높은 순으로 9개(괄호 안은 유료방송가구).
// 새 지표를 계산하지 않는다 — 저장된 프로그램 시청률을 골라 정렬할 뿐이다. 프로그램 단위 자료가 없는 채널은 후보에 들 수 없다(자료 범위는 화면에 밝힌다).
import { broadcastHour } from "@/lib/workspace/dates";

export const TOP_PROGRAM_LIMIT = 9;
export const CHANNEL_RANK_LIMIT = 20;

export type TargetKind = "p2049" | "household" | "other";

/** 타깃 라벨 → 구분. 시트마다 표기가 달라("개인2049", "수도권 2049", "유료방송가구", "전국 유료가구") 표기 차이만 흡수한다. */
export function classifyTargetLabel(label: string | null | undefined): TargetKind {
  const t = (label ?? "").replace(/\s+/g, "");
  if (/^(수도권)?(개인)?2049$/.test(t)) return "p2049";
  if (t.includes("가구")) return "household";
  return "other";
}

/** 프로그램명에서 본/재 표시를 걷어낸다(회차·부제는 이 화면에서 쓰지 않는다). */
export function cleanProgramName(raw: string): string {
  return raw.replace(/<\s*[본재]\s*>/g, "").replace(/\s+/g, " ").trim();
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
    if (!name) continue;
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
