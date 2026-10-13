// 네이버 검색으로 방송 장르를 읽는 공용 함수(사용자 지시 2026-09-30·2026-10-13).
// 관리자 일괄 스크립트(scripts/classify-genre-naver.mts)와 매주 자동 실행(genreNaverJob.ts)이 같은 규칙을 쓴다.
// 방법: 검색 결과 상단 방송 프로그램 정보 영역의 제목·장르 표기(예: "예능", "시사/교양")를 읽는다.
//       정보 영역 제목이 프로그램명과 맞지 않으면(다른 프로그램·인물·영화) 채택하지 않고 미분류로 둔다.
import { normalizeProgramCanonicalName } from "@/lib/programNameMatch";
import type { Genre } from "./types";

export type NaverHit = { query: string; title: string | null; label: string | null };

/** 네이버 장르 표기 → 공통 장르. 모르는 표기("특집" 등)는 null(미분류 유지). */
export function genreFromNaverLabel(label: string): Genre | null {
  const l = label.replace(/\s/g, "");
  if (/중국드라마/.test(l)) return "중국 드라마";
  if (/미국드라마|영국드라마/.test(l)) return "영미 드라마";
  if (/드라마/.test(l)) return "드라마";
  if (/예능|연예오락|버라이어티|토크쇼|리얼리티|오디션/.test(l)) return "예능";
  if (/뉴스|보도/.test(l)) return "뉴스·시사";
  if (/시사\/?교양|교양|다큐|시사/.test(l)) return "다큐·교양"; // 다음의 "시사"·"교양" 단독 표기 포함(네이버 "시사/교양"과 같은 분류)
  if (/만화|애니|어린이|유아|아동/.test(l)) return "애니·키즈";
  if (/스포츠/.test(l)) return "스포츠";
  if (/음악|공연|콘서트|노래/.test(l)) return "음악";
  if (/영화/.test(l)) return "영화";
  if (/홈쇼핑|쇼핑/.test(l)) return "홈쇼핑·기타";
  return null;
}

const UA = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  "Accept-Language": "ko-KR,ko;q=0.9",
};
const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ").trim();

/** 네이버 통합검색 1회 조회. 실패하면 3초 간격으로 2번 더 시도한 뒤 예외를 던진다. */
export async function searchNaver(query: string): Promise<NaverHit> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`https://search.naver.com/search.naver?where=nexearch&query=${encodeURIComponent(query)}`, { headers: UA });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const h = await res.text();
      const t = h.match(/<span class="area_text_title">([\s\S]*?)<\/span>/);
      const sub = h.match(/<div class="sub_title">([\s\S]*?)<\/div>/);
      const firstTxt = sub?.[1].match(/<span class="txt">([\s\S]*?)<\/span>/);
      return { query, title: t ? text(t[1]) : null, label: firstTxt ? text(firstTxt[1]) : null };
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw new Error("unreachable");
}

// 시즌·회차 숫자, 스페셜·몰아보기 같은 편성용 꼬리표를 떼어 같은 프로그램인지 비교
const TAIL = /(스페셜|special|베스트|best|몰아보기|하이라이트|다시보기|재방송|특집|확장판|감독판|레전드|모음zip|모음|since\d{4}|시즌\d+|\d+부|\d+)$/i;
function base(s: string): string {
  let n = normalizeProgramCanonicalName(s).toLowerCase();
  for (let i = 0; i < 4; i++) n = n.replace(TAIL, "");
  return n;
}
export function sameProgram(query: string, title: string): boolean {
  const a = base(query);
  const b = base(title);
  if (a.length < 2 || b.length < 2) return false;
  if (a === b || (b.length >= 3 && a.startsWith(b)) || (a.length >= 3 && b.startsWith(a))) return true;
  // 편성명에 수식어가 앞뒤로 붙은 경우(예: "추석특집○○") — 짧은 쪽이 4자 이상일 때만 포함 관계를 인정한다.
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 4 && long.includes(short);
}

/** 편성용 꼬리표·괄호·시즌 연도 표기를 걷어낸 검색어(예: "SINCE1983추적60분" → "추적60분"). */
export function simplify(name: string): string {
  return name
    .replace(/[<(［\[].*?[>)］\]]/g, " ")
    .replace(/since\s*\d{4}/gi, " ")
    .replace(/(추석|설날|설|명절|연휴)?\s*특집|\d+\s*부\s*$/g, " ")
    .replace(/(스페셜|베스트|몰아보기|하이라이트|다시보기|재방송|확장판|레전드).*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** 검색어 후보(원표기 → 단순화). 2자 미만·중복은 뺀다. */
export function queryVariants(display: string): string[] {
  return [...new Set([display, simplify(display)].filter((q) => q.length >= 2))];
}

/** 검색 결과가 이 프로그램의 것이고 장르를 읽을 수 있으면 공통 장르와 근거 메모를 돌려준다. */
export function decideFromHit(programName: string, hit: NaverHit | null | undefined): { genre: Genre; note: string } | null {
  if (!hit?.label || !hit.title || !sameProgram(programName, hit.title)) return null;
  const genre = genreFromNaverLabel(hit.label);
  return genre ? { genre, note: `네이버 검색: ${hit.label} (${hit.title})` } : null;
}

// ── 다음(Daum) 검색 보조(사용자 지시 2026-10-13: 네이버에서 못 찾은 프로그램은 다음·구글에서도 확인) ──
// 다음 통합검색의 방송 카드(상단 제목 + 장르 표기 "교양"·"시사"·"예능" 등)를 읽는다. 지역 방송(예: 춘천 KBS1 〈지명수배〉)처럼
// 카드 제목이 상위 프로그램(KBS 네트워크 특선)이고 해당 프로그램이 그 카드 안 목록에만 있는 경우도 목록 제목이 같으면 채택한다.
// 구글은 일반 요청에 검색 결과 대신 자바스크립트 확인 화면을 줘서(2026-10-13 확인) 쓰지 않는다.
export type DaumHit = { query: string; title: string | null; label: string | null; members: string[] };

export async function searchDaum(query: string): Promise<DaumHit> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`https://search.daum.net/search?w=tot&q=${encodeURIComponent(query)}`, { headers: UA });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const h = await res.text();
      const start = h.indexOf('id="tvpColl"');
      if (start < 0) return { query, title: null, label: null, members: [] };
      const block = h.slice(start, start + 40000);
      const head = block.match(/<div class="c-tit-exact">[\s\S]*?<strong class="tit-g[^"]*">([\s\S]*?)<\/strong>[\s\S]*?<div class="sub_header">([\s\S]*?)<\/div>/);
      const label = head?.[2].match(/<span class="txt_info">\s*<a[^>]*>([\s\S]*?)<\/a>/);
      // 카드 안 "지상파 종합 주간시청률" 탭의 순위 목록은 이 프로그램과 무관한 제목이라 목록 비교에서 뺀다.
      const cut = block.search(/주간시청률|data-tab="tab2"/);
      // 목록 제목은 바로 뒤에 "편성 ○○ KBS1" 항목이 붙은 방송 프로그램만 인정한다(뉴스 제목·영상·쇼핑 문구가 섞여 들어오는 것 방지).
      const scope = cut > 0 ? block.slice(0, cut) : block;
      const members = [...scope.matchAll(/<strong class="tit-g[^"]*">([\s\S]*?)<\/strong>/g)]
        .filter((m) => /<dt>\s*편성\s*<\/dt>/.test(scope.slice(m.index, m.index + 4000)))
        .map((m) => text(m[1]))
        .filter((t) => t && t.length <= 40);
      return { query, title: head ? text(head[1]) : null, label: label ? text(label[1]) : null, members: [...new Set(members)].slice(0, 12) };
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw new Error("unreachable");
}

/** 다음 카드가 이 프로그램의 것이고(제목 또는 카드 안 목록 제목 일치) 장르를 읽을 수 있으면 공통 장르를 돌려준다. */
export function decideFromDaumHit(programName: string, hit: DaumHit | null | undefined): { genre: Genre; note: string } | null {
  if (!hit?.label || !hit.title) return null;
  const direct = sameProgram(programName, hit.title);
  const member = direct ? null : hit.members.find((m) => m !== hit.title && sameProgram(programName, m));
  if (!direct && !member) return null;
  const genre = genreFromNaverLabel(hit.label);
  return genre ? { genre, note: `다음 검색: ${hit.label} (${direct ? hit.title : `${hit.title} > ${member}`})` } : null;
}
