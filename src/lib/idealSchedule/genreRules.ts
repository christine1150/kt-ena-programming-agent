// 장르 1차 규칙 분류(사용자 결정 2026-09-30: "규칙으로 1차 분류한 뒤 관리자가 보완").
// 자사·경쟁 프로그램 모두 장르 원천 데이터가 없어 제목 키워드(+ 주요 콘텐츠 분류)로만 분류한다.
// 확신할 수 없는 것은 억지로 넣지 않고 "미분류"로 남긴다(관리자 보완 대상). 관리자 수기값(MANUAL)은
// 항상 이 규칙보다 우선한다(program_genre_map).
import { normalizeProgramCanonicalName } from "@/lib/programNameMatch";
import { UNCLASSIFIED, type Genre } from "./types";

export type GenreSource = "FEATURED_CATEGORY" | "RULE_KEYWORD" | "RULE_CHANNEL" | "MANUAL"; // + DB의 'NONE'(미분류)

export interface GenreRuleResult {
  genre: Genre;
  source: GenreSource | null; // 미분류면 null
  note: string | null;
}

// 순서가 곧 우선순위다. "다큐영화 길 위의 인생"(OLIFE)은 제목에 "영화"가 있어도 다큐멘터리라
// (사용자 정정, 특선영화 집계 제외 규칙) 다큐 규칙을 영화보다 먼저 둔다.
const KEYWORD_RULES: { genre: Genre; pattern: RegExp; note: string }[] = [
  { genre: "뉴스·시사", pattern: /뉴스|NEWS|시사|토론|뉴스룸|브리핑|정치/i, note: "제목 키워드(뉴스·시사)" },
  // 여행(교양 중 여행 장르, 사용자 지시 2026-09-30) — 다큐·교양보다 먼저 판정
  { genre: "여행", pattern: /기행|걸어서|세계테마|여행|트래블|배낭|원정기|탐방/, note: "제목 키워드(여행)" },
  { genre: "다큐·교양", pattern: /다큐|인간극장|강연|특강|생로병사|교양|명의|자연인/, note: "제목 키워드(다큐·교양)" },
  // "쇼핑" 단독은 넣지 않는다 — 드라마 〈아이쇼핑〉(skyUHD) 같은 오분류가 생긴다.
  { genre: "홈쇼핑·기타", pattern: /홈쇼핑|정보광고|인포머셜/, note: "제목 키워드(쇼핑)" },
  // "중계"는 넣지 않는다(〈KBS중계석〉은 클래식·국악 공연). 영문 약어(EPL·MLB·UFC)는 공백이 제거된 영문
  // 제목 일부와 충돌해(예: FANSCHOICEPLUS → EPL) 넣지 않는다 — 2026-09-30 시드 검수에서 확인.
  { genre: "스포츠", pattern: /야구|축구|골프|배구|농구|KBO|K리그|스포츠|당구|볼링|씨름|테니스|레슬링|복싱/, note: "제목 키워드(스포츠)" },
  { genre: "영화", pattern: /영화|시네마|무비|MOVIE|극장판/i, note: "제목 키워드(영화)" },
  { genre: "애니·키즈", pattern: /애니|키즈|뽀로로|핑크퐁|어린이|만화|타요/, note: "제목 키워드(애니·키즈)" },
  // "콘서트"는 넣지 않는다 — 〈개그콘서트〉는 예능이다.
  { genre: "음악", pattern: /뮤직뱅크|음악중심|인기가요|엠카운트다운|쇼챔피언|가요무대|뮤직/, note: "제목 키워드(음악 방송)" },
  { genre: "드라마", pattern: /드라마|일일극|주말극|미니시리즈|시트콤/, note: "제목 키워드(드라마)" },
];

// 채널 성격 기본값(RULE_CHANNEL)은 두지 않는다 — 2026-09-30 시드 검수 결과 드라마 전문 채널
// (DRAMAcube·Dramax 등)도 〈삼시세끼〉·〈금쪽같은 내 새끼〉·〈노래자랑〉 같은 예능을 다수 편성해
// 채널명만으로 드라마로 분류하면 오분류가 많았다. 해당 프로그램은 미분류로 두고 관리자가 보완한다.

// 주요 콘텐츠 관리 분류 → 장르. "사업형"(브랜디드 프로그램)은 사용자 지시(2026-09-30)로 같은 이름의 장르로.
const FEATURED_CATEGORY_GENRE: Record<string, Genre> = {
  "오리지널 드라마": "오리지널 드라마",
  "오리지널드라마": "오리지널 드라마",
  "독점 예능": "예능",
  "독점예능": "예능",
  "오리지널 예능": "오리지널 예능",
  "오리지널예능": "오리지널 예능",
  "구매예능": "예능",
  "사업형": "사업형",
  "구매 예능": "예능",
};

export function genreFromFeaturedCategory(category: string | null | undefined): Genre | null {
  if (!category) return null;
  return FEATURED_CATEGORY_GENRE[category.trim()] ?? null;
}

/** 사용자 제공 skyUHD 장르표(2026-08-27, skyUhdCross.ts) 세부 표기 → 공통 장르. "실버"처럼 공통 장르로
 *  옮길 근거가 없는 표기는 미분류로 두고 원표기를 note에 남긴다. */
export function genreFromSkyUhdLabel(label: string): Genre {
  if (/오리지널 드라마/.test(label)) return "오리지널 드라마";
  if (/오리지널 예능/.test(label)) return "오리지널 예능";
  if (/드라마/.test(label)) return "드라마";
  if (/예능/.test(label)) return "예능";
  if (/여행/.test(label)) return "여행";
  return UNCLASSIFIED;
}

/** 규칙 분류. ownerKey는 자사 채널 코드 또는 경쟁채널명. */
export function classifyGenreByRule(programName: string, ownerKey: string): GenreRuleResult {
  const name = normalizeProgramCanonicalName(programName);
  for (const rule of KEYWORD_RULES) {
    if (rule.pattern.test(name)) return { genre: rule.genre, source: "RULE_KEYWORD", note: rule.note };
  }
  void ownerKey; // 채널 성격 규칙 제거 후에도 호출 계약(채널별 규칙 확장 여지)은 유지
  return { genre: UNCLASSIFIED, source: null, note: null };
}

/** 장르 조회 키(프로그램명 정규화). program_genre_map.canonical_name과 같은 규칙. */
export function genreKey(programName: string): string {
  return normalizeProgramCanonicalName(programName);
}

/** 장르 결정 순서: ① 같은 채널의 저장값 → ② 같은 이름의 자사 저장값(다른 자사 채널, 예: skyUHD 〈쯔양몇끼〉
 *  사용자 장르표를 ENA 방영분에도 적용) → ③ 같은 이름의 경쟁 저장값 → ④ 실행 시 규칙 분류(저장하지 않음).
 *  저장값 중 미분류(source=NONE)는 "값 없음"으로 보고 다음 단계로 넘어간다(loadGenreMap이 제외). */
export function resolveGenre(
  storedMap: Map<string, Genre>,
  scope: "OWN" | "COMPETITOR",
  ownerKey: string,
  programName: string
): Genre {
  const name = genreKey(programName);
  return (
    storedMap.get(`${scope}|${ownerKey}|${name}`) ??
    storedMap.get(`OWN|*|${name}`) ??
    storedMap.get(`COMPETITOR|*|${name}`) ??
    classifyGenreByRule(programName, ownerKey).genre
  );
}
