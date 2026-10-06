// PD 수동 리포트(엑셀)에서 채널을 자동으로 알아낸다 — 사용자 지시(2026-10-06): "채널 선택을 굳이 할 필요가
// 없으니 업로드하는 틀을 단순히". 리포트 안에 채널명이 이미 있다: 드라마 양식은 "ENA 수도권 2049"·
// "ENA 가구(전국)"(회차 시트)와 "ENA 2049 분단위"(분당 시트), 예능 양식은 제목 셀 "ENA 나는 SOLO … 시청률 리뷰".
// 셀 문구의 앞머리 채널명만 보고(임의 추정 없음), 가장 많이 나온 채널을 고른다. 못 찾으면 null — 호출부가
// 사용자에게 채널 선택을 요청한다.
import * as XLSX from "xlsx";

const CHANNEL_PATTERN = "ENA\\s*Drama|ENA\\s*Play|ENA\\s*Story|ENA|OLIFE|ONCE|sky\\s*UHD";
const CODE_BY_KEY: Record<string, string> = {
  ena: "ENA",
  enadrama: "ENA_DRAMA",
  enaplay: "ENA_PLAY",
  enastory: "ENA_STORY",
  olife: "OLIFE",
  once: "ONCE",
  skyuhd: "SKYUHD",
};
// "ENA 수도권 2049", "ENA 가구(전국)", "ENA 2049 분단위" 처럼 채널명 뒤에 지표 표기가 오는 셀,
// 또는 "ENA 나는 SOLO … 시청률 리뷰" 처럼 채널명으로 시작하는 제목 셀.
const LABEL_RE = new RegExp(`^\\s*(${CHANNEL_PATTERN})\\s+(?:수도권\\s*|전국\\s*)?(?:2049|2039|가구|분단위)`, "i");
const TITLE_RE = new RegExp(`^\\s*(${CHANNEL_PATTERN})\\s+.+시청률\\s*리뷰`, "i");

export function detectReportChannelCode(buffer: Buffer): string | null {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer" });
  } catch {
    return null;
  }
  const votes = new Map<string, number>();
  for (const name of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, blankrows: true, defval: null }) as unknown[][];
    for (const row of rows.slice(0, 15)) {
      for (const cell of row.slice(0, 20)) {
        if (typeof cell !== "string") continue;
        const text = cell.replace(/\s+/g, " ").trim();
        const m = text.match(LABEL_RE) ?? text.match(TITLE_RE);
        if (!m) continue;
        const code = CODE_BY_KEY[m[1].toLowerCase().replace(/\s+/g, "")];
        if (code) votes.set(code, (votes.get(code) ?? 0) + 1);
      }
    }
  }
  const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) return null;
  if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) return null; // 동률이면 추정하지 않음
  return ranked[0][0];
}
