"use client";
// 구매 검토 "다른 채널 IPTV 성적" 블록(IPTV 활용 3단계 5순위, 2026-11-11). 값은 /api/iptv/peer-record(DB 함수 iptv_peer_record)가 계산하고 여기서는 표시만 한다.
// 이 작품이 다른 채널에서 거둔 IPTV 셋톱 성적 — 닐슨 예측과 같은 표에 섞지 않고, 타깃 이름에 항상 "IPTV"를 붙인다. 가격·ROI 는 다루지 않는다.
// 모양은 프로그램 성과 '채널별 성과 표'와 같다(채널당 한 줄·타깃별 칸 묶음). 설명·보조 값은 아래 '자세히 보기'로 뺀다(2026-11-11 사용자 지시).
import { useEffect, useState } from "react";
import { isRerunOnlyPeer, isWideBandRatio, isThinPeerSample, selectPeerRows, type IptvPeerRecord, type IptvPeerRow, type IptvTargetKind } from "@/lib/iptvPeerRecordText";

const TARGET_LABEL: Record<IptvTargetKind, string> = { household: "가구", p2049: "수2049(추정)" };
const TARGET_ORDER: IptvTargetKind[] = ["p2049", "household"];
const MISSING = "—";
// 52주 창이라 월/일만 쓰면 11/11~11/9 처럼 해가 헷갈린다 → 연도 두 자리를 붙인다
const md = (d: string | null) => (d ? `${d.slice(2, 4)}.${Number(d.slice(5, 7))}.${Number(d.slice(8, 10))}` : MISSING);
const fmtR = (v: number | null) => (v === null ? MISSING : v < 0.01 ? v.toFixed(4) : v.toFixed(3));
const bandText = (b: string | null) => (b ? `${Number(b.slice(0, 2))}~${Number(b.slice(3, 5))}시` : MISSING);
const NOTE =
  "IPTV 3사 셋톱(TV INDEX) 값으로 보조 자료입니다. 가입 가구만 재고 수도권 2049는 셋톱에서 추정한 값이라 위 닐슨 예측과 비교·합산하지 않습니다. ‘평소 대비’는 같은 채널·같은 시간대(8대 구간)에서 다른 프로그램 본방의 평소 시청률과 견준 배수이며, 시간대 구간이 넓어 참고로만 봅니다. 본방 태그가 없는 작품은 전체 방영으로 요약합니다.";

function usePeerRecord(names: string[], to: string | null | undefined) {
  const key = `${names.join("|")}@${to ?? ""}`;
  const [state, setState] = useState<{ key: string; record: IptvPeerRecord | null; error: string | null } | null>(null);
  useEffect(() => {
    if (names.length === 0) return;
    const ac = new AbortController();
    const qs = new URLSearchParams();
    names.forEach((n) => qs.append("name", n));
    if (to) qs.set("to", to);
    fetch(`/api/iptv/peer-record?${qs}`, { signal: ac.signal })
      .then((r) => r.json())
      .then((j) => setState({ key, record: j.ok ? (j.record as IptvPeerRecord | null) : null, error: j.ok ? null : String(j.message ?? "조회 실패") }))
      .catch(() => !ac.signal.aborted && setState({ key, record: null, error: "조회 실패" }));
    return () => ac.abort();
    // names 배열은 매 렌더 새로 만들어질 수 있어 문자열 키로만 다시 부른다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state?.key === key ? state : null;
}

/** 표 한 칸 — "0.0034 · 1.58배"(평소 대비는 표본 적음·구간 편차 큼 표시를 옆에) */
function RatingCell({ r }: { r: IptvPeerRow | undefined }) {
  if (!r) return <span className="text-zinc-400">{MISSING}</span>;
  const flag = isThinPeerSample(r) ? "표본 적음" : isWideBandRatio(r) ? "구간 편차 큼" : null;
  return (
    <span className="inline-flex flex-wrap items-baseline justify-center gap-x-1.5 whitespace-nowrap tabular-nums">
      <span className="text-zinc-900">{fmtR(r.avgRating)}</span>
      {r.ratio !== null && <span className="text-zinc-600">({r.ratio.toFixed(2)}배)</span>}
      {flag && <span className="text-[11.5px] text-amber-700">{flag}</span>}
    </span>
  );
}

export function IptvPeerRecord({ names, to, targets }: { names: string[]; to?: string | null; targets: IptvTargetKind[] }) {
  const state = usePeerRecord(names, to);
  if (!state) return <p className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-[12.5px] text-zinc-400" role="status">다른 채널 IPTV 성적 불러오는 중…</p>;
  const record = state.record;
  const kinds = TARGET_ORDER.filter((k) => targets.includes(k));
  const picked = record ? kinds.flatMap((k) => selectPeerRows(record.rows, k)) : [];
  // 채널당 한 줄 — 본방이 많은 채널 먼저
  const channels = [...new Set(picked.map((r) => r.channelName))].sort((a, b) => {
    const top = (n: string) => Math.max(...picked.filter((r) => r.channelName === n).map((r) => r.firstRunAirings));
    return top(b) - top(a) || a.localeCompare(b, "ko");
  });
  const cell = (ch: string, k: IptvTargetKind) => picked.find((r) => r.channelName === ch && r.targetKind === k);
  const weeks = record?.weeks ?? 52;
  const msg = state.error
    ? `IPTV 성적을 불러오지 못했습니다: ${state.error}`
    : !record || record.keys.length === 0
      ? `IPTV 자료에서 이 작품과 이름이 맞는 다른 채널 방영을 찾지 못했습니다(최근 ${weeks}주).`
      : channels.length === 0
        ? `다른 채널에서 최근 ${weeks}주 동안 3회 이상 방영된 기록이 없거나 선택한 타깃의 IPTV 값이 없습니다.`
        : null;
  return (
    <section aria-label="다른 채널 IPTV 성적">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 className="text-[15px] font-bold text-zinc-900">다른 채널 IPTV 성적</h3>
        <span className="text-[13px] text-zinc-500">
          보조 자료 · 최근 {weeks}주{record && record.rows[0] ? ` · ${md(record.rows[0].windowFrom)}~${md(record.asOf)}` : ""}
          {record?.shifted ? " (IPTV 자료 마지막 날 기준)" : ""}
        </span>
      </div>
      {msg && <p className={`mt-1.5 text-[13px] ${state.error ? "text-amber-700" : "text-zinc-500"}`}>{msg}</p>}
      {!msg && (
        <>
          <div className="dense-grid mt-1.5 max-w-5xl overflow-x-auto rounded-lg border border-zinc-200 bg-white" tabIndex={0} role="region" aria-label="다른 채널 IPTV 성적 표">
            <table className="w-full min-w-[560px] text-[14px]">
              <thead className="bg-zinc-50 text-[12px] text-zinc-500">
                <tr>
                  <th rowSpan={2} className="whitespace-nowrap px-3 py-2 text-left align-bottom font-medium">
                    채널
                  </th>
                  {kinds.map((k) => (
                    <th key={k} colSpan={2} className="whitespace-nowrap border-l border-zinc-200 px-3 pt-2 text-center font-medium text-zinc-700">
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
                      시청률(평소 대비)
                    </th>,
                    <th key={`${k}m`} className="whitespace-nowrap px-3 pb-2 text-center font-normal">
                      1인당 시청
                    </th>,
                  ])}
                </tr>
              </thead>
              <tbody>
                {channels.map((ch) => {
                  const any = picked.find((r) => r.channelName === ch)!;
                  return (
                    <tr key={ch} className="border-t border-zinc-100">
                      <td className="whitespace-nowrap px-3 py-2 font-medium text-zinc-900">{ch}</td>
                      {kinds.map((k) => {
                        const r = cell(ch, k);
                        return [
                          <td key={`${k}r`} className="border-l border-zinc-100 px-3 py-2 text-center">
                            <RatingCell r={r} />
                          </td>,
                          <td key={`${k}m`} className="px-3 py-2 text-center tabular-nums text-zinc-700">
                            {r?.minutesPerReacher == null ? MISSING : `${r.minutesPerReacher.toFixed(0)}분`}
                          </td>,
                        ];
                      })}
                      <td className="whitespace-nowrap border-l border-zinc-100 px-3 py-2 text-center tabular-nums text-zinc-800">
                        {isRerunOnlyPeer(any) ? `재방 ${any.airings}회` : `본방 ${any.firstRunAirings}회`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-[12px] text-zinc-500">IPTV 셋톱 값 · 닐슨 예측과 비교·합산하지 않음 · 수2049는 셋톱 추정 · 괄호는 같은 채널·시간대 다른 프로그램 본방 평소 대비</p>
          <details className="mt-2 max-w-5xl rounded-md border border-zinc-200 bg-white">
            <summary className="cursor-pointer px-3 py-2 text-[13px] font-medium text-zinc-700">자세히 보기 · 시간대·도달률·평소 시청률·방영 기간</summary>
            <div className="dense-grid overflow-x-auto border-t border-zinc-100 px-3 py-2" tabIndex={0} role="region" aria-label="다른 채널 IPTV 성적 자세히 보기 표">
              <table className="w-full min-w-[560px] text-[12px]">
                <thead className="text-zinc-500">
                  <tr>
                    <th className="py-1 pr-3 text-left font-medium">채널·타깃</th>
                    <th className="py-1 pr-3 text-left font-medium">주 편성 시간대</th>
                    <th className="py-1 pr-3 text-right font-medium">도달률</th>
                    <th className="py-1 pr-3 text-right font-medium">평소 시청률</th>
                    <th className="py-1 text-left font-medium">방영 기간</th>
                  </tr>
                </thead>
                <tbody>
                  {channels.flatMap((ch) =>
                    kinds.map((k) => cell(ch, k)).filter((r): r is IptvPeerRow => !!r).map((r) => (
                      <tr key={`${r.channelName}|${r.targetKind}`} className="border-t border-zinc-100">
                        <td className="whitespace-nowrap py-1 pr-3">
                          {r.channelName} · {TARGET_LABEL[r.targetKind]}
                        </td>
                        <td className="whitespace-nowrap py-1 pr-3 tabular-nums">{bandText(r.mainSlotBand)}</td>
                        <td className="py-1 pr-3 text-right tabular-nums">{r.avgReachRate === null ? MISSING : `${r.avgReachRate.toFixed(2)}%`}</td>
                        <td className="py-1 pr-3 text-right tabular-nums">{fmtR(r.baseRating)}</td>
                        <td className="whitespace-nowrap py-1 tabular-nums">
                          {md(r.firstDate)}~{md(r.lastDate)}
                        </td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
              <p className="mt-2 text-[12px] leading-relaxed text-zinc-500">{NOTE}</p>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
