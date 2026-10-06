// 닐슨 수집 테스트용 합성 워크북 빌더 — 실제 파일 구조(랭킹 시트 7열 블록, 타깃상세 5열 블록, 하루전체 행, 경쟁채널 자사 블록)를
// 최소한으로 흉내 낸다. 값은 테스트용이며 실제 채널 실적이 아니다.
import * as XLSX from "xlsx";

export const CHANNELS: { code: string; name: string }[] = [
  { code: "ENA", name: "ENA" },
  { code: "ENA_DRAMA", name: "ENA DRAMA" },
  { code: "ENA_PLAY", name: "ENA PLAY" },
  { code: "ENA_STORY", name: "ENA STORY" },
  { code: "OLIFE", name: "OLIFE" },
  { code: "ONCE", name: "ONCE" },
  { code: "SKYUHD", name: "SkyUHD" },
];

export interface DailySpec {
  /** 시트 분석기간 줄 날짜(YYYY-MM-DD). null이면 줄을 넣지 않는다 */
  sheetDate: string | null;
  /** 채널×라벨 시청률 덮어쓰기: key = `${code}|${label}` */
  rankRating?: Record<string, number | null>;
  /** ENA PLAY 타깃상세 헤더 순서: 기본 2039 먼저(실제 원본 D=2039, I=2049) */
  playHeaderOrder?: ["수도권 2039", "수도권 2049"] | ["수도권 2049", "수도권 2039"];
  /** ENA PLAY 07:54:58 방송의 (2039, 2049) 시청률 */
  playPremiere?: [number, number];
  /** 빈 셀(결측)로 만들 ENA 프로그램 시청률 */
  enaBlankRating?: boolean;
  includeCompetitorOwnBlock?: boolean;
  /** 경쟁시트 자사 블록의 (2049, 2039) — 타깃상세와 교차 검증 */
  ownBlockPlay?: [number, number];
  omitRankSheet?: boolean;
  extraSheet?: boolean;
  /** 시작시간을 문자열("07:54:58") 대신 엑셀 일수 실수로 */
  numericTimes?: boolean;
}

const RANK_LABELS = ["개인2049", "National 유료방송가입가구"];

function rankSheet(spec: DailySpec, labels: string[]): unknown[][] {
  const rows: unknown[][] = [["닐슨코리아 제공"], [], spec.sheetDate ? [`- 분석기간 : ${spec.sheetDate.replace(/-/g, ". ")}. (테스트)`] : ["- 분석기간 : (없음)"], ["- 분석지역 : 수도권, National"], []];
  const labelRow: unknown[] = [];
  labels.forEach((label, k) => (labelRow[k * 7 + 1] = `- ${label}`));
  rows.push(labelRow);
  const header: unknown[] = [];
  labels.forEach((_, k) => ["No.", "채널", "시청률", "점유율", "도달율", "시청시간", ""].forEach((h, i) => (header[k * 7 + i] = h)));
  rows.push(header);
  CHANNELS.forEach((ch, i) => {
    const row: unknown[] = [];
    labels.forEach((label, k) => {
      const key = `${ch.code}|${label}`;
      const rating = spec.rankRating && key in spec.rankRating ? spec.rankRating[key] : 0.01 * (i + 1) + (label === RANK_LABELS[0] ? 0 : 0.1);
      [i + 1 + (label === RANK_LABELS[0] ? 0 : 10), ch.name, rating ?? undefined, 1.5, 3.2, 0.012, undefined].forEach((v, j) => (row[k * 7 + j] = v));
    });
    rows.push(row);
  });
  return rows;
}

const t = (spec: DailySpec, hhmmss: string): string | number => {
  if (!spec.numericTimes) return hhmmss;
  const [h, m, s] = hhmmss.split(":").map(Number);
  return (h * 3600 + m * 60 + s) / 86400;
};

/** 타깃상세 한 채널 섹션: 헤더 행(채널명+타깃 라벨), "시작시간" 행, 프로그램 행들, 하루전체 행 */
function detailSection(spec: DailySpec, channel: string, labels: string[], programs: { start: string; end: string; name: string; ratings: (number | null)[] }[]): unknown[][] {
  const head: unknown[] = [channel];
  labels.forEach((l, k) => (head[3 + k * 5] = l));
  const sub: unknown[] = ["시작시간", "끝시간", "프로그램"];
  labels.forEach((_, k) => ["시청률", "점유율", "도달율", "시청시간", "시청시간비율"].forEach((h, i) => (sub[3 + k * 5 + i] = h)));
  const rows: unknown[][] = [head, sub];
  for (const p of programs) {
    const row: unknown[] = [t(spec, p.start), t(spec, p.end), p.name];
    p.ratings.forEach((r, k) => [r ?? undefined, 1.1, 2.2, 0.02, 0.5].forEach((v, i) => (row[3 + k * 5 + i] = v)));
    rows.push(row);
  }
  const agg: unknown[] = ["하루전체"];
  labels.forEach((_, k) => [0.05, 1, 2, 0.03, 0.4].forEach((v, i) => (agg[3 + k * 5 + i] = v)));
  rows.push(agg, []);
  return rows;
}

export function buildDailyWorkbook(spec: DailySpec): Buffer {
  const wb = XLSX.utils.book_new();
  const add = (name: string, rows: unknown[][]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  if (!spec.omitRankSheet) add("유료방송가입가구", rankSheet(spec, [RANK_LABELS[1]]));
  add("개인", rankSheet(spec, [RANK_LABELS[0]]));
  add("ENA타깃상세", detailSection(spec, "ENA", ["수도권 2049", "수도권 2039"], [{ start: "20:50:00", end: "22:05:00", name: "ENA드라마<본>", ratings: [spec.enaBlankRating ? null : 0.2, 0] }]));
  add("ENA DRAMA타깃상세", detailSection(spec, "ENA DRAMA", ["수도권 2049", "수도권 2039"], [{ start: "21:00:00", end: "22:10:00", name: "드라마극장", ratings: [0.1, 0.05] }]));
  const order = spec.playHeaderOrder ?? ["수도권 2039", "수도권 2049"];
  const [p39, p49] = spec.playPremiere ?? [0.02327, 0.07742];
  const playRatings = order[0] === "수도권 2039" ? [p39, p49] : [p49, p39];
  add("ENA PLAY타깃상세", detailSection(spec, "ENA PLAY", [...order], [{ start: "07:54:58", end: "09:01:07", name: "신병4사보타주", ratings: playRatings }, { start: "25:30:00", end: "26:30:00", name: "심야극장", ratings: playRatings }]));
  const combined = [
    ...detailSection(spec, "ONCE", ["전국 유료가구"], [{ start: "10:00:00", end: "11:00:00", name: "ONCE프로", ratings: [0.04] }]),
    ...detailSection(spec, "OLIFE", ["전국 유료가구"], [{ start: "10:00:00", end: "11:00:00", name: "OLIFE프로", ratings: [0.09] }]),
    ...detailSection(spec, "ENA STORY", ["전국 유료가구"], [{ start: "10:00:00", end: "11:00:00", name: "스토리프로", ratings: [0.05] }]),
  ];
  add("ONCE,OLIFE,ENA SPORTS타깃상세", combined);
  if (spec.includeCompetitorOwnBlock) {
    const [a49, a39] = spec.ownBlockPlay ?? [0.07742, 0.02327];
    add("ENA PLAY경쟁채널시청률", [
      ["ENA PLAY"],
      ["시작시간", "종료시간", "프로그램명", "시청률", "시청률", "시청률", "점유율", "점유율", "점유율"],
      [undefined, undefined, undefined, "개인2049", "개인2039", "유료방송가구", "개인2049", "개인2039", "유료방송가구"],
      [t(spec, "07:54:58"), t(spec, "09:01:07"), "신병4사보타주", a49, a39, 0.08, 1, 1, 1],
      ["하루 전체", undefined, undefined, 0.03, 0.01, 0.06],
    ]);
  }
  if (spec.extraSheet) add("새로운시트", [["알 수 없는 시트"], [1, 2, 3]]);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

/** 주간·월간 파일: 랭킹 시트 2개만(프로그램 상세 없음). */
export function buildPeriodWorkbook(from: string, to: string, rating = 0.1): Buffer {
  const dot = (d: string) => d.replace(/-/g, ".");
  const spec: DailySpec = { sheetDate: null };
  const wb = XLSX.utils.book_new();
  const mk = (labels: string[]) => {
    const rows = rankSheet({ ...spec, rankRating: { "ENA|개인2049": rating } }, labels);
    rows[2] = [`- 분석기간 : ${dot(from)} - ${dot(to)}`];
    return rows;
  };
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(mk([RANK_LABELS[1]])), "유료방송가입가구");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(mk([RANK_LABELS[0]])), "개인");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
