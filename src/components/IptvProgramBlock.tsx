"use client";
// 프로그램 "IPTV 셋톱 보조 지표" 블록(IPTV 활용 3단계 3순위, 2026-11-11). 값은 /api/iptv/program-block(DB 함수 iptv_program_block)이 계산하고 여기서는 표시만 한다.
// variant="full": 프로그램 성과 화면용 표 / variant="line": 주요 콘텐츠 리뷰 카드용 한 줄(방송 채널·KPI 타깃 한 줄만).
// IPTV 는 보조 자료다 — 닐슨 값과 같은 표에 섞지 않고, 타깃 이름에 항상 "IPTV"를 붙인다.
import { useEffect, useState } from "react";
import { summarizeIptvBlockRow, type IptvProgramBlock, type IptvProgramBlockRow } from "@/lib/iptvProgramBlockText";

const CHANNEL_LABEL: Record<string, string> = { ENA: "ENA", "ENA Drama": "ENA DRAMA", "ENA Play": "ENA PLAY", "ENA Story": "ENA STORY", OLIFE: "OLIFE", ONCE: "ONCE", skyUHD: "skyUHD" };
type Kind = "household" | "p2049";
const KIND_ORDER: Kind[] = ["p2049", "household"];
const TARGET_LABEL: Record<Kind, string> = { household: "가구", p2049: "수2049" };
const MISSING = "—";
const bandText = (b: string | null) => (b ? `${Number(b.slice(0, 2))}~${Number(b.slice(3, 5))}시` : MISSING);
const md =(d: string | null) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : "—");
const fmtR = (v: number | null) => (v === null ? "—" : v < 0.01 ? v.toFixed(4) : v.toFixed(3));
const NOTE =
  "IPTV 3사 셋톱(TV INDEX) 값으로 보조 자료입니다. 닐슨 값과 비교·합산하지 않습니다. 도달자 1인당 시청 = 1분 시청자 × 방영 분 ÷ 도달자(본방 방영 중앙값). 순위는 이 작품 본방과 30분 이상 겹친 경쟁·UHD 채널 본방 프로그램 가운데 순위입니다.";

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
  if (!state) return <p className="mt-4 text-[12.5px] text-zinc-400" role="status">IPTV 셋톱 불러오는 중…</p>;
  const block = state.block;
  if (!block || block.rows.length === 0) return null;
  // 프로그램 성과 '채널별 성과 표'와 같은 모양 — 채널당 한 줄, 타깃(수2049 → 가구)마다 칸 묶음, 마지막은 횟수
  const kinds = KIND_ORDER.filter((k) => block.rows.some((r) => r.targetKind === k));
  const channels = [...new Set(block.rows.map((r) => r.channelName))];
  const cell = (ch: string, k: Kind) => block.rows.find((r) => r.channelName === ch && r.targetKind === k);
  const asOfNote = block.shifted ? " (IPTV 자료 마지막 날 기준)" : "";
  return (
    <section className="mt-4" aria-label="IPTV 셋톱 보조 지표">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 className="text-[15px] font-bold text-zinc-900">IPTV 셋톱</h3>
        <span className="text-[13px] text-zinc-500">
          보조 자료 · 최근 12주 · {md(block.rows[0]?.windowFrom ?? null)}~{md(block.asOf)}
          {asOfNote}
        </span>
      </div>
      <div className="dense-grid mt-1.5 max-w-5xl overflow-x-auto rounded-lg border border-zinc-200 bg-white" tabIndex={0} role="region" aria-label="IPTV 셋톱 채널별 표">
        <table className="w-full min-w-[640px] text-[14px]">
          <thead className="bg-zinc-50 text-[12px] text-zinc-500">
            <tr>
              <th rowSpan={2} className="whitespace-nowrap px-3 py-2 text-left align-bottom font-medium">
                채널
              </th>
              {kinds.map((k) => (
                <th key={k} colSpan={3} className="whitespace-nowrap border-l border-zinc-200 px-3 pt-2 text-center font-medium text-zinc-700">
                  {TARGET_LABEL[k]}
                </th>
              ))}
              <th rowSpan={2} className="whitespace-nowrap border-l border-zinc-200 px-3 py-2 text-center align-bottom font-medium">
                방영횟수
              </th>
            </tr>
            <tr>
              {kinds.map((k) => [
                <th key={`${k}r`} className="whitespace-nowrap border-l border-zinc-200 px-3 pb-2 text-center font-normal">
                  시청률
                </th>,
                <th key={`${k}a`} className="whitespace-nowrap px-3 pb-2 text-center font-normal">
                  도달률
                </th>,
                <th key={`${k}m`} className="whitespace-nowrap px-3 pb-2 text-center font-normal">
                  1인당 시청
                </th>,
              ])}
            </tr>
          </thead>
          <tbody>
            {channels.map((ch) => {
              const any = block.rows.find((r) => r.channelName === ch)!;
              const ended = block.rows.some((r) => r.channelName === ch && r.iptvLastDate && r.iptvLastDate < r.windowTo);
              return (
                <tr key={ch} className="border-t border-zinc-100">
                  <td className="whitespace-nowrap px-3 py-2 font-medium text-zinc-900">
                    {CHANNEL_LABEL[ch] ?? ch}
                    {ended && <span className="ml-1.5 text-[11.5px] font-normal text-zinc-400">{md(any.iptvLastDate)}까지</span>}
                  </td>
                  {kinds.map((k) => {
                    const r = cell(ch, k);
                    return [
                      <td key={`${k}r`} className="border-l border-zinc-100 px-3 py-2 text-center tabular-nums text-zinc-900">
                        {r ? fmtR(r.avgRating) : MISSING}
                      </td>,
                      <td key={`${k}a`} className="px-3 py-2 text-center tabular-nums text-zinc-700">
                        {r?.avgReachRate == null ? MISSING : `${r.avgReachRate.toFixed(2)}%`}
                      </td>,
                      <td key={`${k}m`} className="px-3 py-2 text-center tabular-nums text-zinc-700">
                        {r?.minutesPerReacher == null ? MISSING : `${r.minutesPerReacher.toFixed(0)}분`}
                      </td>,
                    ];
                  })}
                  <td className="whitespace-nowrap border-l border-zinc-100 px-3 py-2 text-center tabular-nums text-zinc-800">{any.firstRunAirings > 0 ? `본방 ${any.firstRunAirings}회` : `재방 ${any.airings}회`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[12px] text-zinc-500">IPTV 셋톱 값 · 닐슨과 비교·합산하지 않음 · 1인당 시청 = 도달자 1명이 본 분</p>
      <details className="mt-2 max-w-5xl rounded-md border border-zinc-200 bg-white">
        <summary className="cursor-pointer px-3 py-2 text-[13px] font-medium text-zinc-700">자세히 보기 · 채널 평균 대비 시청 시간·동시간대 경쟁작 순위</summary>
        <div className="dense-grid overflow-x-auto border-t border-zinc-100 px-3 py-2" tabIndex={0} role="region" aria-label="IPTV 셋톱 자세히 보기 표">
          <table className="w-full min-w-[640px] text-[12px]">
            <thead className="text-zinc-500">
              <tr>
                <th className="py-1 pr-3 text-left font-medium">채널·타깃</th>
                <th className="py-1 pr-3 text-left font-medium">주 시간대</th>
                <th className="py-1 pr-3 text-right font-medium">1인당 시청(채널 평균)</th>
                <th className="py-1 pr-3 text-left font-medium">동시간대 경쟁작 중</th>
                <th className="py-1 text-left font-medium">경쟁작 최고</th>
              </tr>
            </thead>
            <tbody>
              {block.rows.map((r) => (
                <tr key={`${r.channelName}|${r.targetKind}`} className="border-t border-zinc-100">
                  <td className="whitespace-nowrap py-1 pr-3">
                    {CHANNEL_LABEL[r.channelName] ?? r.channelName} · {TARGET_LABEL[r.targetKind]}
                  </td>
                  <td className="whitespace-nowrap py-1 pr-3 tabular-nums">{bandText(r.mainSlotBand)}</td>
                  <td className="whitespace-nowrap py-1 pr-3 text-right tabular-nums">
                    {r.minutesPerReacher === null ? MISSING : `${r.minutesPerReacher.toFixed(0)}분`}
                    {r.channelBaseMinutes !== null && <span className="text-zinc-500"> ({r.channelBaseMinutes.toFixed(0)}분)</span>}
                  </td>
                  <td className="py-1 pr-3">
                    <RankCell r={r} />
                  </td>
                  <td className="py-1 text-zinc-600">{r.topPeerProgram ? `${r.topPeerChannel} ‘${r.topPeerProgram}’ ${fmtR(r.topPeerRating)}` : MISSING}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[12px] leading-relaxed text-zinc-500">{NOTE}</p>
        </div>
      </details>
    </section>
  );
}
