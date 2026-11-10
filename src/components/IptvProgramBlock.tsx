"use client";
// 프로그램 "IPTV 셋톱 보조 지표" 블록(IPTV 활용 3단계 3순위, 2026-11-11). 값은 /api/iptv/program-block(DB 함수 iptv_program_block)이 계산하고 여기서는 표시만 한다.
// variant="full": 프로그램 성과 화면용 표 / variant="line": 주요 콘텐츠 리뷰 카드용 한 줄(방송 채널·KPI 타깃 한 줄만).
// IPTV 는 보조 자료다 — 닐슨 값과 같은 표에 섞지 않고, 타깃 이름에 항상 "IPTV"를 붙인다.
import { useEffect, useState } from "react";
import { summarizeIptvBlockRow, type IptvProgramBlock, type IptvProgramBlockRow } from "@/lib/iptvProgramBlockText";

const CHANNEL_LABEL: Record<string, string> = { ENA: "ENA", "ENA Drama": "ENA DRAMA", "ENA Play": "ENA PLAY", "ENA Story": "ENA STORY", OLIFE: "OLIFE", ONCE: "ONCE", skyUHD: "skyUHD" };
const TARGET_LABEL: Record<string, string> = { household: "가구", p2049: "수도권 2049(추정)" };
const md = (d: string | null) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : "—");
const fmtR = (v: number | null) => (v === null ? "—" : v < 0.01 ? v.toFixed(4) : v.toFixed(3));
const NOTE =
  "IPTV 3사 셋톱(TV INDEX) 값으로 보조 자료입니다. 가입 가구만 재고 수도권 2049는 셋톱에서 추정한 값이라 닐슨 값과 비교·합산하지 않습니다. 도달자 1인당 시청 = 1분 시청자 × 방영 분 ÷ 도달자(본방 방영 중앙값). 순위는 이 작품 본방과 30분 이상 겹친 경쟁·UHD 채널 본방 프로그램 가운데 순위입니다.";

function useIptvBlock(names: string[], to: string | null | undefined) {
  const key = `${names.join("|")}@${to ?? ""}`;
  const [state, setState] = useState<{ key: string; block: IptvProgramBlock | null; error: boolean } | null>(null);
  useEffect(() => {
    if (names.length === 0) return;
    const ac = new AbortController();
    const qs = new URLSearchParams();
    names.forEach((n) => qs.append("name", n));
    if (to) qs.set("to", to);
    fetch(`/api/iptv/program-block?${qs}`, { signal: ac.signal })
      .then((r) => r.json())
      .then((j) => setState({ key, block: j.ok ? (j.block as IptvProgramBlock | null) : null, error: !j.ok }))
      .catch(() => !ac.signal.aborted && setState({ key, block: null, error: true }));
    return () => ac.abort();
    // names 배열은 매 렌더 새로 만들어질 수 있어 문자열 키로만 다시 부른다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state?.key === key ? state : null;
}

function RankCell({ r }: { r: IptvProgramBlockRow }) {
  if (r.peerN === 0 || r.ratingRank === null) return <span className="text-zinc-400">—</span>;
  return (
    <span>
      {r.peerN}편 중 시청률 <b className="font-semibold text-zinc-800">{r.ratingRank}위</b>
      {r.minutesRank !== null && (
        <>
          {" "}· 1인당 시청 <b className="font-semibold text-zinc-800">{r.minutesRank}위</b>
        </>
      )}
    </span>
  );
}

export function IptvProgramBlock({ names, to, variant = "full", channelName, targetKind }: { names: string[]; to?: string | null; variant?: "full" | "line"; channelName?: string; targetKind?: "household" | "p2049" }) {
  const state = useIptvBlock(names, to);
  if (variant === "line") {
    const row = state?.block?.rows.find((r) => (!channelName || r.channelName === channelName) && (!targetKind || r.targetKind === targetKind));
    const text = row ? summarizeIptvBlockRow(row) : null;
    if (!row || !text) return null;
    return (
      <p className="mt-1.5 text-[12.5px] leading-snug text-zinc-500" title={NOTE}>
        <span className="font-medium text-zinc-600">IPTV 셋톱(보조, 최근 12주 본방·{md(row.iptvLastDate && row.iptvLastDate < row.windowTo ? row.iptvLastDate : row.windowTo)}까지)</span> {text}
      </p>
    );
  }
  if (!state) return <p className="mt-4 text-[12.5px] text-zinc-400" role="status">IPTV 셋톱 보조 지표 불러오는 중…</p>;
  const block = state.block;
  if (!block || block.rows.length === 0) return null;
  return (
    <section className="mt-4 rounded-xl border border-zinc-200 bg-white p-4" aria-label="IPTV 셋톱 보조 지표">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 className="text-[14px] font-semibold text-zinc-800">IPTV 셋톱 보조 지표</h3>
        <span className="text-[12px] text-zinc-500">
          보조 자료 · 최근 12주 본방 · {md(block.rows[0]?.windowFrom ?? null)}~{md(block.asOf)}
          {block.shifted ? " (IPTV 자료 마지막 날 기준)" : ""}
        </span>
      </div>
      <div className="mt-2 overflow-x-auto" tabIndex={0} role="region" aria-label="가로로 스크롤되는 표">
        {/* 앱 공통 규칙상 이 영역의 표는 화면 폭에 맞춰 칸 안에서 줄바꿈한다(globals.css) — 칸 수를 줄이고 폭을 정해 숫자가 갈라지지 않게 한다 */}
        <table className="w-full table-fixed text-left text-[13px]">
          <colgroup>
            <col className="w-[15%]" />
            <col className="w-[17%]" />
            <col className="w-[11%]" />
            <col className="w-[11%]" />
            <col className="w-[16%]" />
            <col className="w-[30%]" />
          </colgroup>
          <thead>
            <tr className="text-zinc-400">
              <th className="pb-1.5 pr-3 font-medium">채널</th>
              <th className="pb-1.5 pr-3 font-medium">타깃(IPTV)</th>
              <th className="pb-1.5 pr-3 text-right font-medium">시청률</th>
              <th className="pb-1.5 pr-3 text-right font-medium">도달률</th>
              <th className="pb-1.5 pr-3 text-right font-medium">1인당 시청(평소)</th>
              <th className="pb-1.5 font-medium">동시간대 경쟁작 중</th>
            </tr>
          </thead>
          <tbody>
            {block.rows.map((r) => (
              <tr key={`${r.channelName}|${r.targetKind}`} className="border-t border-zinc-100 align-top">
                <td className="py-1.5 pr-3 font-medium text-zinc-800">
                  {CHANNEL_LABEL[r.channelName] ?? r.channelName}
                  <span className="block text-[11.5px] font-normal text-zinc-400">본방 {r.firstRunAirings}회</span>
                </td>
                <td className="py-1.5 pr-3 text-zinc-600">
                  {TARGET_LABEL[r.targetKind] ?? r.targetKind}
                  {r.iptvLastDate && r.iptvLastDate < r.windowTo && <span className="block text-[11.5px] text-zinc-400">{md(r.iptvLastDate)}까지</span>}
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums text-zinc-800">{fmtR(r.avgRating)}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums text-zinc-600">{r.avgReachRate === null ? "—" : `${r.avgReachRate.toFixed(2)}%`}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">
                  <b className="font-semibold text-zinc-800">{r.minutesPerReacher === null ? "—" : `${r.minutesPerReacher.toFixed(0)}분`}</b>
                  {r.channelBaseMinutes !== null && <span className="block text-[11.5px] text-zinc-400">평소 {r.channelBaseMinutes.toFixed(0)}분</span>}
                </td>
                <td className="py-1.5 text-zinc-600">
                  <RankCell r={r} />
                  {r.topPeerProgram && (
                    <span className="block text-[11.5px] text-zinc-400">
                      최고 {r.topPeerChannel} ‘{r.topPeerProgram}’ {fmtR(r.topPeerRating)}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-zinc-400">{NOTE}</p>
    </section>
  );
}
