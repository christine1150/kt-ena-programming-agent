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
};

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
export function workDisplayName(groupKey: string, rows: DisplayRow[]): string {
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
  return name;
}
