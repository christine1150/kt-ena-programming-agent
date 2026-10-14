// ENA 오리지널 본방 활용 권유의 순수 분류(DB·네트워크 없음) — 조회는 originalLeverage.ts. 설명은 그 파일 머리말 참고.
import { addDays } from "@/lib/idealSchedule/time";

/** 활용을 권유하는 채널(재방·편성 확대가 가능한 자매 채널) */
export const LEVERAGE_CHANNELS = new Set(["ENA_PLAY", "ENA_DRAMA", "ENA_STORY"]);
const ORIGINAL_CATEGORIES = new Set(["오리지널 드라마", "오리지널 예능"]);
/** 본방 종료 후에도 활용을 권하는 기간(일) — "본방송 +1주" */
export const AFTER_END_DAYS = 7;
/** 아직 시작 전인 작품을 "예정"으로 알리는 범위(일) */
export const UPCOMING_DAYS = 14;
/** 활용 권유 기준: 정식 판정은 슬롯 대비·시청 규모가 둘 다 1.0배 이상, 참고(표본 적음)는 규모 1.0배 이상이고 슬롯 대비 0.85배 이상 */
export const USE_MIN = { formalSlot: 1.0, formalScale: 1.0, refSlot: 0.85, refScale: 1.0 };

export interface OriginalSpecLite {
  programId: string;
  programName: string;
  category: string;
  activeFrom: string | null;
  activeTo: string | null;
}
export interface OriginalFitLite {
  programId: string;
  tier: "FORMAL" | "REFERENCE" | "HOLD";
  tag: string | null;
  slotIndex: number | null;
  scaleIndex: number | null;
  score: number | null;
}
export interface OriginalUse {
  name: string;
  category: string;
  /** fit: 정식 판정으로 효율 확인 / test: 방영 초반(표본 적음)이라 시험 성격 / upcoming: 아직 시작 전 */
  verdict: "fit" | "test" | "upcoming";
  status: "진행" | "종영 직후" | "예정";
  start: string | null;
  slotIndex: number | null;
  scaleIndex: number | null;
}
export interface OriginalLeverage {
  use: OriginalUse[];
  /** ENA에서 효율이 기대에 못 미치는 진행 중 오리지널 — 이 채널이 재방을 편성하고 있다면 줄이라고 조언할 대상(슬롯 대비 배수 포함) */
  weak: { name: string; slotIndex: number | null }[];
}
export type OriginalLeverageView = OriginalLeverage;

/** 순수 분류 — 진행/종영 직후/예정 작품을 ENA 본방 적합도로 활용·부진으로 나눈다. */
export function classifyOriginals(specs: OriginalSpecLite[], fits: OriginalFitLite[], asOf: string): { use: OriginalUse[]; weak: { name: string; slotIndex: number | null }[] } {
  const fitOf = new Map(fits.map((f) => [f.programId, f]));
  const seen = new Set<string>();
  const use: (OriginalUse & { rank: number })[] = [];
  const weak: { name: string; slotIndex: number | null }[] = [];
  for (const s of specs) {
    if (!ORIGINAL_CATEGORIES.has(s.category) || !s.activeFrom || seen.has(s.programId)) continue;
    const started = s.activeFrom <= asOf;
    const ended = s.activeTo !== null && s.activeTo < asOf;
    const withinAfter = s.activeTo === null || addDays(s.activeTo, AFTER_END_DAYS) >= asOf;
    if (started && !withinAfter) continue; // 종영 +1주를 넘김
    const upcoming = !started && s.activeFrom <= addDays(asOf, UPCOMING_DAYS);
    if (!started && !upcoming) continue;
    seen.add(s.programId);
    const status: OriginalUse["status"] = upcoming ? "예정" : ended ? "종영 직후" : "진행";
    const f = fitOf.get(s.programId);
    if (upcoming) {
      use.push({ name: s.programName, category: s.category, verdict: "upcoming", status, start: s.activeFrom, slotIndex: null, scaleIndex: null, rank: -1 });
      continue;
    }
    if (!f || f.tier === "HOLD") continue; // 판단 보류 — 권유도 부진 코멘트도 하지 않는다
    const L = f.slotIndex ?? 0;
    const A = f.scaleIndex ?? 0;
    if (f.tier === "FORMAL" && L >= USE_MIN.formalSlot && A >= USE_MIN.formalScale) {
      use.push({ name: s.programName, category: s.category, verdict: "fit", status, start: null, slotIndex: L, scaleIndex: A, rank: 1000 + (f.score ?? 0) });
    } else if (f.tier === "REFERENCE" && A >= USE_MIN.refScale && L >= USE_MIN.refSlot) {
      use.push({ name: s.programName, category: s.category, verdict: "test", status, start: null, slotIndex: L, scaleIndex: A, rank: f.score ?? 0 });
    } else if (f.tier === "FORMAL" && (f.tag === "REPLACE" || f.tag === "WATCH")) {
      weak.push({ name: s.programName, slotIndex: f.slotIndex });
    }
  }
  use.sort((a, b) => b.rank - a.rank);
  return { use: use.map((u) => ({ name: u.name, category: u.category, verdict: u.verdict, status: u.status, start: u.start, slotIndex: u.slotIndex, scaleIndex: u.scaleIndex })), weak };
}

/**
 * 채널 성격에 맞춰 권유 순서를 정한다 — ENA Drama는 오리지널 드라마, 그 밖(Play·Story)은 오리지널 예능을 먼저 보되,
 * 두 분류에서 각각 가장 효율 좋은 작품 하나씩을 앞에 두고 나머지는 효율 순으로 채운다(같은 분류가 줄줄이 나오지 않게). 최대 3개.
 */
export function pickForChannel(use: OriginalUse[], channelCode: string): OriginalUse[] {
  const first = channelCode === "ENA_DRAMA" ? "오리지널 드라마" : "오리지널 예능";
  const second = first === "오리지널 드라마" ? "오리지널 예능" : "오리지널 드라마";
  const head = [use.find((u) => u.category === first), use.find((u) => u.category === second)].filter((u): u is OriginalUse => !!u);
  const rest = use.filter((u) => !head.includes(u));
  return [...head, ...rest].slice(0, 3);
}
