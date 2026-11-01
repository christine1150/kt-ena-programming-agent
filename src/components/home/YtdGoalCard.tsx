"use client";

// 올해 목표 대비 누적 시청률 카드(사용자 지시 2026-11-02, 오늘만 특별 노출).
// 판정·달성률은 서버(ytdGoalBriefing)가 계산해 내려준 값을 그대로 보여주기만 한다.
import type { YtdGoalBriefing, YtdGoalRow, YtdGoalVerdict } from "@/lib/ytdGoalBriefing";

const VERDICT_STYLE: Record<YtdGoalVerdict, string> = {
  초과: "bg-emerald-50 text-emerald-700",
  달성: "bg-sky-50 text-sky-700",
  미달: "bg-rose-50 text-rose-700",
};

function fmtRating(v: number, code: string): string {
  const s = v.toFixed(code === "SKYUHD" ? 4 : 3);
  return parseFloat(s) === 0 ? "0" : s;
}

function md(date: string): string {
  const [, m, d] = date.split("-");
  return `${parseInt(m, 10)}/${parseInt(d, 10)}`;
}

function rankText(r: YtdGoalRow): string | null {
  if (r.peer) return `UHD 경쟁 ${r.peer.total}개 중 ${r.peer.rank}위(목표 ${r.peer.targetRank}위)`;
  if (r.ytdRank !== null && r.targetRankNum !== null) return `누적 ${r.ytdRank}위(목표 ${r.targetRankNum}위)`;
  if (r.ytdRank !== null) return `누적 ${r.ytdRank}위`;
  return null;
}

export default function YtdGoalCard({ briefing, themeColorByCode }: { briefing: YtdGoalBriefing; themeColorByCode: Map<string, string | null> }) {
  return (
    <section className="rounded-xl bg-white px-4 py-4 ring-1 ring-zinc-200/80 sm:px-9">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-[15px] font-bold text-zinc-900">올해 목표 대비 누적 시청률</h2>
        <p className="text-[11px] text-zinc-400">
          {md(briefing.dateFrom)}~{md(briefing.dateTo)} 누적 · 목표 ±1% 이내는 달성
        </p>
      </div>
      <ul className="mt-3 divide-y divide-zinc-100">
        {briefing.rows.map((r) => {
          const rank = rankText(r);
          const rankVerdict = r.peer ? r.peerVerdict : r.rankVerdict;
          return (
            <li key={r.code} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5 text-[12.5px]">
              <span className="w-24 shrink-0 font-bold" style={{ color: themeColorByCode.get(r.code) ?? "#3f3f46" }}>
                {r.name}
              </span>
              <span className="text-[11px] text-zinc-400">{r.targetLabel}</span>
              <span className="tabular-nums text-zinc-800">
                누적 <b className="font-semibold">{fmtRating(r.ytdRating, r.code)}</b> / 목표 {fmtRating(r.targetRating, r.code)}
                <span className="ml-1 text-zinc-500">({r.achievementPct.toFixed(1)}%)</span>
              </span>
              <span className={`rounded px-1.5 text-[11px] font-semibold leading-5 ${VERDICT_STYLE[r.verdict]}`}>{r.verdict}</span>
              {rank && (
                <span className="text-[11.5px] text-zinc-500">
                  {rank}
                  {rankVerdict && <span className={`ml-1 rounded px-1 text-[10.5px] font-medium ${VERDICT_STYLE[rankVerdict]}`}>{rankVerdict}</span>}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
