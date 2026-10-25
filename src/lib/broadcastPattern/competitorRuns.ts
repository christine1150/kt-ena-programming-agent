// 경쟁채널 프로그램의 본방 여부(사용자 지시 2026-10-25: "타 회사도 네이버 등을 통해서 본방송을 알 수 있는 것은 본이라고 적어줘").
// 순서: 닐슨 이름의 <본>·<재> 표시 > 네이버 방송 정보(program_naver_schedule)의 본방 채널·요일·시각. 둘 다 없으면 모름(null).
// 네이버 판정은 자사와 같은 규칙(inferRuns, 하루치라 시각을 학습하지 않고 패턴 시각 ±20분)을 쓰고, 본방 채널만 경쟁채널 표기로 맞춘다.
// 읽기 실패·테이블 없음은 보완 없음으로 조용히 넘어간다. DB 주입 — supabase를 직접 import하지 않는다.
import { normalizeProgramKey } from "@/lib/purchaseSim/normalize";
import { cleanProgramName, displayProgramName } from "@/lib/dashboard/marketTopPrograms";
import { inferRuns, type RunPattern } from "./inferRuns";
import type { NaverScheduleRow } from "./load";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (table: string) => any };

/** 닐슨 이름의 본/재 표시(괄호 안에 붙은 "…의시대<재>)"도 포함). 표시가 없으면 null. */
export function runTagOf(raw: string): boolean | null {
  if (/<\s*본\s*>/.test(raw)) return true;
  if (/<\s*재\s*>/.test(raw)) return false;
  return null;
}

// 몰아보기·스페셜 같은 편집본은 네이버가 본편 카드를 돌려줘 본편 시각으로 본방이 되어 버린다 — 검색·판정에서 뺀다(load.ts VARIANT와 같은 이유)
const VARIANT = /(몰아보기|스페셜|special|하이라이트|다시보기|감독판|요약|특집|재방송)/i;
const SLOT_PREFIX = /^(?:(?:월화|수목|금토|토일|주말|일일|아침|저녁|평일|월요|화요|수요|목요|금요|토요|일요)\s*)?(?:특별기획|미니시리즈|드라마|시리즈)\s*/;

/**
 * 경쟁채널 편성명 → 네이버 검색 제목. 채널명·편성 틀("금토드라마", "특별기획", "토일미니시리즈")을 떼고 작품명만 남긴다.
 * 예: "SBS금토드라마(닥터X하얀마피아의시대)" → "닥터X하얀마피아의시대", "TVN특별기획100일의거짓말" → "100일의거짓말". 편집본이면 null.
 */
export function competitorSearchTitle(channelName: string, raw: string): string | null {
  let t = displayProgramName(channelName, cleanProgramName(raw));
  if (VARIANT.test(t)) return null;
  const dash = /^([^-]*(?:드라마|시리즈|특별기획|극장))-(.+)$/.exec(t);
  if (dash) t = dash[2];
  for (let i = 0; i < 2; i++) {
    const rest = t.replace(SLOT_PREFIX, "");
    if (rest === t || rest.length < 2) break;
    t = rest;
  }
  t = t.trim();
  return t.length >= 2 ? t : null;
}

const CHANNEL_ALIASES: Record<string, string> = { TV조선: "TVCHOSUN", 티비조선: "TVCHOSUN", KBS2TV: "KBS2", KBS1TV: "KBS1", KBS제2: "KBS2", KBS제1: "KBS1" };
/** 경쟁채널명·네이버 채널 표기를 같은 열쇠로("TV CHOSUN" = "TV조선", "KBS 2TV" = "KBS2") */
export function competitorChannelKey(label: string): string {
  const k = label.replace(/[^가-힣a-zA-Z0-9]/g, "").toUpperCase();
  return CHANNEL_ALIASES[k] ?? k;
}

/** 네이버 저장 행 → 경쟁채널용 패턴(찾지 못한 작품은 null). 본방 채널은 네이버 표기 그대로(열쇠로 바꿔) 쓴다. */
export function competitorNaverPattern(row: NaverScheduleRow): RunPattern | null {
  if (row.status !== "found" || (row.slots ?? []).length === 0) return null;
  const codes = [...new Set((row.channels ?? []).map(competitorChannelKey).filter(Boolean))];
  if (codes.length === 0) return null;
  return { source: "naver", programKey: row.program_key, label: row.matched_title ?? row.title_raw, channelCodes: codes, slots: row.slots ?? [], startDate: row.start_date, endDate: row.end_date, episodes: row.episodes ?? [] };
}

export interface CompetitorAiring {
  channelName: string;
  programName: string;
  /** 방송일 YYYY-MM-DD */
  date: string;
  startTime: string;
}

/** 순수 판정 — airings와 같은 순서로 본방 여부(닐슨 표시 우선, 없으면 네이버 패턴, 모르면 null). */
export function competitorRuns(airings: CompetitorAiring[], rowsByKey: Map<string, NaverScheduleRow>): (boolean | null)[] {
  const out = airings.map((a) => runTagOf(a.programName));
  const byKey = new Map<string, number[]>();
  airings.forEach((a, i) => {
    if (out[i] !== null) return;
    const title = competitorSearchTitle(a.channelName, a.programName);
    if (!title) return;
    const key = normalizeProgramKey(title);
    byKey.set(key, [...(byKey.get(key) ?? []), i]);
  });
  for (const [key, idxs] of byKey) {
    const row = rowsByKey.get(key);
    const p = row ? competitorNaverPattern(row) : null;
    if (!p) continue;
    const { results } = inferRuns(
      idxs.map((i) => ({ channelCode: competitorChannelKey(airings[i].channelName), date: airings[i].date, startTime: airings[i].startTime })),
      [p],
      { learn: false }
    );
    idxs.forEach((i, j) => (out[i] = results[j].firstRun));
  }
  return out;
}

/** DB에서 필요한 네이버 행만 읽어 판정한다. 읽기에 실패하면 닐슨 표시만으로 판정한다. */
export async function competitorRunsFromDb(db: Db, airings: CompetitorAiring[]): Promise<(boolean | null)[]> {
  const keys = new Set<string>();
  for (const a of airings) {
    if (runTagOf(a.programName) !== null) continue;
    const t = competitorSearchTitle(a.channelName, a.programName);
    if (t) keys.add(normalizeProgramKey(t));
  }
  const rowsByKey = new Map<string, NaverScheduleRow>();
  try {
    const list = [...keys];
    for (let i = 0; i < list.length; i += 60) {
      const { data, error } = await db.from("program_naver_schedule").select("program_key, title_raw, status, matched_title, channels, start_date, end_date, slots, episodes, fetched_at").in("program_key", list.slice(i, i + 60)).eq("status", "found");
      if (error) throw error;
      for (const r of (data ?? []) as NaverScheduleRow[]) rowsByKey.set(r.program_key, r);
    }
  } catch {
    rowsByKey.clear();
  }
  return competitorRuns(airings, rowsByKey);
}
