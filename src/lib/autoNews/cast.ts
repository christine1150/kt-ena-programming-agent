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

/** 지금 건강에 문제가 생긴 경우(출연·방송 일정에 바로 영향) — 사용자 지시(2026-11-15) */
const HEALTH_TERMS = /건강 이상|건강 악화|응급실|입원|수술|투병|쓰러져|쓰러진|활동 중단|휴식기|촬영 중단/;
/** 편성을 줄이거나 빼야 할 근거가 되는 표현(범죄·논란·건강 문제) */
export const RISK_TERMS = new RegExp(`${CAST_RISK_TERMS.source}|${HEALTH_TERMS.source}`);
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
/**
 * 중대 범죄 — 사용자 지시(2026-11-15): "음주운전 같은 중대한 범죄는 편성에서 바로 제외해야 하므로 출연자 이슈 맨 위로".
 * 자사·타사 구분보다 앞선다(타사 출연자라도 자사 채널 재방·구매 편성에 걸릴 수 있다).
 */
export const SEVERE_CRIME = /음주운전|음주 ?사고|뺑소니|마약|투약|대마|성추행|성폭행|성범죄|불법 ?촬영|폭행|상해|학폭|학교폭력|도박|사기|횡령|탈세|입건|송치|기소|구속|체포|실형|징역/;
const SEVERE_BONUS = 100;
/** 지난 사건 이후 활동 재개 표현 */
const COMEBACK = /딛고|씻(?:는다|고|어)|만에 (?:복귀|컴백)|자숙 (?:끝|후|딛)|(?:복귀|컴백)(?:한다|했다|작|무대)?\s*$/;
/**
 * 클릭용 짜깁기 출연자 기사 — 사용자 지시(2026-11-15): 낚시성 제목에 비해 내용이 별것 없는 기사(여러 스타의 지난 일을 묶은 ★들·[종합] 류,
 * 예: "활동 중단→대인기피증까지…이정재·이수경·이유비, 피부 질환에 발목 잡힌 ★들 [종합]")는 고르지 않는다.
 * 건강 기사 자체는 거르지 않는다(지금 건강에 문제가 생긴 한 사람의 기사는 싣는다). 기자 의견 꼬리표([TEN피플] 등)도 거르지 않는다.
 * 중대 범죄 기사는 이 거르기보다 앞선다(묶음 기사라도 범죄 사실이면 싣는다).
 */
export const CAST_LOW_VALUE = /\[종합\]|★|스타들|들의 (?:공통점|비밀|과거)|연예계 .{0,6}(?:모음|총정리)|충격 근황/;
/** 이름이 셋 이상 나열된 묶음 기사(A·B·C) */
const ROUNDUP_NAMES = /[가-힣]{2,4}[·,][가-힣]{2,4}[·,][가-힣]{2,4}/;
export function isLowValueCastTitle(title: string): boolean {
  if (SEVERE_CRIME.test(title)) return false;
  return CAST_LOW_VALUE.test(title) || ROUNDUP_NAMES.test(title);
}

/**
 * 방송 내용 리뷰 기사 — 사용자 지시(2026-11-17): "34기 광수, 진정성 의혹 터졌다…'방송쟁이 싫어져' 분량 욕심 일침 ('나솔')"처럼
 * 제목만 자극적이고 내용은 그 회차 줄거리를 정리한 기사는 실제 논란이 아니므로 출연자 이슈에서 뺀다.
 * 위험 낱말이 '논란·의혹'뿐이고(범죄·건강·하차·사과문 같은 실제 사건 낱말 없음) 회차 리뷰 표시나 방송 속 장면 낱말이 있을 때만 해당한다.
 */
const REAL_RISK = new RegExp(RISK_TERMS.source.split("|").filter((t) => t !== "논란" && t !== "의혹").join("|"));
/** 제목 끝 프로그램 꼬리표('나솔')·('나는 솔로')나 리뷰 꼬리표([어제TV]·[SC리뷰] 등) */
const RECAP_TAG = /\(\s*['‘’"“”][^)]{1,15}['‘’"“”]\s*\)\s*$|\[(?:어제\s?TV|TV\s?리뷰|SC\s?리뷰|TV\s?북마크|夜TV|TV\s?종합|리뷰)[^\]]*\]/;
/** 방송 속 장면을 옮길 때 쓰는 낱말(데이트·선택·분량·일침 등) */
const IN_SHOW = /진정성 의혹|분량|일침|데이트|최종 선택|선택(?:했|받|하)|플러팅|돌직구|직진|러브라인|삼각관계|신경전|기싸움|폭로전|방송쟁이|촬영 중 (?:갈등|언쟁)/;
export function isShowRecapRisk(title: string): boolean {
  // 토크쇼 발언 속 지난 하차 언급("남지현 하차 후 김혜윤 캐스팅 원했다 ('살롱드립')")은 새 사건이 아니다(2026-11-18)
  // 검색 결과 제목은 잘려 꼬리표가 없을 수 있어, 하차 뒤 후임 캐스팅을 다룬 문장이면 꼬리표 없이도 해당한다
  if (/하차 (?:후|이후)\s?\S+\s?(?:캐스팅|합류|발탁|투입)|하차한 뒤/.test(title) || (/하차 (?:후|이후)/.test(title) && RECAP_TAG.test(title))) return true;
  // 전임 하차·구설을 배경으로 후임의 활약을 칭찬하는 기사("윤보미 하차 후 '리액션 구설'…정혜성 MC 존재감")는 위험 기사가 아니다
  if (/하차 (?:후|이후)/.test(title) && /존재감|활약|호평|극찬|빛났|안착|맹활약|눈도장/.test(title)) return true;
  // 검색 결과 제목은 뒤가 잘려 칭찬 낱말이 안 보일 수 있다 — "A 하차 후 구설 휩싸였는데…B, …"처럼 앞 절이 배경이고 새 주어(B)가 이어지는 형태
  if (/하차 (?:후|이후)[^…]{0,25}는데…\s?[가-힣]{2,4},/.test(title)) return true;
  if (REAL_RISK.test(title)) return false;
  return RECAP_TAG.test(title) || IN_SHOW.test(title);
}

export type CastSignal = "risk" | "rise";

export interface CastHit extends NewsCandidate {
  signal: CastSignal;
  entry: CastEntry;
  score: number;
  /** 중대 범죄 기사(맨 위, '편성 제외 검토' 표시) */
  severe: boolean;
}

// 같은 사건 다른 기사 묶기용 — 제목 공통 낱말 중 사람 이름일 수 있는 것(3~4자, 흔한 업계 낱말 제외)
const NAME_STOP = new Set(["방송가", "드라마", "소속사", "예능에서", "예능서", "출연자", "시청자", "제작진", "음주운전", "초비상", "통편집", "사과문", "기자회견"]);
const nameTokens = (t: string) => new Set((t.match(/[가-힣]{3,4}/g) ?? []).filter((w) => !NAME_STOP.has(w) && !SEVERE_CRIME.test(w)));
/** 둘 다 위험 기사이고 같은 이름(3~4자 낱말)을 공유하면 같은 사건으로 본다 — 최예나 표절 의혹·해명 기사 2건이 함께 오른 사례(2026-11-17)로 중대 범죄 밖으로 넓힘 */
function sameIncident(a: CastHit, b: CastHit): boolean {
  if (a.signal !== "risk" || b.signal !== "risk") return false;
  // 같은 범죄 낱말(음주운전 등)을 다룬 위험 기사는 한 사건으로 — 제목에 이름이 없는 "음주운전 연예인 출연 제한 국회 청원" 기사가 고경표 기사와 함께 오른 사례(2026-11-18)
  const ca = a.title.match(SEVERE_CRIME)?.[0];
  if (ca && ca === b.title.match(SEVERE_CRIME)?.[0]) return true;
  const ta = nameTokens(a.title);
  for (const w of nameTokens(b.title)) if (ta.has(w)) return true;
  return false;
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
    if (isLowValueCastTitle(title)) continue;
    const cls = classifyCast(title, roster);
    if (!cls) continue;
    if (cls.signal === "risk" && isShowRecapRisk(title)) continue;
    // 지난 사건 뒤 복귀 기사("음주운전 논란 딛고 2년 만에 예능 복귀")는 새 범죄가 아니므로 '편성 제외 검토'가 아니라 '확인 필요',
    // 범죄가 아닌 지난 일을 넘어선 기사("하차 설움 씻는다…MC 발탁")는 흥행·화제 기사로 본다(표시 없음)
    const comeback = cls.signal === "risk" && COMEBACK.test(title);
    const signal: CastSignal = comeback && !SEVERE_CRIME.test(title) ? "rise" : cls.signal;
    const severe = signal === "risk" && SEVERE_CRIME.test(title) && !comeback;
    hits.push({ ...c, title, signal, entry: cls.entry, severe, score: (severe ? SEVERE_BONUS : 0) + SCOPE_WEIGHT[cls.entry.scope] + (signal === "risk" ? RISK_BONUS : 0) });
  }
  hits.sort((a, b) => b.score - a.score || (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
  const out: CastHit[] = [];
  for (const h of hits) {
    if (out.some((o) => o.url === h.url || sameStory(o.title, h.title) || sameIncident(o, h))) continue;
    out.push(h);
    if (out.length >= quota) break;
  }
  return out;
}

/** 제목 뒤 표시 — 중대 범죄는 편성 제외 검토, 그 밖의 위험 기사는 사실 확정이 아님을 알린다 */
export function castLabel(h: Pick<CastHit, "signal" | "severe">): string | null {
  if (h.severe) return "중대 사안 · 편성 제외 검토";
  return h.signal === "risk" ? "확인 필요" : null;
}

/** 화면에 나가는 제목 */
export function castDisplayTitle(h: CastHit): string {
  const label = castLabel(h);
  return label ? `${h.title} (${label})` : h.title;
}

export { CAST_RISK_CATEGORY };
