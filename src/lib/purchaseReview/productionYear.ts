// 콘텐츠 구매 검토(단계 13) — 제작년도 표기(순수 함수).
// 출처 순서: ① Avail 행의 제작년도(원본 값) ② 주요 콘텐츠 관리에 등록된 작품이면 방영 시작년도(제작년도가 아님을 명시) ③ 미확인.
// 주요 콘텐츠 관리에는 제작년도 항목이 없다(방영 시작·종료일, 요일·시각, 예상 회차뿐). 방영 시작년도를 제작년도로 단정하지 않는다.
// 시즌·판·제작년도가 다른 작품은 같은 콘텐츠로 자동 병합하지 않으므로, 후보 제목에서도 표지를 뽑아 함께 보여 준다.
import { identityMarkers } from "@/lib/avail/identity";

export interface ProductionYearInput {
  /** Avail 행이 가진 제작년도(여러 행이면 모두) */
  availYears: string[];
  /** 주요 콘텐츠 관리 등록 정보(없으면 null) */
  featured: { startDate: string | null; endDate: string | null; expectedEpisodes: number | null } | null;
  /** 후보 제목(예: "나는솔로 2기 (2019)") — 제목에 연도가 적혀 있으면 표지로만 쓴다 */
  title?: string;
}

export interface ProductionYearView {
  source: "avail" | "featured_start_year" | "title_marker" | "unknown";
  /** 화면 표기 */
  text: string;
  /** 제작년도가 맞는 값인가(방영 시작년도·제목 표지는 false) */
  confirmed: boolean;
  years: string[];
  /** Avail 행끼리 값이 다르면 true — 시즌·판이 섞였을 수 있다 */
  conflict: boolean;
}

const yearOf = (d: string | null | undefined) => (d && /^\d{4}/.test(d) ? d.slice(0, 4) : null);

export function productionYearOf(input: ProductionYearInput): ProductionYearView {
  const avail = [...new Set(input.availYears.map((y) => y.trim()).filter(Boolean))].sort();
  if (avail.length > 0) {
    return { source: "avail", text: avail.length === 1 ? `제작년도 ${avail[0]}` : `제작년도 ${avail.join(" / ")} (Avail 행마다 다름 — 시즌·판 확인)`, confirmed: true, years: avail, conflict: avail.length > 1 };
  }
  const startYear = yearOf(input.featured?.startDate);
  if (startYear) {
    const endYear = yearOf(input.featured?.endDate);
    const span = endYear && endYear !== startYear ? `${startYear}~${endYear}` : startYear;
    return { source: "featured_start_year", text: `방영 시작년도 ${span} (주요 콘텐츠 관리 · 제작년도 아님, Avail에 제작년도 없음)`, confirmed: false, years: [startYear], conflict: false };
  }
  const marker = input.title ? identityMarkers(input.title).year : null;
  if (marker) return { source: "title_marker", text: `제목 표기 ${marker} (제작년도 확인 전)`, confirmed: false, years: [marker], conflict: false };
  return { source: "unknown", text: "제작년도 미확인", confirmed: false, years: [], conflict: false };
}

export interface CandidateMarker {
  season: string | null;
  versions: string[];
  year: string | null;
}

/** 후보 목록에서 표지(시즌·판·연도)가 서로 다른 후보가 섞여 있으면 사용자가 하나를 골라야 한다고 알린다. */
export function markerSpread(titles: string[]): { differs: boolean; text: string | null } {
  const ms = titles.map((t) => identityMarkers(t));
  const seasons = new Set(ms.map((m) => m.season ?? "-"));
  const versions = new Set(ms.map((m) => m.versions.join("/") || "-"));
  const years = new Set(ms.map((m) => m.year ?? "-"));
  const parts: string[] = [];
  if (seasons.size > 1) parts.push("시즌");
  if (versions.size > 1) parts.push("편집판");
  if (years.size > 1) parts.push("제작년도 표기");
  return parts.length ? { differs: true, text: `후보끼리 ${parts.join("·")}이(가) 다릅니다 — 작품을 직접 골라야 합니다.` } : { differs: false, text: null };
}
