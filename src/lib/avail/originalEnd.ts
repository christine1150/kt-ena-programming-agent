// 원 방송 종영일(단계 06 후속, 2026-10-14) — "KBS 종영 후 1개 채널"·"후방 1개채널" 같은 메모를 '원 방송이 끝난 뒤부터 편성 가능'으로 읽는다.
// 순수 함수(네트워크·DB 접근 없음): 메모 문구 해석, 네이버 검색 결과 HTML 해석, 슬롯이 종영 전인지 판정.
// 종영일은 네이버에서 가져온 값(자동)을 기본으로 쓰고, 사람이 고친 값(수동)이 항상 우선한다. 다시 가져와도 수동 값은 덮어쓰지 않는다.
import { addDaysIso } from "./dates";
import { seasonNotationKey } from "./identity";
import { normalizeProgramCanonicalName } from "@/lib/programNameMatch";

// ── 메모 문구 해석 ───────────────────────────────────────

export interface AfterEndRule {
  /** 종영일로부터 더 기다려야 하는 일수(예: "종료 180일 후" = 180). 없으면 0 */
  offsetDays: number;
  /** 종영 후 방영할 수 있는 채널 수(문구에 있을 때). 판정에는 쓰지 않고 안내만 한다 */
  channelCount: number | null;
}

const BROADCASTER = "(?:KBSM|KBS|MBC|SBS|JTBC|TV조선|채널A|MBN|tvN|EBS)";
const AFTER_END = new RegExp(`^(?:${BROADCASTER}\\s*)?(?:종영\\s*후|후방)\\s*(\\d+)\\s*(?:개\\s*)?채널$`, "i");

/**
 * "{방송사} 종영 후 N개 채널" · "후방 N개채널" 꼴만 읽는다. 다른 조건이 섞인 문구("2개 채널 동시 편성 금지", "종영 후 ALL" 등)는 null — 사람이 확인해야 한다.
 * 괄호 안은 채널 지정·참고라 무시하되, "(SBS본방 종료 180일 후)"의 일수는 읽는다.
 */
export function parseAfterOriginalEnd(raw: string | null | undefined): AfterEndRule | null {
  if (!raw) return null;
  const t = raw.trim().replace(/\s+/g, " ");
  const bare = t.replace(/\([^)]*\)/g, "").trim();
  const m = AFTER_END.exec(bare);
  if (!m) return null;
  const off = /종료\s*(\d+)\s*일\s*후/.exec(t);
  return { offsetDays: off ? Number(off[1]) : 0, channelCount: Number(m[1]) };
}

// ── 종영일 저장 모델 ─────────────────────────────────────

export type OriginalEndSource = "naver" | "manual";
/** found = 종영일 있음 / ongoing = 방송 중이라 종영일 없음 / not_found = 검색 결과 없음 / review = 검색된 제목이 달라 사람이 확인해야 함 */
export type OriginalEndStatus = "found" | "ongoing" | "not_found" | "review";

export interface OriginalEnd {
  /** 권리 행의 content.canonicalKey */
  contentKey: string;
  titleRaw: string;
  source: OriginalEndSource;
  status: OriginalEndStatus;
  /** 원 방송사(네이버 편성 정보) */
  broadcaster: string | null;
  startDate: string | null;
  endDate: string | null;
  /** 네이버에서 실제로 찾은 제목(검색어와 비교해 사람이 확인) */
  matchedTitle: string | null;
  note: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
}

/** 판정에 쓸 수 있는 종영일인가 — 사람이 넣은 값, 또는 제목이 일치한 네이버 값(found)만 쓴다. review·not_found·ongoing은 쓰지 않는다. */
export function usableEndDate(e: OriginalEnd | undefined | null): string | null {
  if (!e || !e.endDate) return null;
  if (e.source === "manual") return e.endDate;
  return e.status === "found" ? e.endDate : null;
}

// ── 슬롯 판정 ────────────────────────────────────────────

export type EndGate =
  | { kind: "no_rule" }
  /** 종영일을 몰라 판정하지 못함(예: 방송 중·미조회·확인 필요) */
  | { kind: "end_unknown" }
  | { kind: "before_end"; availableFrom: string; endDate: string }
  | { kind: "after_end"; endDate: string; channelCount: number | null };

/** 종영일(포함) 다음 날 + 대기 일수부터 편성할 수 있다. 슬롯의 방송일이 그 전이면 아직 불가. */
export function gateAfterEnd(rule: AfterEndRule | null, endDate: string | null, broadcastDate: string): EndGate {
  if (!rule) return { kind: "no_rule" };
  if (!endDate) return { kind: "end_unknown" };
  const from = addDaysIso(endDate, 1 + rule.offsetDays);
  return broadcastDate >= from ? { kind: "after_end", endDate, channelCount: rule.channelCount } : { kind: "before_end", availableFrom: from, endDate };
}

// ── 네이버 검색 결과 해석 ────────────────────────────────

export interface NaverBroadcast {
  title: string;
  broadcaster: string | null;
  startDate: string | null;
  endDate: string | null;
}

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/\s+/g, " ").trim();
const iso = (y: string, m: string, d: string) => `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;

/**
 * 네이버 통합검색 결과의 방송 프로그램 카드(제목 + '편성' 줄)를 읽는다. 카드가 없거나 편성 줄이 없으면 null.
 * 편성 줄 예: "SBS 2025.11.21. ~ 2026.01.10. 16부작"(종영) / "MBC 2013.03.22. ~ "(방송 중, 종영일 없음).
 */
export function parseNaverBroadcast(html: string): NaverBroadcast | null {
  const t = /area_text_title[\s\S]{0,400}?<strong class="_text">([\s\S]*?)<\/strong>/.exec(html);
  if (!t) return null;
  const title = decode(t[1].replace(/<[^>]+>/g, ""));
  const row = /<dt>(?:<span[^>]*><\/span>)?\s*편성\s*<\/dt>\s*<dd>([\s\S]*?)<\/dd>/.exec(html);
  if (!title || !row) return null;
  const cell = row[1];
  const ch = /<a[^>]*>([^<]+)<\/a>/.exec(cell);
  const text = decode(cell.replace(/<a[^>]*>[^<]*<\/a>/g, " ").replace(/<[^>]+>/g, " "));
  const range = /(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?\s*~\s*(?:(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2}))?/.exec(text);
  if (!range) return { title, broadcaster: ch ? decode(ch[1]) : null, startDate: null, endDate: null };
  return { title, broadcaster: ch ? decode(ch[1]) : null, startDate: iso(range[1], range[2], range[3]), endDate: range[4] ? iso(range[4], range[5], range[6]) : null };
}

/** 검색어(권리 행 제목)와 네이버가 찾은 제목이 같은 작품인가 — 공백·문장부호·시즌 표기를 무시하고 비교 */
export function sameTitle(a: string, b: string): boolean {
  const k = (s: string) => seasonNotationKey(normalizeProgramCanonicalName(s));
  return k(a) === k(b);
}

/** 네이버 조회 결과를 저장 형태로 바꾼다. 제목이 다르면 review(자동으로 판정에 쓰지 않음). */
export function toOriginalEnd(contentKey: string, titleRaw: string, found: NaverBroadcast | null, now: string): OriginalEnd {
  const base = { contentKey, titleRaw, source: "naver" as const, note: null, updatedBy: "네이버 조회", updatedAt: now };
  if (!found) return { ...base, status: "not_found", broadcaster: null, startDate: null, endDate: null, matchedTitle: null };
  const status: OriginalEndStatus = !sameTitle(titleRaw, found.title) ? "review" : found.endDate ? "found" : "ongoing";
  return { ...base, status, broadcaster: found.broadcaster, startDate: found.startDate, endDate: found.endDate, matchedTitle: found.title };
}
