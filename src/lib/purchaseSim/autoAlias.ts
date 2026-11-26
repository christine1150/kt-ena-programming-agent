// 작품 이름 변형 자동 묶기(2026-11-27 사용자 지시: "오타나 비슷한 타이틀(영문, 띄어쓰기, 부제)이면 찾아서 같은 콘텐츠로 묶어 계산").
// 띄어쓰기·문장부호·영문 대소문자는 정규화 키(normalizeProgramKey)가 이미 지운다. 여기서는 키가 달라지는 세 가지를 찾는다.
//   ① 부제·회차명 꼬리 — "신인감독김연경2" + "스페셜"·"프리퀄원더독스의시작"·"복수혈전"
//   ② 앞에 붙은 기획 꼬리표 — "추석특집" + "전지적참견시점", "황금어장" + "라디오스타"
//   ③ 한 글자 오타 — "서인형의유행꼰대" ↔ "서인영의유행꼰대"
// 잘못 묶지 않게 지키는 조건(전 작품 후보 1,669쌍을 직접 훑어 정함):
//   · 같은 채널에서 방영했고, 변형 이름은 본 작품 방영 기간(시작 30일 전 ~ 끝 60일 뒤) 안에서만 나왔다 — 몇 해 뒤 같은 이름을 쓴 다른 기획은 빠진다.
//   · 꼬리가 숫자·시즌·PART·리턴즈·외전으로 시작하면 다른 시즌·속편이라 묶지 않는다("신인감독김연경" ↔ "…2").
//   · 영화·스포츠·다큐 편성틀(MBN스페셜무비, KBS스포츠, 특집다큐 등)은 안에 든 작품이 서로 다른 콘텐츠라 묶음의 중심으로 쓰지 않는다.
//   · 꼬리 자체가 따로 있는 작품 이름이면(편성틀 + 다른 작품) 그 작품 쪽 문제라 여기서 묶지 않는다.
//   · 오타는 같은 길이 한 글자 차이(한글끼리)이고 드문 쪽이 5회 이하·많은 쪽의 20% 이하일 때만 — "연애의참견 ↔ 연애의발견"처럼 둘 다 많이 방영한 별개 작품은 빠진다.
// 순수 함수(입력 행 → 별칭 목록). DB 쓰기는 applyAutoAliases 가 한다.
import type { SupabaseClient } from "@supabase/supabase-js";

export interface AliasSourceRow {
  key: string;
  group_key: string;
  own_channels: string[] | null;
  comp_channels: string[] | null;
  airings_total: number | null;
  first_date: string | null;
  last_date: string | null;
}

export type AutoAliasRule = "auto_subtitle" | "auto_label_prefix" | "auto_typo";

export interface AutoAlias {
  aliasKey: string;
  groupKey: string;
  rule: AutoAliasRule;
  note: string;
}

/** 안에 서로 다른 콘텐츠가 들어가는 편성틀 이름 — 묶음의 중심(대표 키)으로 쓰지 않는다. */
const UMBRELLA_RE = /^(?:특집다큐H?|특선다큐|설특선다큐|추석특선다큐|특선영화|설특선영화|추석특선영화|MBN스페셜무비|MBN특집영화|채널A특별기획|KBS스포츠|SBS스포츠|MBC스포츠|다큐플러스|다큐플러스스페셜|다큐플러스Q스페셜|다큐플러스Q특별판|60분드라마|특집|스페셜|미리보기|앙코르|설특집|추석특집)$/;

/** 이 꼬리로 시작하면 다른 시즌·속편·외전이다. */
const SEQUEL_TAIL_RE = /^(?:\d|시즌|SEASON|PART|파트|리턴즈|RETURNS|외전|번외|비긴즈)/;

/** 별개 작품으로 확인된 쌍(변형 → 대표). 이름이 이어져도 묶지 않는다. */
const NOT_SAME_WORK = new Set<string>([
  "나는SOLO그후사랑은계속된다|나는SOLO", // 같은 날 다른 시각에 따로 편성되는 별개 프로그램(2026-11-19 대조)
  "미스트롯3갈라쇼|미스터트롯3갈라쇼",
  "미스터트롯3갈라쇼|미스트롯3갈라쇼",
  "JTBC뉴스속보|JTBC뉴스특보", // 속보·특보는 다른 편성
  "JTBC뉴스특보|JTBC뉴스속보",
]);

const MIN_ROOT_LEN = 4;
const dayDiff = (a: string, b: string) => (Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000;
const chans = (r: AliasSourceRow) => [...(r.own_channels ?? []), ...(r.comp_channels ?? [])];
const shareChannel = (a: AliasSourceRow, b: AliasSourceRow) => {
  const s = new Set(chans(a));
  return chans(b).some((c) => s.has(c));
};
/** 변형(b)이 대표(a)의 방영 기간 안에서만 나왔는가 */
const withinRun = (variant: AliasSourceRow, main: AliasSourceRow) =>
  !!variant.first_date && !!variant.last_date && !!main.first_date && !!main.last_date &&
  dayDiff(variant.first_date, main.first_date) >= -30 && dayDiff(variant.last_date, main.last_date) <= 60;

function oneCharSubstitution(a: string, b: string): number {
  if (a.length !== b.length) return -1;
  let at = -1;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    if (at >= 0) return -1;
    at = i;
  }
  return at;
}

/** 자동 별칭 찾기. 이미 다른 묶음에 들어간 키·이미 별칭이 걸린 키(existingAliasKeys)는 건드리지 않는다. */
export function findAutoAliases(rows: AliasSourceRow[], existingAliasKeys: Set<string> = new Set()): AutoAlias[] {
  // 묶음 대표(자기 자신이 대표인 키)만 양쪽 후보로 쓴다 — 사람이 정한 묶음을 다시 흔들지 않는다
  const roots = rows.filter((r) => r.group_key === r.key && !existingAliasKeys.has(r.key));
  const rootSet = new Set(roots.map((r) => r.key));
  const centers = roots.filter((r) => r.key.length >= MIN_ROOT_LEN && !UMBRELLA_RE.test(r.key));
  const out = new Map<string, AutoAlias>();
  const ok = (v: AliasSourceRow, m: AliasSourceRow) => !NOT_SAME_WORK.has(`${v.key}|${m.key}`) && shareChannel(v, m) && withinRun(v, m);

  for (const v of roots) {
    // ① 부제 꼬리 — 가장 긴 접두 대표를 고른다("신인감독김연경2스페셜" → "신인감독김연경2", "신인감독김연경" 아님)
    let best: AliasSourceRow | null = null;
    for (const m of centers) {
      if (m.key === v.key || !v.key.startsWith(m.key)) continue;
      if (!best || m.key.length > best.key.length) best = m;
    }
    if (best) {
      const tail = v.key.slice(best.key.length);
      if (!SEQUEL_TAIL_RE.test(tail) && !(tail.length >= 3 && rootSet.has(tail)) && ok(v, best)) {
        out.set(v.key, { aliasKey: v.key, groupKey: best.key, rule: "auto_subtitle", note: `부제·회차명 꼬리("${tail}") — 같은 채널·본 작품 방영 기간 안` });
        continue;
      }
    }
    // ② 앞 기획 꼬리표 — 가장 긴 접미 대표
    let suf: AliasSourceRow | null = null;
    for (const m of centers) {
      if (m.key === v.key || !v.key.endsWith(m.key)) continue;
      if (!suf || m.key.length > suf.key.length) suf = m;
    }
    if (suf) {
      const head = v.key.slice(0, v.key.length - suf.key.length);
      if (!(head.length >= 3 && rootSet.has(head) && !UMBRELLA_RE.test(head)) && ok(v, suf)) {
        out.set(v.key, { aliasKey: v.key, groupKey: suf.key, rule: "auto_label_prefix", note: `앞 기획 꼬리표("${head}") — 같은 채널·본 작품 방영 기간 안` });
        continue;
      }
    }
  }

  // ③ 한 글자 오타 — 드문 쪽을 많은 쪽에 붙인다
  const byLen = new Map<number, AliasSourceRow[]>();
  for (const r of centers) byLen.set(r.key.length, [...(byLen.get(r.key.length) ?? []), r]);
  for (const list of byLen.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        const at = oneCharSubstitution(a.key, b.key);
        if (at < 0 || !/[가-힣]/.test(a.key[at]) || !/[가-힣]/.test(b.key[at])) continue;
        const [rare, main] = (a.airings_total ?? 0) <= (b.airings_total ?? 0) ? [a, b] : [b, a];
        const nr = rare.airings_total ?? 0, nm = main.airings_total ?? 0;
        if (nr > 5 || nr > nm * 0.2 || out.has(rare.key) || out.has(main.key)) continue;
        if (!ok(rare, main)) continue;
        out.set(rare.key, { aliasKey: rare.key, groupKey: main.key, rule: "auto_typo", note: `한 글자 오타("${rare.key[at]}"↔"${main.key[at]}") — 드문 표기, 같은 채널·같은 방영 기간` });
      }
    }
  }
  // 대표로 쓰인 키가 다시 다른 키의 별칭이 되면 끝 대표로 옮긴다(체인 정리)
  for (const a of out.values()) {
    let g = a.groupKey;
    for (let k = 0; k < 5 && out.has(g); k++) g = out.get(g)!.groupKey;
    a.groupKey = g;
  }
  return [...out.values()].filter((a) => a.aliasKey !== a.groupKey).sort((x, y) => x.aliasKey.localeCompare(y.aliasKey));
}

/**
 * 운영 DB에 자동 별칭을 반영한다 — program_identity 전체를 읽어 findAutoAliases → program_alias 에 confirmed·RULE_AUTO 로 추가
 * (이미 있는 별칭은 그대로) → 새 별칭을 대표로 가리키던 별칭을 끝 대표로 옮김 → apply_program_aliases.
 * 관리자가 지운 자동 별칭이 다시 생기지 않게 하려면 NOT_SAME_WORK 에 넣는다.
 */
export async function applyAutoAliases(db: SupabaseClient, opts: { dryRun?: boolean } = {}): Promise<{ added: AutoAlias[]; repointed: number }> {
  const rows: AliasSourceRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("program_identity").select("key, group_key, own_channels, comp_channels, airings_total, first_date, last_date").order("key").range(from, from + 999);
    if (error) throw new Error(`작품 식별 조회 실패: ${error.message}`);
    rows.push(...((data ?? []) as AliasSourceRow[]));
    if (!data || data.length < 1000) break;
  }
  const existing = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("program_alias").select("alias_key").order("alias_key").range(from, from + 999);
    if (error) throw new Error(`별칭 조회 실패: ${error.message}`);
    for (const r of (data ?? []) as { alias_key: string }[]) existing.add(r.alias_key);
    if (!data || data.length < 1000) break;
  }
  const added = findAutoAliases(rows, existing);
  if (opts.dryRun || added.length === 0) return { added, repointed: 0 };
  for (let i = 0; i < added.length; i += 200) {
    const part = added.slice(i, i + 200).map((a) => ({ alias_key: a.aliasKey, group_key: a.groupKey, rule: a.rule, status: "confirmed", source: "RULE_AUTO", note: a.note }));
    const { error } = await db.from("program_alias").upsert(part, { onConflict: "alias_key", ignoreDuplicates: true });
    if (error) throw new Error(`자동 별칭 저장 실패: ${error.message}`);
  }
  let repointed = 0;
  for (const a of added) {
    const { data, error } = await db.from("program_alias").update({ group_key: a.groupKey }).eq("group_key", a.aliasKey).neq("alias_key", a.groupKey).select("alias_key");
    if (error) throw new Error(`별칭 체인 정리 실패: ${error.message}`);
    repointed += data?.length ?? 0;
  }
  const { error: e2 } = await db.rpc("apply_program_aliases");
  if (e2) throw new Error(`별칭 반영 실패: ${e2.message}`);
  return { added, repointed };
}
