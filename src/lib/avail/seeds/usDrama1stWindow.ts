// 영미 드라마 1st window 신규 구매분 23건의 보충 속성(운영자 전달, 2026-10-06).
// 전달 내용: 모두 1st window로 새로 구매했고 '페이퍼'(30분물)를 빼면 60분물, 당사 전 채널이 2년간 방영 가능,
// 1st window 채널이 최초 방송을 한 뒤에 나머지 채널이 자유롭게 방영 가능, 제작년도가 중요.
// 원본 Avail 파일(소재코드 D26081201~23)에 이미 있는 행에 붙이는 보충 속성이며, 원본 값은 덮어쓰지 않는다.
// 제작년도는 전달받은 값만 넣었다(AMADEUS #01 (2025/26)만 표기). 나머지는 입력 전이다.
import type { Addendum } from "../addenda";

const BY = "운영자 전달 2026-10-06(영미 드라마 1st window 목록)";

interface Row {
  no: number;
  code: string;
  title: string;
  product: string;
  start: string;
  startYearInferred?: boolean;
  first: string;
  eps: number;
  runtime: number;
  year?: string;
}

const ROWS: Row[] = [
  { no: 1, code: "D26081201", title: "행동과학자의 사건 파일 시즌 1", product: "IRRATIONAL, THE #01", start: "2026-08-31", first: "ENA Story", eps: 11, runtime: 60 },
  { no: 2, code: "D26081202", title: "행동과학자의 사건 파일 시즌 2", product: "IRRATIONAL, THE #02", start: "2026-09-15", first: "ENA Story", eps: 18, runtime: 60 },
  { no: 3, code: "D26081222", title: "페이퍼 시즌 1", product: "PAPER, THE #01", start: "2026-08-31", first: "skyUHD", eps: 10, runtime: 30 },
  { no: 4, code: "D26081208", title: "아마데우스", product: "AMADEUS #01 (2025/26)", start: "2026-08-31", first: "skyUHD", eps: 5, runtime: 60, year: "2025/26" },
  { no: 5, code: "D26081203", title: "골든 아워 트랜스플랜트 시즌 4", product: "TRANSPLANT #04", start: "2026-09-10", first: "ENA Play", eps: 10, runtime: 60 },
  { no: 6, code: "D26081207", title: "스위트피 시즌 1", product: "SWEETPEA #01", start: "2026-09-15", first: "skyUHD", eps: 6, runtime: 60 },
  { no: 7, code: "D26081209", title: "대멸종: 최후의 생존자들 (서바이빙 어스)", product: "SURVIVING EARTH #01", start: "2026-09-15", first: "skyUHD", eps: 8, runtime: 60 },
  { no: 8, code: "D26081204", title: "로앤오더 토론토: 크리미널 인텐트 시즌 1", product: "LAW & ORDER TORONTO: CRIMINAL INTENT #01", start: "2026-09-15", first: "ONCE", eps: 10, runtime: 60 },
  { no: 9, code: "D26081205", title: "로앤오더 토론토: 크리미널 인텐트 시즌 2", product: "LAW & ORDER TORONTO: CRIMINAL INTENT #02", start: "2026-10-01", first: "ONCE", eps: 10, runtime: 60 },
  { no: 10, code: "D26081206", title: "로앤오더 토론토: 크리미널 인텐트 시즌 3", product: "LAW & ORDER TORONTO: CRIMINAL INTENT #03", start: "2026-10-15", first: "ONCE", eps: 10, runtime: 60 },
  { no: 11, code: "D26081210", title: "갱스 오브 런던 시즌 3", product: "GANGS OF LONDON #03", start: "2026-10-01", first: "skyUHD", eps: 8, runtime: 60 },
  { no: 12, code: "D26081211", title: "더 캡처 시즌2", product: "CAPTURE, THE #02", start: "2026-10-01", first: "skyUHD", eps: 8, runtime: 60 },
  { no: 13, code: "D26081212", title: "더 캡처 시즌3", product: "CAPTURE, THE #03", start: "2026-10-01", first: "skyUHD", eps: 8, runtime: 60 },
  { no: 14, code: "D26081213", title: "더 헌팅 파티 시즌 1", product: "HUNTING PARTY, THE #01", start: "2026-10-15", first: "skyUHD", eps: 10, runtime: 60 },
  { no: 15, code: "D26081214", title: "더 헌팅 파티 시즌 2", product: "HUNTING PARTY, THE #02", start: "2026-10-15", first: "skyUHD", eps: 13, runtime: 60 },
  { no: 16, code: "D26081215", title: "언더 솔트 마쉬", product: "UNDER SALT MARSH #01", start: "2026-11-01", first: "skyUHD", eps: 6, runtime: 60 },
  { no: 17, code: "D26081216", title: "엘리전스 시즌 2", product: "ALLEGIANCE #02", start: "2026-11-01", first: "skyUHD", eps: 10, runtime: 60 },
  { no: 18, code: "D26081221", title: "슈츠 LA 시즌1", product: "SUITS LA #01", start: "2026-11-15", first: "skyUHD", eps: 6, runtime: 60 },
  { no: 19, code: "D26081218", title: "아토믹", product: "ATOMIC #01", start: "2026-11-15", first: "skyUHD", eps: 5, runtime: 60 },
  { no: 20, code: "D26081219", title: "유령마을", product: "BURBS, THE #01", start: "2026-11-15", first: "skyUHD", eps: 8, runtime: 60 },
  { no: 21, code: "D26081220", title: "그로스포인트 정원 협회의 비밀", product: "GROSSE POINT GARDEN SOCIETY", start: "2026-12-01", first: "skyUHD", eps: 13, runtime: 60 },
  { no: 22, code: "D26081217", title: "라브레아 시즌 3", product: "LA BREA #03", start: "2026-12-01", first: "skyUHD", eps: 13, runtime: 60 },
  // 시작일이 "12월 15일"로만 전달돼 연도는 2026으로 추정했다(목록이 시간순).
  { no: 23, code: "D26081223", title: "올 허 폴트: 그날의 책임", product: "ALL HER FAULT #01", start: "2026-12-15", startYearInferred: true, first: "skyUHD", eps: 8, runtime: 60 },
];

export const US_DRAMA_1ST_WINDOW: Addendum[] = ROWS.map((r) => ({
  addendumId: `usdrama1w:${r.code}`,
  sourceCode: r.code,
  titleKey: null,
  firstWindowChannel: r.first,
  productName: r.product,
  productionYear: r.year ?? null,
  origination: "acquired",
  expected: { displayTitle: r.title, startDate: r.start, startYearInferred: r.startYearInferred, episodeCount: r.eps, runtimeMin: r.runtime, termMonths: 24, firstChannel: r.first, freeAfterFirstWindow: true },
  provenance: BY,
}));
