// 콘텐츠 식별(단계 06) — Avail 제목과 시스템 프로그램을 잇는다.
// 별칭·표기 정규화는 "검색"을 돕는다. 시즌·편집판·스페셜·더빙판·제작년도가 다른 것은 자동 병합하지 않는다(명세 A06).
// 불명확한 연결은 후보로만 보여 주고, 운영자가 확인하기 전까지 권리는 unknown이다.
import { normalizeProgramCanonicalName } from "@/lib/programNameMatch";

export interface IdentityMarkers {
  season: string | null;
  versions: string[];
  year: string | null;
}

const VERSION_WORDS = ["확장판", "감독판", "극장판", "더빙", "자막", "스페셜", "특별판", "무삭제", "편집본", "디렉터스컷", "베스트", "리마스터", "외전", "변외편", "에디션"];

/** 제목에서 시즌·편집판·제작년도 표지를 뽑는다. 표지가 다르면 같은 콘텐츠로 자동 병합하지 않는다. */
export function identityMarkers(title: string): IdentityMarkers {
  const t = title.replace(/\s+/g, "");
  let season: string | null = null;
  const m = /시즌(\d+)/.exec(t) ?? /season(\d+)/i.exec(t) ?? /(?:^|[^A-Za-z])S(\d+)(?:$|[^A-Za-z0-9])/.exec(t) ?? /(\d+)기(?:$|[^가-힣])/.exec(t);
  if (m) season = m[1];
  else {
    const tail = /([가-힣A-Za-z])(\d{1,2})$/.exec(t.replace(/[^가-힣A-Za-z0-9]/g, ""));
    if (tail) season = tail[2];
  }
  const versions = VERSION_WORDS.filter((w) => t.includes(w));
  const y = /(?:19|20)\d{2}/.exec(title);
  return { season, versions, year: y ? y[0] : null };
}

/** 같은 제목에서 시즌·꼬리 숫자를 뗀 키 — "시즌만 다른 후보"를 찾는 용도(병합 근거 아님). */
export function baseKey(title: string): string {
  return normalizeProgramCanonicalName(title)
    .replace(/시즌\d+/gi, "")
    .replace(/season\d+/gi, "")
    .replace(/\d+기$/g, "")
    .replace(/s\d+$/i, "")
    .replace(/\d+$/g, "");
}

export interface TitleVariants {
  main: string;
  mainKey: string;
  /** 괄호 안 별칭과 슬래시로 나뉜 부제 */
  aliases: string[];
  aliasKeys: string[];
}

/** "서바이빙 어스(대멸종: 최후의 생존자들)" → 본 제목 + 별칭. 괄호 안은 별칭이지 다른 콘텐츠가 아니다. */
export function titleVariants(title: string, extraAliases: string[] = []): TitleVariants {
  const aliases: string[] = [];
  const main = title
    .replace(/\(([^)]*)\)/g, (_m, inner: string) => {
      for (const a of inner.split("/")) if (a.trim() && !/^(재|본|생|특집)$/.test(a.trim())) aliases.push(a.trim());
      return " ";
    })
    .replace(/\s+/g, " ")
    .trim();
  for (const a of extraAliases) if (a.trim()) aliases.push(a.trim());
  const uniq = [...new Set(aliases)];
  return { main, mainKey: normalizeProgramCanonicalName(main), aliases: uniq, aliasKeys: uniq.map((a) => normalizeProgramCanonicalName(a)).filter(Boolean) };
}

export interface ProgramRow {
  id: string;
  name: string;
  channel?: string | null;
}

export type LinkBasis = "exact" | "alias" | "season_differs" | "partial";

export interface LinkCandidate {
  programId: string;
  programName: string;
  basis: LinkBasis;
  /** 0~1. 높아도 exact가 아니면 자동 연결하지 않는다 */
  confidence: number;
  /** 시즌·편집판·제작년도 표지가 서로 다르면 사유 */
  markerConflicts: string[];
}

export interface ContentTitleInput {
  title: string;
  aliases?: string[];
  productionYear?: string | null;
}

/** Avail 제목 1건에 대해 시스템 프로그램 후보를 신뢰도 순으로 돌려준다. */
export function proposeLinks(content: ContentTitleInput, programs: ProgramRow[]): LinkCandidate[] {
  const v = titleVariants(content.title, content.aliases ?? []);
  const cm = identityMarkers(content.title);
  const cBase = baseKey(v.main);
  const out: LinkCandidate[] = [];
  for (const p of programs) {
    const pKey = normalizeProgramCanonicalName(p.name);
    if (!pKey) continue;
    const pm = identityMarkers(p.name);
    const conflicts: string[] = [];
    if (cm.season && pm.season && cm.season !== pm.season) conflicts.push(`시즌 ${cm.season} ↔ ${pm.season}`);
    if (cm.season !== pm.season && (!cm.season || !pm.season) && v.mainKey !== pKey) conflicts.push("시즌 표기 한쪽만 있음");
    const cv = cm.versions.join("|");
    const pv = pm.versions.join("|");
    if (cv !== pv) conflicts.push(`편집판 표지 다름(${cv || "없음"} ↔ ${pv || "없음"})`);
    if (content.productionYear && pm.year && !content.productionYear.includes(pm.year)) conflicts.push(`제작년도 ${content.productionYear} ↔ ${pm.year}`);
    let basis: LinkBasis | null = null;
    let confidence = 0;
    if (pKey === v.mainKey) {
      basis = "exact";
      confidence = 1;
    } else if (v.aliasKeys.includes(pKey)) {
      basis = "alias";
      confidence = 0.85;
    } else if (cBase && baseKey(p.name) === cBase) {
      basis = "season_differs";
      confidence = 0.5;
    } else if (v.mainKey.length >= 3 && pKey.length >= 3 && (pKey.includes(v.mainKey) || v.mainKey.includes(pKey))) {
      basis = "partial";
      confidence = 0.6;
    }
    if (basis) out.push({ programId: p.id, programName: p.name, basis, confidence, markerConflicts: conflicts });
  }
  return out.sort((a, b) => b.confidence - a.confidence || a.programName.localeCompare(b.programName));
}

export type LinkStatus = "RESOLVED" | "NEEDS_CONFIRMATION" | "NOT_FOUND";

/**
 * 자동 연결은 이름이 정확히 같고(exact) 표지 충돌이 없는 후보가 하나뿐일 때만 허용한다.
 * 별칭 일치·시즌 다름·부분 일치는 후보로만 두고 운영자 확인을 받는다(확인 전 권리 unknown).
 */
export function decideLink(cands: LinkCandidate[]): { status: LinkStatus; programId: string | null; candidates: LinkCandidate[] } {
  if (cands.length === 0) return { status: "NOT_FOUND", programId: null, candidates: [] };
  const exact = cands.filter((c) => c.basis === "exact" && c.markerConflicts.length === 0);
  if (exact.length === 1 && cands.filter((c) => c.basis === "exact").length === 1) return { status: "RESOLVED", programId: exact[0].programId, candidates: cands };
  return { status: "NEEDS_CONFIRMATION", programId: null, candidates: cands };
}
