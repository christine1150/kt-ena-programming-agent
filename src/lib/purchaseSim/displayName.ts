// 작품 표시 이름 — 작품 묶음(program_identity.group_key) 하나에 화면 이름 하나를 정한다(2026-11-20 사용자 지시).
// 식별 키(정규화 키)는 건드리지 않고 "보이는 이름"만 고친다: 방송 태그(<재>·<본>) 제거, 시즌 표기 통일("시즌 4"·"S2"·꼬리 숫자 → "시즌N"),
// 사용자가 지정한 이름(원제 병기 등)은 그대로. 순수 함수.
import { normalizeProgramKey } from "./normalize";

/** 사용자 지정 표시 이름(작품 묶음 키 → 이름). 원제·부제 병기처럼 정규화 키가 바뀌는 표기는 여기서만 붙인다. */
export const WORK_DISPLAY_OVERRIDES: Readonly<Record<string, string>> = {
  [normalizeProgramKey("행동과학자의 사건파일 시즌1")]: "행동과학자의 사건파일 시즌1",
  [normalizeProgramKey("행동과학자의 사건파일 시즌2")]: "행동과학자의 사건파일 시즌2",
  [normalizeProgramKey("골든아워 시즌4")]: "골든아워 시즌4 (트랜스플랜트)",
  [normalizeProgramKey("대멸종: 최후의 생존자들")]: "대멸종: 최후의 생존자들 (서바이빙 어스)",
  // 시즌 번호 없이 적힌 묶음 = 시즌1(2026-11-20 판정, scripts/fix-program-identity-1120.mts 주석과 같은 근거)
  //  · 편성표 대조: 강철부대(skyUHD 편성표 '강철부대 시즌1')
  //  · 방영 순서: 시즌2 첫 방송 전에만 나온 이름 — 크래시(2 = 2026-11-16~), 재벌X형사(2024, 2 = 2026-08~), 효자촌(2024-08, 2 = 2025-11)
  //  · 같은 자료에서 다음 시즌만 번호를 붙이는 표기 — skyUHD(데드 드리프트·라자루스 프로젝트·프리티 하드 케이스·돌싱글즈·실버로맨스 홀로탈출),
  //    IPTV(스트리트 푸드 파이터·곽준빈의 세계 기사식당), 닐슨(부부클리닉 사랑과 전쟁·푸바오와 할부지)
  [normalizeProgramKey("강철부대")]: "강철부대 시즌1",
  [normalizeProgramKey("크래시")]: "크래시 시즌1",
  [normalizeProgramKey("재벌X형사")]: "재벌X형사 시즌1",
  [normalizeProgramKey("효자촌")]: "효자촌 시즌1",
  [normalizeProgramKey("데드 드리프트")]: "데드 드리프트 시즌1",
  [normalizeProgramKey("라자루스 프로젝트")]: "라자루스 프로젝트 시즌1",
  [normalizeProgramKey("프리티 하드 케이스")]: "프리티 하드 케이스 시즌1",
  [normalizeProgramKey("돌싱글즈")]: "돌싱글즈 시즌1",
  [normalizeProgramKey("실버로맨스 홀로탈출")]: "실버로맨스 홀로탈출 시즌1",
  [normalizeProgramKey("스트리트 푸드 파이터")]: "스트리트 푸드 파이터 시즌1",
  [normalizeProgramKey("곽준빈의 세계 기사식당")]: "곽준빈의 세계 기사식당 시즌1",
  [normalizeProgramKey("부부클리닉 사랑과 전쟁")]: "부부클리닉 사랑과 전쟁 시즌1",
  [normalizeProgramKey("푸바오와 할부지")]: "푸바오와 할부지 시즌1",
  // 닐슨 표기(지혜의숲프리미엄인문학강연토크쇼)가 시즌을 나누지 않아 IPTV 시즌별 이름(지혜의 숲·S2·3)을 한 작품으로 묶었다
  [normalizeProgramKey("지혜의 숲")]: "지혜의 숲 (시즌1~3)",
};

/** 꼬리 숫자가 시즌이 아니라 편·부 번호인 묶음 — 번호를 '시즌N'으로 바꾸지 않는다(연속 며칠 사이 2·3편으로 이어진 기획물). */
const NOT_SEASON_BASES = new Set(["싱싱장터라이브바른상회", "당신이있는그곳오페라하우스"]);

/** 정규화 키의 꼬리 시즌 번호 — "크래시2" → { base: "크래시", n: 2 }. 숫자 앞이 숫자면(38.5 → "385") 시즌으로 보지 않는다. */
export function trailingSeasonOf(key: string): { base: string; n: number } | null {
  const m = /^(.*[가-힣A-Za-z])(\d{1,2})$/.exec(key);
  // "…DAY1"·"…PART2"처럼 일차·편 번호인 꼬리는 시즌이 아니다(2025 KGMA DAY1·DAY2)
  if (!m || m[1].length < 2 || NOT_SEASON_BASES.has(m[1]) || /(DAY|PART|EP|VOL|편|부|회|화|차)$/i.test(m[1])) return null;
  return { base: m[1], n: Number(m[2]) };
}

/** 같은 작품의 다른 시즌 키가 있는가(base 그대로, base+다른 숫자, base+"시즌"+다른 숫자). keys 는 base 로 시작하는 식별 키 목록. */
export function hasSeasonSibling(key: string, keys: string[]): boolean {
  const t = trailingSeasonOf(key);
  if (!t) return false;
  return keys.some((k) => {
    if (k === key || !k.startsWith(t.base)) return false;
    const rest = k.slice(t.base.length);
    const m = /^(?:시즌)?(\d{1,2})?$/.exec(rest);
    return !!m && Number(m[1] ?? 0) !== t.n;
  });
}

/** 표시 이름 다듬기 — 방송 태그 제거, 공백 정리, "시즌 4" → "시즌4", 끝의 " S2" → " 시즌2". */
export function cleanDisplayName(s: string): string {
  return (s ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/시즌\s+(\d+)/g, "시즌$1")
    .replace(/\s[Ss](\d{1,2})$/, " 시즌$1");
}

export interface DisplayRow {
  key: string;
  display_name: string;
  airings_total?: number | null;
}

/**
 * 작품 묶음의 표시 이름. ① 사용자 지정 ② 묶음 대표 키의 이름(띄어쓰기 없는 닐슨 표기면 같은 키의 띄어 쓴 표기를 대신 씀)
 * ③ 대표 키가 "…시즌N"인데 이름에 시즌이 없으면 꼬리 숫자를 "시즌N"으로.
 */
export function workDisplayName(groupKey: string, rows: DisplayRow[], opts: { numberedSeason?: boolean } = {}): string {
  const over = WORK_DISPLAY_OVERRIDES[groupKey];
  if (over) return over;
  const rep = rows.find((r) => r.key === groupKey) ?? [...rows].sort((a, b) => (b.airings_total ?? 0) - (a.airings_total ?? 0))[0];
  if (!rep) return "";
  let name = cleanDisplayName(rep.display_name);
  if (!/\s/.test(name)) {
    const spaced = rows.map((r) => cleanDisplayName(r.display_name)).find((n) => /\s/.test(n) && normalizeProgramKey(n) === normalizeProgramKey(name));
    if (spaced) name = spaced;
  }
  const season = /시즌(\d+)$/.exec(groupKey);
  if (season && !/시즌/.test(name)) name = /\s?\d+$/.test(name) ? name.replace(/\s?\d+$/, ` 시즌${season[1]}`) : `${name} 시즌${season[1]}`;
  // ④ 다른 시즌이 따로 있는 "…N" 묶음(크래시2, 지구마불 세계여행 4)은 "… 시즌N"으로 — 호출부가 형제 시즌 키를 확인해 알려 준다
  const tail = trailingSeasonOf(groupKey);
  if (opts.numberedSeason && tail && !/시즌/.test(name) && /\d$/.test(name)) name = name.replace(/\s?\d{1,2}$/, ` 시즌${tail.n}`);
  return name;
}
