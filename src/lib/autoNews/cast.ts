// 출연자 이슈 분류 — 편성에 영향을 줄 수 있는 출연자 기사만 고른다(순수 함수, 네트워크·DB 없음).
// 사용자 지시 2026-11-15: 자사 오리지널 드라마·예능(지난 작품+방영 예정작) 출연자의 주요 기사는 반드시, 타사 작품 출연자도 일부,
// '나는 SOLO' 일반인 출연자 포함. 편성을 늘릴 근거(흥행·화제)와 빼야 할 근거(범죄·논란) 둘 다 대상이다.
import { CAST_RISK_CATEGORY, CAST_RISK_TERMS } from "./config";
import { stripPublisherSuffix, titleSimilarity, SAME_STORY, type NewsCandidate } from "./select";

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
export const RISE_TERMS = /시청률 (?:상승|급등|자체 최고|돌파)|화제성 1위|신드롬|흥행|역주행|시즌 ?2|후속 편성|스핀오프|차기작 확정|캐스팅 확정|주연 확정/;

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
  return out;
}

/** 제목이 위험·흥행 신호를 가지는지, 그리고 명단의 누구와 연결되는지 판단. 신호가 없거나 명단과 무관하면 null */
export function classifyCast(title: string, roster: CastEntry[]): { signal: CastSignal; entry: CastEntry } | null {
  const risk = RISK_TERMS.test(title);
  const rise = RISE_TERMS.test(title);
  if (!risk && !rise) return null;
  const byName = roster.filter((e) => e.scope !== "solo" && title.includes(e.name));
  // 같은 이름이 여러 작품에 걸리면 자사 작품·방영 예정을 우선
  const compact = title.replace(/\s/g, "");
  const hit = byName.sort((a, b) => SCOPE_WEIGHT[b.scope] - SCOPE_WEIGHT[a.scope])[0] ?? roster.find((e) => e.scope === "solo" && compact.includes(e.program.replace(/\s/g, "")));
  if (!hit) return null;
  // 타사 출연자는 흥행 기사까지는 싣지 않는다(위험 신호만)
  if (hit.scope === "other" && !risk) return null;
  return { signal: risk ? "risk" : "rise", entry: hit };
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
    if (out.some((o) => o.url === h.url || titleSimilarity(o.title, h.title) >= SAME_STORY)) continue;
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
