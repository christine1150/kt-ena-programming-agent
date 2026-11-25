// 라인업 화면 — 자사 오리지널·사업형 라인업과 경쟁사(지상파·종편·tvN 등) 드라마 라인업(2026-11-24, docs/lineup/LINEUP_DESIGN.md).
// 주소 쿼리: view=own|compare|list, from=YYYY-MM, len=3|6|8|12, ch=ENA,ENA_PLAY, genre=drama,…, dow=1,2, density=comfy|compact, sel=<구간 id>.
// 기본: 자사 라인업, 지난달부터 8개월. 저장(엑셀)·인쇄(PDF)는 화면의 '저장·인쇄'에서 조건을 골라 /lineup/print · /api/lineup/export로 연다.
import type { Metadata } from "next";
import { kstToday } from "@/lib/workspace/dates";
import { lastMonth, parseLineupQuery } from "@/lib/lineup/viewModel";
import LineupView from "./LineupView";

export const metadata: Metadata = { title: "라인업" };
export const dynamic = "force-dynamic";

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function LineupPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const defaultFrom = lastMonth(kstToday());
  const q = parseLineupQuery((k) => first(sp[k]), defaultFrom);
  const sel = first(sp.sel);
  return <LineupView initial={{ ...q, sel: sel && /^[0-9a-f-]{36}$/.test(sel) ? sel : null }} defaultFrom={defaultFrom} />;
}
