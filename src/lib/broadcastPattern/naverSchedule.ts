// 네이버 검색 상단 방송 정보 카드에서 본방 편성(채널·요일·시각)과 최근 회차(회차·방송일)를 읽는다(사용자 지시 2026-10-22).
// 순수 함수(네트워크·DB 접근 없음): HTML 해석, 제목 일치 판정, 네이버 채널 표기 → 자사 채널 코드.
// 카드의 "편성" 줄은 지금 방송 중인 본방 채널(동시 방송 포함)과 요일·시각을 준다(예: "SBS Plus, ENA 2021.07.14. ~ (수) 오후 10:30").
// 종영작은 요일·시각 없이 기간만 나온다. 회차 목록은 최신 몇 회(보통 6회)의 회차 번호와 방송일뿐이라, 그보다 오래된 회차를 추정하지 않는다.
import { sameProgram } from "@/lib/idealSchedule/genreNaver";

/** 요일: 0=월 … 6=일(달력 요일) */
export type Dow = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface NaverSlot {
  days: Dow[];
  /** 자정부터 분(0~1439) */
  minute: number;
}

export interface NaverEpisode {
  no: number;
  /** YYYY-MM-DD */
  date: string;
}

export interface NaverSchedule {
  title: string;
  /** 네이버가 적은 본방 채널 표기(동시 방송 포함) */
  channels: string[];
  startDate: string | null;
  /** 종영일 — 없으면 방송 중 */
  endDate: string | null;
  slots: NaverSlot[];
  /** 최신순 */
  episodes: NaverEpisode[];
}

const DOW_INDEX: Record<string, Dow> = { 월: 0, 화: 1, 수: 2, 목: 3, 금: 4, 토: 5, 일: 6 };
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;|&#39;|&apos;/g, "'").replace(/\s+/g, " ").trim();
const iso = (y: string, m: string, d: string) => `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;

/** "월~금"·"토, 일"·"월/수/금"·"매일" 같은 요일 표기를 요일 목록으로 */
export function parseDays(expr: string): Dow[] {
  const t = expr.replace(/\s+/g, "");
  if (/^매일$/.test(t)) return [0, 1, 2, 3, 4, 5, 6];
  const out = new Set<Dow>();
  for (const part of t.split(/[,·/]/)) {
    const range = /^([월화수목금토일])~([월화수목금토일])$/.exec(part);
    if (range) {
      let i = DOW_INDEX[range[1]];
      const end = DOW_INDEX[range[2]];
      for (let guard = 0; guard < 7; guard++) {
        out.add(i);
        if (i === end) break;
        i = ((i + 1) % 7) as Dow;
      }
      continue;
    }
    if (/^[월화수목금토일]$/.test(part)) out.add(DOW_INDEX[part]);
  }
  return [...out].sort((a, b) => a - b);
}

/** "오후 10:30" → 1350, "오전 12:30" → 30(자정 넘김) */
export function parseKoreanClock(ampm: string, hh: string, mm: string): number {
  let h = Number(hh) % 12;
  if (ampm === "오후") h += 12;
  return h * 60 + Number(mm);
}

/** 네이버 통합검색 결과의 방송 프로그램 카드를 읽는다. 카드나 "편성" 줄이 없으면 null. */
export function parseNaverSchedule(html: string): NaverSchedule | null {
  const t = /area_text_title[\s\S]{0,400}?<strong class="_text">([\s\S]*?)<\/strong>/.exec(html);
  if (!t) return null;
  const title = decode(t[1].replace(/<[^>]+>/g, ""));
  const row = /<dt>(?:<span[^>]*><\/span>)?\s*편성\s*<\/dt>\s*<dd>([\s\S]*?)<\/dd>/.exec(html);
  if (!title || !row) return null;
  const cell = row[1];
  const channels = [...cell.matchAll(/<a[^>]*>([^<]+)<\/a>/g)].map((m) => decode(m[1])).filter(Boolean);
  const text = decode(cell.replace(/<a[^>]*>[^<]*<\/a>/g, " ").replace(/<[^>]+>/g, " "));

  const range = /(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?\s*~\s*(?:(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2}))?/.exec(text);
  const startDate = range ? iso(range[1], range[2], range[3]) : null;
  const endDate = range && range[4] ? iso(range[4], range[5], range[6]) : null;

  // 같은 시각이 요일만 다르게 여러 줄로 나올 수 있다 — 같은 분이면 한 슬롯으로 합친다.
  const byMinute = new Map<number, Set<Dow>>();
  for (const m of text.matchAll(/\(([^)]*?)\)\s*(오전|오후)\s*(\d{1,2}):(\d{2})/g)) {
    const days = parseDays(m[1]);
    if (days.length === 0) continue;
    const minute = parseKoreanClock(m[2], m[3], m[4]);
    const set = byMinute.get(minute) ?? new Set<Dow>();
    for (const d of days) set.add(d);
    byMinute.set(minute, set);
  }
  const slots: NaverSlot[] = [...byMinute.entries()].map(([minute, set]) => ({ minute, days: [...set].sort((a, b) => a - b) }));

  // 회차 목록은 제목 카드 뒤쪽 영역에서만 읽는다(다른 카드의 회차와 섞이지 않게 한정)
  const after = html.slice(html.indexOf("area_text_title"));
  const seen = new Set<string>();
  const episodes: NaverEpisode[] = [];
  for (const m of after.slice(0, 120_000).matchAll(/<span class="num_txt">(\d+)<\/span>\s*회[\s\S]{0,300}?<span class="date_info">\s*(\d{4})\.(\d{1,2})\.(\d{1,2})/g)) {
    const date = iso(m[2], m[3], m[4]);
    if (seen.has(date)) continue;
    seen.add(date);
    episodes.push({ no: Number(m[1]), date });
  }
  episodes.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  return { title, channels: [...new Set(channels)], startDate, endDate, slots, episodes };
}

/**
 * 우리 쪽 프로그램명과 네이버가 찾은 제목이 같은 작품인가 — 공통 비교(sameProgram)에 더해
 * 네이버 제목 끝 괄호의 통용 약칭("나는 SOLO, 그 후 사랑은 계속된다(나솔사계)")도 인정한다.
 */
export function naverTitleMatches(programName: string, naverTitle: string): boolean {
  if (sameProgram(programName, naverTitle)) return true;
  const alias = /\(([^()]+)\)\s*$/.exec(naverTitle);
  return !!alias && sameProgram(programName, alias[1]);
}

const compact = (s: string) => s.replace(/[^가-힣a-zA-Z0-9]/g, "").toUpperCase();
const CHANNEL_ALIASES: Record<string, string> = {
  ENA: "ENA",
  ENA플레이: "ENA_PLAY",
  ENAPLAY: "ENA_PLAY",
  ENA스토리: "ENA_STORY",
  ENASTORY: "ENA_STORY",
  ENA드라마: "ENA_DRAMA",
  ENADRAMA: "ENA_DRAMA",
  OLIFE: "OLIFE",
  올라이프: "OLIFE",
  ONCE: "ONCE",
  원스: "ONCE",
  SKYUHD: "SKYUHD",
  스카이UHD: "SKYUHD",
};

/** 네이버 채널 표기 → 자사 채널 코드. 자사 채널이 아니면 null(예: SBS Plus). */
export function ownChannelCodeOf(label: string): string | null {
  return CHANNEL_ALIASES[compact(label)] ?? null;
}
