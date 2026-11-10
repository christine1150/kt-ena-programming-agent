// 주간·월간 채널 보고서의 "IPTV 셋톱 요약" 한 단락(순수 함수) — IPTV 활용 계획 3단계 마지막 항목(2026-11-11).
// 새 수치를 만들지 않는다: 스냅샷 extras.iptvSummary(DB 함수 iptv_report_summary 값)를 문장·표로 옮겨 적을 뿐이다.
// IPTV 는 보조 자료다 — 청약·공식 KPI 기준은 닐슨이고, 닐슨 표와 섞지 않고 "IPTV"를 붙여 따로 적는다. 문체는 개조식.
import { formatRating } from "@/lib/audienceReport/format";
import { toGaejosik } from "@/lib/audienceReport/gaejosik";
import type { DocSection } from "@/lib/audienceReport/reportFlatten";
import type { IptvReportSummary } from "./types";

export const IPTV_SUMMARY_NOTE = "IPTV 3사 셋톱(TV INDEX) 값으로 보조 자료임. 청약·공식 KPI 기준은 닐슨이며 위 닐슨 표와 비교·합산하지 않음. 수도권 2049는 셋톱에서 추정한 값임.";
const TARGET_LABEL = { household: "가구", p2049: "수도권 2049(추정)" } as const;
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

/** 직전 기간 대비 변화율(%) — 직전 값이 없거나 0이면 null */
export function iptvChangePct(cur: number | null, prev: number | null): number | null {
  return cur !== null && prev !== null && prev > 0 ? ((cur - prev) / prev) * 100 : null;
}

export function iptvChangeText(pct: number | null): string {
  if (pct === null) return "직전 기간 자료 없음";
  if (Math.abs(pct) < 0.5) return "직전 기간과 거의 같음";
  return `직전 기간 대비 ${pct > 0 ? "▲" : "▼"} ${Math.abs(pct).toFixed(1)}%`;
}

/** 보고서에 넣을 섹션을 만든다. 시청률 자료가 없으면 null(섹션 자체를 두지 않는다 — 없는 값을 만들어 채우지 않음). */
export function iptvSummarySection(s: IptvReportSummary | null | undefined, channelCode: string): DocSection | null {
  if (!s || s.avgRating === null || s.airings === 0) return null;
  const fmt = (v: number | null) => formatRating(v, channelCode);
  const items: string[] = [];
  items.push(`IPTV ${TARGET_LABEL[s.targetKind]} 평균 시청률 ${fmt(s.avgRating)} (${md(s.from)}~${md(s.to)}, ${s.airings}회 방영) · ${iptvChangeText(iptvChangePct(s.avgRating, s.prevAvgRating))}`);
  if (s.ratingRank !== null && s.observedChannels > 1) items.push(`IPTV에 관측되는 경쟁·UHD 채널과 비교해 ${s.observedChannels}개 중 ${s.ratingRank}위(다른 자사 채널 제외)`);
  const reach = s.avgReachRate === null ? null : `도달률 ${s.avgReachRate.toFixed(2)}%`;
  const mpr = s.minutesPerReacher === null ? null : `도달자 1인당 시청 ${s.minutesPerReacher.toFixed(0)}분`;
  if (reach || mpr) items.push([reach, mpr].filter(Boolean).join(" · "));
  const blocks: DocSection["blocks"] = [{ kind: "bullets", items: items.map(toGaejosik) }];
  if (s.topPrograms.length > 0) {
    blocks.push({
      kind: "table",
      headers: ["프로그램(IPTV 본방)", "방영", "시청률", "1인당 시청"],
      rows: s.topPrograms.map((p) => [p.name, `${p.airings}회`, fmt(p.rating), p.minutesPerReacher === null ? "—" : `${p.minutesPerReacher.toFixed(0)}분`]),
    });
  }
  const notes = [IPTV_SUMMARY_NOTE];
  if (s.partial && s.lastDate) notes.push(`이 채널 IPTV 자료가 ${s.lastDate}까지라 그 날까지만 집계함(분석 기간 전체가 아님).`);
  blocks.push({ kind: "text", text: toGaejosik(notes.join(" ")) });
  return { key: "iptv_summary", title: "IPTV 셋톱 요약(보조)", blocks };
}
