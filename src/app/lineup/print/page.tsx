// 라인업 인쇄·PDF 화면(2026-11-25 사용자 요청) — 저장·인쇄 창에서 고른 조건(보기·기간·채널·장르·요일·용지·밀도)으로
// 용지 폭(A4·A3 가로)에 맞춘 격자를 그리고 인쇄 창을 연다. PDF는 인쇄 창에서 'PDF로 저장'(앱의 다른 보고서 PDF와 같은 방식).
// 머리에 '대외비'·조건·출력 시각·자료 기준일, 막대에 다 못 쓴 제목은 번호 각주로 풀네임을 쓴다. 접근은 로그인 사용자(proxy.ts + API).
import type { Metadata } from "next";
import { kstToday } from "@/lib/workspace/dates";
import { parseLineupQuery, weekStartOf } from "@/lib/lineup/viewModel";
import PrintView from "./PrintView";

export const metadata: Metadata = { title: "라인업 인쇄" };
export const dynamic = "force-dynamic";

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function LineupPrintPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const q = parseLineupQuery((k) => first(sp[k]), weekStartOf(kstToday()), kstToday().slice(0, 7));
  return <PrintView query={q} autoPrint={first(sp.auto) !== "0"} />;
}
