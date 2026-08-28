// Phase 8(2026-08-28, 계획서 J절 §07) — 종합(포트폴리오) 리포트 전용 차트 5종. §06 필수 차트와
// 같은 원칙(새 라이브러리 없이 SVG/HTML 직접 작성)을 그대로 따르고, 스케일 헬퍼는 charts.tsx에서
// 재사용한다. "본방→재방 흐름"은 설계서 §10이 제안한 "생키 또는 단계 막대" 중 단계 막대를 택했다
// — 라이브러리 없이 비례 폭 곡선(생키)을 손으로 그리면 값이 왜곡되기 쉬워, 정확한 값 표시를
// 우선하는 이 프로젝트 관례에 단계 막대가 더 맞는다고 판단.
import { ChartCaption, scaleLinear, yDomainFrom, W, H, PAD } from "./charts";
import type { ChartCaptionInfo } from "@/lib/audienceReport/reportModel";
import type { PeerRow, PipelineEdge, SlotOverlapRow } from "@/lib/audienceReport/portfolioModel";
import type { HourlyPatternRow, DailyTrendPoint } from "@/lib/audienceReport/dataCollector";

/** 1. 그룹별 Peer 스캐터 — 수준(x) × 추세(y), 원 크기 = Reach. */
export function PeerScatterChart({ peers, caption }: { peers: PeerRow[]; caption: ChartCaptionInfo }) {
  const xDomain = yDomainFrom(peers.map((p) => p.level));
  const yDomain = yDomainFrom(peers.map((p) => p.trend), 0.3);
  const x = scaleLinear(xDomain, [PAD.left + 20, W - PAD.right - 20]);
  const y = scaleLinear(yDomain, [H - PAD.bottom, PAD.top]);
  const reaches = peers.map((p) => p.reach).filter((v): v is number => v !== null);
  const maxReach = reaches.length > 0 ? Math.max(...reaches) : 1;
  const zeroY = yDomain[0] <= 0 && yDomain[1] >= 0 ? y(0) : null;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="채널별 수준 대 추세 스캐터">
        {zeroY !== null && <line x1={PAD.left} y1={zeroY} x2={W - PAD.right} y2={zeroY} stroke="currentColor" strokeOpacity={0.25} />}
        {peers.map((p) => {
          if (p.level === null || p.trend === null) return null;
          const r = p.reach !== null && maxReach > 0 ? 6 + (p.reach / maxReach) * 14 : 6;
          return (
            <g key={p.channelCode}>
              <circle cx={x(p.level)} cy={y(p.trend)} r={r} fill="#3a30df" fillOpacity={0.55} stroke="#3a30df" />
              <text x={x(p.level)} y={y(p.trend) - r - 4} fontSize={10} textAnchor="middle" fill="currentColor">
                {p.channelName}
              </text>
            </g>
          );
        })}
        <text x={W - PAD.right} y={H - 4} fontSize={9} textAnchor="end" fill="currentColor" opacity={0.6}>수준(시청률) →</text>
      </svg>
      <ChartCaption caption={caption} />
    </div>
  );
}

/** 2. 오리지널 파이프라인 — 본방→재방 단계 막대(유지율 % 표기). */
export function PipelineStepChart({ edges, caption }: { edges: PipelineEdge[]; caption: ChartCaptionInfo }) {
  if (edges.length === 0) return <p className="text-sm text-neutral-500">이 기간엔 채널 간 이어지는 오리지널 콘텐츠 흐름이 관찰되지 않았습니다.</p>;
  const rowH = 44;
  const chartH = rowH * edges.length + PAD.top + PAD.bottom;
  const maxRating = Math.max(...edges.flatMap((e) => [e.fromRating ?? 0, e.toRating ?? 0]), 0.001);
  const barX = PAD.left + 140;
  const barMaxW = W - barX - PAD.right - 60;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${chartH}`} className="w-full" role="img" aria-label="오리지널 콘텐츠 본방-재방 흐름">
        {edges.map((e, i) => {
          const yy = PAD.top + i * rowH;
          const fromW = e.fromRating !== null ? (e.fromRating / maxRating) * barMaxW : 0;
          const toW = e.toRating !== null ? (e.toRating / maxRating) * barMaxW : 0;
          return (
            <g key={`${e.canonicalName}_${e.toChannelCode}_${i}`}>
              <text x={PAD.left} y={yy + 12} fontSize={10} fill="currentColor">{e.canonicalName}</text>
              <text x={PAD.left} y={yy + 24} fontSize={9} fill="currentColor" opacity={0.6}>{e.fromChannelName} → {e.toChannelName}({e.relation === "simulcast" ? "동시방영" : "재방"})</text>
              <rect x={barX} y={yy + 2} width={fromW} height={8} fill="#3a30df" />
              <rect x={barX} y={yy + 14} width={toW} height={8} fill="#9d95ff" />
              <text x={barX + Math.max(fromW, toW) + 6} y={yy + 12} fontSize={9} fill="currentColor">
                {e.retentionPct !== null ? `유지율 ${e.retentionPct.toFixed(1)}%` : ""}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="flex gap-4 text-[11px] text-neutral-500">
        <span><span className="inline-block h-2 w-3 align-middle bg-[#3a30df]" /> 본방</span>
        <span><span className="inline-block h-2 w-3 align-middle bg-[#9d95ff]" /> 재방/동시방영</span>
      </div>
      <ChartCaption caption={caption} />
    </div>
  );
}

/** 3. 채널 × 시간대 통합 히트맵 — WeekdayHourHeatmap과 같은 HTML table 색상농도 패턴. */
export function ChannelHourHeatmap({
  channels,
  caption,
}: {
  channels: { code: string; name: string; hourlyPattern: HourlyPatternRow[] }[];
  caption: ChartCaptionInfo;
}) {
  const hours = Array.from(new Set(channels.flatMap((c) => c.hourlyPattern.map((h) => h.broadcastHour)))).sort((a, b) => a - b);
  if (hours.length === 0) return <p className="text-sm text-neutral-500">이 그룹은 시간대별 자료가 없습니다(프로그램 단위 축이 제한적인 채널로만 구성).</p>;
  const allValues = channels.flatMap((c) => c.hourlyPattern.map((h) => h.avgRating)).filter((v): v is number => v !== null);
  const max = allValues.length > 0 ? Math.max(...allValues) : 1;
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="border-collapse text-[11px]">
          <thead>
            <tr>
              <th className="p-1 text-left text-neutral-500">채널\시간</th>
              {hours.map((h) => (
                <th key={h} className="p-1 text-center text-neutral-500">{h}시</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {channels.map((c) => {
              const byHour = new Map(c.hourlyPattern.map((h) => [h.broadcastHour, h.avgRating]));
              return (
                <tr key={c.code}>
                  <td className="p-1 font-medium">{c.name}</td>
                  {hours.map((h) => {
                    const v = byHour.get(h) ?? null;
                    const alpha = v !== null && max > 0 ? Math.min(1, v / max) : 0;
                    return (
                      <td key={h} className="p-1 text-center tabular-nums" style={{ backgroundColor: `rgba(58,48,223,${alpha * 0.75})`, color: alpha > 0.5 ? "#fff" : undefined }}>
                        {v !== null ? v.toFixed(3) : "—"}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ChartCaption caption={caption} />
    </div>
  );
}

/** 4. 채널별 추이 스몰 멀티플 — DailyTrendChart의 축소판, 채널 수만큼 나열. */
export function TrendSparkline({ channels }: { channels: { code: string; name: string; trend: DailyTrendPoint[] }[] }) {
  const sw = 200;
  const sh = 60;
  const spad = { top: 6, right: 6, bottom: 6, left: 6 };
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {channels.map((c) => {
        const valid = c.trend.filter((t) => t.avgRating !== null);
        if (valid.length < 2) {
          return (
            <div key={c.code} className="rounded border border-neutral-200 p-2 text-center text-xs text-neutral-400 dark:border-neutral-800">
              {c.name}
              <div className="mt-1">추이 자료 부족</div>
            </div>
          );
        }
        const x = scaleLinear([0, c.trend.length - 1], [spad.left, sw - spad.right]);
        const yDomain = yDomainFrom(c.trend.map((t) => t.avgRating));
        const y = scaleLinear(yDomain, [sh - spad.bottom, spad.top]);
        const points = c.trend.map((t, i) => (t.avgRating === null ? null : `${x(i)},${y(t.avgRating)}`)).filter(Boolean).join(" ");
        return (
          <div key={c.code} className="rounded border border-neutral-200 p-2 dark:border-neutral-800">
            <div className="mb-1 text-xs font-medium">{c.name}</div>
            <svg viewBox={`0 0 ${sw} ${sh}`} className="w-full" role="img" aria-label={`${c.name} 추이`}>
              <polyline points={points} fill="none" stroke="#3a30df" strokeWidth={1.5} />
            </svg>
          </div>
        );
      })}
    </div>
  );
}

/** 5. 슬롯 중복 점검 — 7채널×24시간 매트릭스는 대부분 빈 칸이라 정보 밀도가 낮아, 관찰된 겹침만
 *  나열하는 목록형 표로 단순화(계획서 "정직하게 밝히는 한계" 참고). */
// Phase 12(2026-08-28) — 요일 열 추가: 같은 시간대라도 요일이 다르면 더 이상 중복으로 안 잡히므로,
// 표에 요일을 함께 보여줘 "언제" 겹치는지 명확히 한다.
export function SlotOverlapTable({ rows }: { rows: SlotOverlapRow[] }) {
  if (rows.length === 0) return <p className="text-sm text-neutral-500">같은 요일·시간대에 겹치는 자사 채널 콘텐츠가 관찰되지 않았습니다.</p>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-neutral-500">
          <th className="py-1">요일</th>
          <th className="py-1">시간대</th>
          <th className="py-1">프로그램</th>
          <th className="py-1">겹치는 채널</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.dow}_${r.hour}_${r.canonicalName}`} className="border-t border-neutral-200/60 dark:border-neutral-800/60">
            <td className="py-1">{r.dowLabel}</td>
            <td className="py-1">{r.hour}시</td>
            <td className="py-1">{r.canonicalName}</td>
            <td className="py-1">{r.channelCodes.join(", ")}</td>
          </tr>
        ))}
      </tbody>
      <caption className="mt-2 text-left text-[11px] text-neutral-500">의도된 동시방영(자체 재방 등)일 수 있습니다 — 겹침 자체가 문제라고 단정하지 않습니다.</caption>
    </table>
  );
}
