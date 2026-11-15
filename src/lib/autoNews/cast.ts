// 출연자 이슈 분류 — 편성에 영향을 줄 수 있는 출연자 기사만 고른다(순수 함수, 네트워크·DB 없음).
// 사용자 지시 2026-11-15: 자사 오리지널 드라마·예능(지난 작품+방영 예정작) 출연자의 주요 기사는 반드시, 타사 작품 출연자도 일부,
// '나는 SOLO' 일반인 출연자 포함. 편성을 늘릴 근거(흥행·화제)와 빼야 할 근거(범죄·논란) 둘 다 대상이다.
import { CAST_RISK_CATEGORY, CAST_RISK_TERMS } from "./config";
import { sameStory, stripPublisherSuffix, type NewsCandidate } from "./select";

export type CastScope = "own_upcoming" | "own_past" | "solo" | "other";

export interface CastEntry {
  /** 출연자 이름(일반인은 기수+별명 등 방송에서 쓰는 호칭) */
  name: string;
  /** 연결된 프로그램명 */
  program: string;
  scope: CastScope;
}

/** 편성을 줄이거나 빼야 할 근거가 되는 표현(범죄·논란) */
export const RISK_TERMS = CAST_RISK_TERMS;
/** 편성을 늘리거나 후속을 검토할 근거가 되는 표현(흥행·화제·후속) */
export const RISE_TERMS = /시청률 (?:상승|급등|자체 최고|돌파)|역대 최고|최고 시청률|최고 화제성|화제성 1위|신드롬|흥행|역주행|시즌 ?2|후속 편성|스핀오프|차기작 확정|캐스팅 확정|주연 확정/;

// 타사 작품 출연자는 이름 명단 없이 본다(사용자 결정 2026-11-15) — 논란 기사는 너무 많아 중대 사안 표현 + 방송 맥락이 함께 있을 때만,
// 흥행 기사는 '역대·자체 최고' 같은 기록 표현 + 방송 맥락이 함께 있을 때만 싣는다.
const OTHER_SEVERE = /혐의|입건|송치|기소|구속|음주운전|마약|학폭|폭행|사기|탈세|하차|활동 중단|피소|성추행|성희롱|도박|갑질/;
const OTHER_RECORD = /역대 최고|최고 시청률|자체 최고|최고 화제성|화제성 1위|신드롬|역주행/;
const BROADCAST_CONTEXT = /드라마|예능|출연|하차|방송|배우|MC|주연|시청률|화제성/;
/** 명단 이름이 걸렸을 때 연예인 기사로 볼 근거 낱말(정치·스포츠 동명이인 거르기) */
const ENT_CONTEXT = /드라마|예능|영화|출연|방송|배우|가수|아이돌|그룹|MC|주연|조연|시청률|화제성|연예|소속사|팬|컴백|앨범|유튜버|크리에이터|활동 중단|자숙|하차|촬영|작품|캐스팅|공연|무대|뮤지컬|래퍼|댄서|개그맨|코미디언|방송인|셰프|프로게이머|마술사/;
/** 명단에 없는 타사 작품 출연자 기사를 모으는 공통 항목 */
export const OTHER_ENTRY: CastEntry = { name: "", program: "타사 작품", scope: "other" };

const SCOPE_WEIGHT: Record<CastScope, number> = { own_upcoming: 6, own_past: 4, solo: 4, other: 1 };
/** 위험 신호는 기사 하나가 편성 판단을 바꾸므로 흥행 신호보다 앞에 둔다 */
const RISK_BONUS = 3;

export type CastSignal = "risk" | "rise";

export interface CastHit extends NewsCandidate {
  signal: CastSignal;
  entry: CastEntry;
  score: number;
}

/** 검색어: 자사 작품은 출연자 이름별(위험·흥행 두 갈래), 나는 SOLO는 프로그램 단위(일반인 이름을 따로 수집하지 않는다), 타사는 위험만 */
export function buildCastQueries(roster: CastEntry[]): { query: string; entry: CastEntry }[] {
  const out: { query: string; entry: CastEntry }[] = [];
  for (const e of roster) {
    if (e.scope === "solo") {
      out.push({ query: `${e.program} 논란`, entry: e }, { query: `${e.program} 출연자 화제`, entry: e });
    } else if (e.scope === "other") {
      out.push({ query: `${e.name} 논란 ${e.program}`, entry: e });
    } else {
      out.push({ query: `${e.name} 논란 의혹`, entry: e }, { query: `${e.name} ${e.program}`, entry: e });
    }
  }
  // 타사 작품 일반 검색(이름 명단 없음) — 중대 사안과 기록 경신 두 갈래
  for (const q of ["드라마 배우 입건 혐의", "예능 출연자 하차 논란", "방송인 음주운전 마약 혐의", "드라마 역대 최고 시청률 경신", "예능 최고 화제성 1위"]) out.push({ query: q, entry: OTHER_ENTRY });
  return out;
}

/** 제목에 이름이 '한 사람 이름으로' 들어 있는지 — 앞뒤가 다른 한글이면 다른 이름의 일부로 본다(이준 ≠ 이준석). 뒤에 붙는 조사 한 글자는 허용 */
export function nameInTitle(title: string, name: string): boolean {
  if (!name) return false;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![가-힣])${esc}(?:[이가은는을를의과와도만에]?(?![가-힣]))`).test(title);
}

/** 제목이 위험·흥행 신호를 가지는지, 그리고 명단의 누구와 연결되는지 판단. 신호가 없거나 명단과 무관하면 null */
export function classifyCast(rawTitle: string, roster: CastEntry[]): { signal: CastSignal; entry: CastEntry } | null {
  // '승하차'(교통 기사)가 출연자 '하차'로 잡히지 않게(2026-11-15 시험에서 발견)
  const title = rawTitle.replace(/승하차/g, "승차");
  const risk = RISK_TERMS.test(title);
  const rise = RISE_TERMS.test(title);
  if (!risk && !rise) return null;
  const compact = title.replace(/\s/g, "");
  // 동명이인(예: 출연자 김민석 ↔ 정치인 김민석) — 이름이 맞아도 연예·방송 맥락 낱말이나 작품명이 제목에 있어야 한다(2026-11-15 시험에서 발견)
  const entContext = ENT_CONTEXT.test(title);
  const byName = roster.filter((e) => e.scope !== "solo" && nameInTitle(title, e.name) && (entContext || compact.includes(e.program.replace(/\s/g, ""))));
  // 같은 이름이 여러 작품에 걸리면 자사 작품·방영 예정을 우선
  const hit = byName.sort((a, b) => SCOPE_WEIGHT[b.scope] - SCOPE_WEIGHT[a.scope])[0] ?? roster.find((e) => e.scope === "solo" && compact.includes(e.program.replace(/\s/g, "")));
  if (hit) return { signal: risk ? "risk" : "rise", entry: hit };
  // 명단 밖 — 타사 작품 출연자 일반 규칙(엄격한 조건)
  if (BROADCAST_CONTEXT.test(title)) {
    if (risk && OTHER_SEVERE.test(title)) return { signal: "risk", entry: OTHER_ENTRY };
    if (rise && OTHER_RECORD.test(title)) return { signal: "rise", entry: OTHER_ENTRY };
  }
  return null;
}

/** 후보 기사 → 출연자 이슈 목록(같은 소식 묶기, 점수순, 상한) */
export function pickCastIssues(cands: NewsCandidate[], roster: CastEntry[], quota: number): CastHit[] {
  const hits: CastHit[] = [];
  for (const c of cands) {
    const title = stripPublisherSuffix(c.title, c.publisher);
    const cls = classifyCast(title, roster);
    if (!cls) continue;
    hits.push({ ...c, title, signal: cls.signal, entry: cls.entry, score: SCOPE_WEIGHT[cls.entry.scope] + (cls.signal === "risk" ? RISK_BONUS : 0) });
  }
  hits.sort((a, b) => b.score - a.score || (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
  const out: CastHit[] = [];
  for (const h of hits) {
    if (out.some((o) => o.url === h.url || sameStory(o.title, h.title))) continue;
    out.push(h);
    if (out.length >= quota) break;
  }
  return out;
}

/** 화면에 나가는 제목 — 위험 기사는 사실 확정이 아님을 표시한다(헤드라인 그대로 + 확인 필요) */
export function castDisplayTitle(h: CastHit): string {
  return h.signal === "risk" ? `${h.title} (확인 필요)` : h.title;
}

export { CAST_RISK_CATEGORY };
