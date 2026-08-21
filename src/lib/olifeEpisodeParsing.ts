import * as XLSX from "xlsx";

// OLIFE 편성 메타데이터(국가/부제/테마) 파싱 — 사용자 지시(2026-08-22): "<걸어서 세계속으로>,
// <세계 테마기행>, <극한직업>은 방문 국가·도시·부제에 따라 시청률이 크게 갈리므로, 관리자가 별도로
// 주는 EBS 콘텐츠 리스트(BIS등록회차·부제목이 정리된 카탈로그)를 Nielsen/EPG 데이터와 결합해
// 이 메타데이터를 보완하라"는 요청을 구현한다.
//
// 중요한 선행 결정(2026-08-21, src/lib/epgMatch.ts에 이미 문서화됨): "부제 원문 형식이 프로그램마다
// 달라(가끔 '국가-도시', 가끔 지역명만, 가끔 국가명이 없음) 정확한 파싱 규칙을 세우기 어려워
// 국가/도시를 구조화 필드로 분리하지 않는다"고 결정했었다 — 이번에 EBS 카탈로그가 새로 제공되면서
// 그 결정을 다음 원칙으로 갱신한다: (1) 원문 부제(subtitle_raw)는 항상 그대로 보존해 근거로 남기고,
// (2) "국가"는 추측이 아니라 사전(dictionary) 매칭이 됐을 때만 채우며(안 되면 NULL), (3) "도시/장소"는
// 의미를 단정하지 않고 구조적으로만 추출한다(부제 마지막 콤마 뒤 조각 — 실제로 도시가 아닐 수도
// 있다는 걸 필드명 자체(detail_tail)로 명시). CLAUDE.md 원칙(없는 데이터를 임의로 만들지 않음)을
// 지키면서도 EBS 카탈로그가 준 정보를 최대한 활용한다.

// 세계 국가·주요 지역명(한국어 표기) — 부제 텍스트에서 사전 매칭으로만 국가를 추정한다(추측 금지
// 원칙: 매칭 안 되면 country_guess는 NULL). 실제 샘플(세계테마기행 카탈로그)에 등장한 국가·지역과
// 일반적인 국가명을 함께 담아뒀다 — 긴 이름부터 매칭해야 부분 문자열 오탐을 줄일 수 있어 사용
// 시점에 길이 내림차순으로 정렬해서 쓴다(아래 guessCountry 참고).
export const COUNTRY_DICTIONARY: string[] = [
  "아랍에미리트", "사우디아라비아", "우즈베키스탄", "키르기스스탄", "카자흐스탄", "타지키스탄",
  "투르크메니스탄", "아프가니스탄", "스리랑카", "방글라데시", "파키스탄", "몽골", "네팔", "부탄",
  "미얀마", "라오스", "캄보디아", "베트남", "태국", "말레이시아", "인도네시아", "필리핀", "싱가포르",
  "브루나이", "동티모르", "중국", "대만", "타이완", "일본", "인도", "이란", "이라크", "튀르키예", "터키",
  "이스라엘", "팔레스타인", "요르단", "레바논", "시리아", "예멘", "오만", "카타르", "쿠웨이트", "바레인",
  "이집트", "리비아", "튀니지", "알제리", "모로코", "수단", "에티오피아", "케냐", "탄자니아", "우간다",
  "잠비아", "짐바브웨", "남아프리카공화국", "나미비아", "보츠와나", "모잠비크", "마다가스카르", "가나",
  "나이지리아", "세네갈", "코트디부아르",
  "영국", "프랑스", "독일", "이탈리아", "스페인", "포르투갈", "네덜란드", "벨기에", "스위스", "오스트리아",
  "그리스", "몰타", "키프로스", "아이슬란드", "아일랜드", "덴마크", "노르웨이", "스웨덴", "핀란드",
  "폴란드", "체코", "슬로바키아", "헝가리", "루마니아", "불가리아", "크로아티아", "슬로베니아",
  "보스니아", "세르비아", "몬테네그로", "알바니아", "북마케도니아", "우크라이나", "벨라루스", "몰도바",
  "러시아", "조지아", "아르메니아", "아제르바이잔", "리투아니아", "라트비아", "에스토니아", "룩셈부르크",
  "미국", "캐나다", "멕시코", "쿠바", "자메이카", "도미니카", "과테말라", "온두라스", "니카라과",
  "코스타리카", "파나마", "콜롬비아", "베네수엘라", "에콰도르", "페루", "볼리비아", "칠레", "아르헨티나",
  "우루과이", "파라과이", "브라질",
  "호주", "오스트레일리아", "뉴질랜드", "피지", "괌", "팔라우",
  "북한", "한국",
];

/** 프로그램명/부제 매칭용 정규화 — "N부" 표기·공백·구두점을 제거해 파일마다 다른 표기 차이를
 * 흡수한다(epgMatch.ts의 canonicalizeEpgProgramName과 같은 원칙, 부제 전용으로 별도 구현). */
export function normalizeSubtitle(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/\d+부/g, "")
    .replace(/[\s,.\-·()（）"'!?★]/g, "")
    .toLowerCase();
}

/** 부제 원문에서 사전 매칭되는 국가명을 찾는다 — 매칭 안 되면 null(추측하지 않음). 긴 이름부터
 * 검사해 "아랍에미리트"가 "아랍" 등으로 잘못 짧게 매칭되는 걸 방지한다. */
const SORTED_COUNTRIES = [...COUNTRY_DICTIONARY].sort((a, b) => b.length - a.length);
export function guessCountry(subtitleRaw: string): string | null {
  for (const c of SORTED_COUNTRIES) {
    if (subtitleRaw.includes(c)) return c;
  }
  return null;
}

/** 시리즈/국가 영역 — "N부" 표기 앞부분, 없으면 첫 "-" 앞부분, 그마저 없으면 첫 콤마 앞부분.
 * (예: "올라! 멕시코, 2부 마야의 별, 메리다" → "올라! 멕시코",
 *      "중국 명산 기행-천하제일절경, 황산" → "중국 명산 기행") */
export function extractSeriesLead(subtitleRaw: string): string {
  const partMatch = subtitleRaw.match(/^(.*?)\d+부/);
  if (partMatch) return partMatch[1].replace(/[,\s]+$/, "").trim();
  const dashIdx = subtitleRaw.indexOf("-");
  const commaIdx = subtitleRaw.indexOf(",");
  const cut = [dashIdx, commaIdx].filter((i) => i >= 0).sort((a, b) => a - b)[0];
  if (cut !== undefined) return subtitleRaw.slice(0, cut).trim();
  return subtitleRaw.trim();
}

/** 마지막 콤마 뒤 상세 조각 — 도시/장소인 경우가 많지만 항상 그렇다고 단정하지 않는다(필드명이
 * "detail_tail"인 이유). 콤마가 없으면 null. */
export function extractDetailTail(subtitleRaw: string): string | null {
  const lastComma = subtitleRaw.lastIndexOf(",");
  if (lastComma === -1) return null;
  const tail = subtitleRaw.slice(lastComma + 1).trim();
  return tail || null;
}

// 극한직업 테마 분류 — 사용자 지시(Task 2): "주요 방영 테마를 분류". 부제목에 별도 테마 컬럼이
// 없어(EBS 카탈로그 실측 확인, 2026-08-22) 키워드 사전으로 규칙 기반 분류한다(여러 테마 중복 가능,
// 매칭 안 되면 빈 배열 — 억지로 하나를 고르지 않는다). 참고용 분류임을 항상 명시한다.
const THEME_KEYWORDS: { theme: string; keywords: string[] }[] = [
  { theme: "수산업·어업", keywords: ["어업", "양식", "잡이", "해녀", "멸치", "전복", "갈치", "다시마", "홍합", "새우", "생선", "수산", "굴양식", "김양식"] },
  { theme: "요리·음식", keywords: ["맛", "요리", "음식", "국수", "커피", "빵", "간식", "나물", "보약", "직화", "미식", "밥상", "덕장"] },
  { theme: "위험·안전작업", keywords: ["응급", "위험", "제설", "발파", "청소", "고공", "폭발물", "컨테이너", "추락", "수술"] },
  { theme: "계절·명절 특수", keywords: ["명절", "설", "한가위", "캠핑", "겨울", "여름", "대목"] },
  { theme: "생활·터전 재발견", keywords: ["집", "농가", "재활용", "새활용", "개조"] },
  { theme: "해외 콘텐츠", keywords: [] }, // 국가 사전 매칭 성공 시 아래 classifyThemes에서 별도 추가
];
export function classifyGeukhanjikupThemes(subtitleRaw: string): string[] {
  const themes: string[] = [];
  for (const { theme, keywords } of THEME_KEYWORDS) {
    if (theme === "해외 콘텐츠") continue;
    if (keywords.some((k) => subtitleRaw.includes(k))) themes.push(theme);
  }
  if (guessCountry(subtitleRaw)) themes.push("해외 콘텐츠");
  return themes;
}

export interface OlifeCatalogRow {
  seriesName: "세계테마기행" | "극한직업" | "한국기행";
  bisEpisodeNumber: string | null;
  subtitleRaw: string;
  subtitleNorm: string;
  seriesLead: string;
  detailTail: string | null;
  countryGuess: string | null;
  themes: string[]; // 극한직업만 채움, 나머지는 빈 배열
  sourceFile: string;
}

export interface EbsCatalogParseResult {
  ok: true;
  rows: OlifeCatalogRow[];
}
export interface EbsCatalogParseError {
  ok: false;
  message: string;
}

// EBS 콘텐츠 리스트(관리자 제공) 파싱 — 사용자가 준 실제 샘플 파일로 구조를 확인함(2026-08-22):
// 시트 3개("세계테마기행"/"극한직업"/"한국기행"), 각 시트는 상단 2~3행이 제목/헤더이고 4행부터
// 데이터가 시작된다. "극한직업" 시트만 열 구성이 달라(BIS등록회차가 B열, 부제목이 E열) 따로 처리.
export function parseEbsCatalogWorkbook(buffer: Buffer, fileName: string): EbsCatalogParseResult | EbsCatalogParseError {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer" });
  } catch {
    return { ok: false, message: `${fileName}: 엑셀 파일을 읽을 수 없습니다. 파일이 손상되었을 수 있습니다.` };
  }

  const expectedSheets: OlifeCatalogRow["seriesName"][] = ["세계테마기행", "극한직업", "한국기행"];
  const foundSheets = expectedSheets.filter((s) => workbook.Sheets[s]);
  if (foundSheets.length === 0) {
    return { ok: false, message: `${fileName}: "세계테마기행"/"극한직업"/"한국기행" 시트를 하나도 찾을 수 없습니다 — EBS 콘텐츠 리스트 형식이 맞는지 확인해주세요.` };
  }

  const rows: OlifeCatalogRow[] = [];
  for (const seriesName of foundSheets) {
    const ws = workbook.Sheets[seriesName];
    const sheetRows = XLSX.utils.sheet_to_json<(string | number)[]>(ws, { header: 1, raw: false, defval: "" });
    for (let i = 3; i < sheetRows.length; i++) {
      const r = sheetRows[i];
      if (!r || r.length === 0) continue;
      let bis: string | null;
      let subtitleRaw: string;
      if (seriesName === "극한직업") {
        // B열(BIS등록회차, 짝수회차만 채움) 없으면 C열(EBS넘버) 사용, E열이 부제목.
        bis = String(r[1] ?? r[2] ?? "").trim() || null;
        subtitleRaw = String(r[4] ?? "").trim();
      } else {
        bis = String(r[1] ?? "").trim() || null;
        subtitleRaw = String(r[3] ?? "").trim();
      }
      if (!subtitleRaw) continue;
      const subtitleNorm = normalizeSubtitle(subtitleRaw);
      if (!subtitleNorm) continue;
      rows.push({
        seriesName,
        bisEpisodeNumber: bis,
        subtitleRaw,
        subtitleNorm,
        seriesLead: extractSeriesLead(subtitleRaw),
        detailTail: extractDetailTail(subtitleRaw),
        countryGuess: guessCountry(subtitleRaw),
        themes: seriesName === "극한직업" ? classifyGeukhanjikupThemes(subtitleRaw) : [],
        sourceFile: fileName,
      });
    }
  }
  if (rows.length === 0) {
    return { ok: false, message: `${fileName}: 유효한 데이터 행을 찾지 못했습니다.` };
  }
  return { ok: true, rows };
}

/** 리포트용 표시 태그 — 예: "올라! 멕시코-메리다"(구조적 추출, seriesLead+detailTail 그대로 결합).
 * 국가가 사전 매칭됐으면 괄호로 덧붙인다("올라! 멕시코-메리다 (멕시코)")—원문을 바꾸지 않고 참고
 * 정보만 보탠다. */
export function formatCatalogTag(row: Pick<OlifeCatalogRow, "seriesLead" | "detailTail" | "countryGuess">): string {
  const base = row.detailTail ? `${row.seriesLead}-${row.detailTail}` : row.seriesLead;
  return row.countryGuess && !base.includes(row.countryGuess) ? `${base} (${row.countryGuess})` : base;
}
