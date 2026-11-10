"use client";
// 구매 검토 "다른 채널 IPTV 성적" 블록(IPTV 활용 3단계 5순위, 2026-11-11). 값은 /api/iptv/peer-record(DB 함수 iptv_peer_record)가 계산하고 여기서는 표시만 한다.
// 이 작품이 다른 채널에서 거둔 IPTV 셋톱 성적 — 닐슨 예측과 같은 표에 섞지 않고, 타깃 이름에 항상 "IPTV"를 붙인다. 가격·ROI 는 다루지 않는다.
import { useEffect, useState } from "react";
import { isRerunOnlyPeer, isWideBandRatio, isThinPeerSample, peerRatioText, selectPeerRows, type IptvPeerRecord, type IptvTargetKind } from "@/lib/iptvPeerRecordText";

const TARGET_LABEL: Record<IptvTargetKind, string> = { household: "가구", p2049: "수도권 2049(추정)" };
const md = (d: string | null) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : "—");
const fmtR = (v: number | null) => (v === null ? "—" : v < 0.01 ? v.toFixed(4) : v.toFixed(3));
const bandText = (b: string | null) => (b ? `${Number(b.slice(0, 2))}~${Number(b.slice(3, 5))}시` : "—");
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

export function IptvPeerRecord({ names, to, targets }: { names: string[]; to?: string | null; targets: IptvTargetKind[] }) {
  const state = usePeerRecord(names, to);
  if (!state) return <p className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-[12.5px] text-zinc-400" role="status">다른 채널 IPTV 성적 불러오는 중…</p>;
  const record = state.record;
  const sections = record ? targets.map((kind) => ({ kind, rows: selectPeerRows(record.rows, kind) })).filter((s) => s.rows.length > 0) : [];
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4" aria-label="다른 채널 IPTV 성적">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 className="text-sm font-semibold text-zinc-900">다른 채널 IPTV 성적</h3>
        <span className="text-[12px] text-zinc-500">
          보조 자료 · 최근 {record?.weeks ?? 52}주{record ? ` · ${md(record.rows[0]?.windowFrom ?? null)}~${md(record.asOf)}` : ""}
          {record?.shifted ? " (IPTV 자료 마지막 날 기준)" : ""}
        </span>
      </div>
      {state.error && <p className="mt-2 text-[12.5px] text-amber-700">IPTV 성적을 불러오지 못했습니다: {state.error}</p>}
      {!state.error && (!record || record.keys.length === 0) && <p className="mt-2 text-[12.5px] text-zinc-500">IPTV 자료에서 이 작품과 이름이 맞는 프로그램을 찾지 못했습니다(최근 {record?.weeks ?? 52}주 다른 채널 방영 없음 또는 이름이 달라 대응되지 않음).</p>}
      {!state.error && record && record.keys.length > 0 && sections.length === 0 && <p className="mt-2 text-[12.5px] text-zinc-500">다른 채널에서 최근 {record.weeks}주 동안 {`${3}회 이상`} 방영된 기록이 없거나, 선택한 타깃의 IPTV 값이 없습니다.</p>}
      {sections.map(({ kind, rows }) => (
        <div key={kind} className="mt-3">
          <p className="text-[12.5px] font-medium text-zinc-700">{TARGET_LABEL[kind]} 기준 · IPTV</p>
          <div className="mt-1 overflow-x-auto" tabIndex={0} role="region" aria-label="가로로 스크롤되는 표">
            {/* 앱 공통 규칙상 이 영역의 표는 화면 폭에 맞춰 칸 안에서 줄바꿈한다(globals.css) — 칸 수를 줄이고 폭을 정해 숫자가 갈라지지 않게 한다 */}
            <table className="w-full table-fixed text-left text-[13px]">
              <colgroup>
                <col className="w-[24%]" />
                <col className="w-[14%]" />
                <col className="w-[14%]" />
                <col className="w-[14%]" />
                <col className="w-[18%]" />
                <col className="w-[16%]" />
              </colgroup>
              <thead>
                <tr className="text-zinc-400">
                  <th className="pb-1.5 pr-3 font-medium">채널</th>
                  <th className="pb-1.5 pr-3 font-medium">주 편성 시간대</th>
                  <th className="pb-1.5 pr-3 text-right font-medium">시청률</th>
                  <th className="pb-1.5 pr-3 text-right font-medium">도달률</th>
                  <th className="pb-1.5 pr-3 text-right font-medium">평소 대비</th>
                  <th className="pb-1.5 text-right font-medium">1인당 시청</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const thin = isThinPeerSample(r);
                  const ratio = peerRatioText(r);
                  return (
                    <tr key={`${r.channelName}|${r.targetKind}`} className="border-t border-zinc-100 align-top">
                      <td className="py-1.5 pr-3 font-medium text-zinc-800">
                        {r.channelName}
                        <span className="block text-[11.5px] font-normal text-zinc-400">
                          {isRerunOnlyPeer(r) ? `재방 ${r.airings}회` : `본방 ${r.firstRunAirings}회`} · {md(r.firstDate)}~{md(r.lastDate)}
                        </span>
                      </td>
                      <td className="py-1.5 pr-3 text-zinc-600">{bandText(r.mainSlotBand)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-zinc-800">{fmtR(r.avgRating)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-zinc-600">{r.avgReachRate === null ? "—" : `${r.avgReachRate.toFixed(2)}%`}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">
                        <b className="font-semibold text-zinc-800">{ratio ?? "—"}</b>
                        {r.baseRating !== null && <span className="block text-[11.5px] text-zinc-400">평소 {fmtR(r.baseRating)}</span>}
                        {isWideBandRatio(r) && <span className="block text-[11.5px] text-amber-700">구간 편차 큼</span>}
                        {thin && <span className="block text-[11.5px] text-amber-700">표본 적음</span>}
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-zinc-800">{r.minutesPerReacher === null ? "—" : `${r.minutesPerReacher.toFixed(0)}분`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <p className="mt-2 text-[12px] leading-relaxed text-zinc-400">{NOTE}</p>
    </section>
  );
}
