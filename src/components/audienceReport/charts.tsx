// Phase 6(2026-08-28, 계획서 J절 §11-7/9) — 리포트 §06에 "차트 필수"로 명시된 7종 차트.
// 이 프로젝트엔 차트 라이브러리가 없다(package.json에 recharts/d3 등 0건) — 기존 ChannelDeepDive.tsx/
// Dashboard.tsx의 관례(라이브러리 없이 직접 SVG/HTML <table>로 그리는 것)를 그대로 따른다.
// "기여도"류는 워터폴이 아니라 독립 편차 순위 막대로 그린다 — WhyCandidateRankingChart(구
// 시스템)가 세운 원칙(막대 합=총 변화량으로 보이는 워터폴은 검증되지 않은 인과 분해로 오해받을
// 수 있어 피한다, CLAUDE.md No Hallucination) 그대로 승계.
import type {
  ChartCaptionInfo,
  HourlyProfilePoint,
  DailyTrendChartPoint,
  WeekdayHourCell,
  KpiCompareRow,
  HourBlockDeltaRow,
  CumulativeConvergencePoint,
  ComparisonMatrixRow,
  TargetHourlyCell,
} from "@/lib/audienceReport/reportModel";

// §10 공통 원칙 "모든 차트에 3종 표기" — caption을 필수 prop으로 받아야만 차트를 렌더링할 수 있게
// 강제한다(옵셔널로 두지 않음).
export function ChartCaption({ caption }: { caption: ChartCaptionInfo }) {
  return (
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-neutral-500">
      <span>분석 기간: {caption.periodLabel}</span>
      <span>·</span>
      <span>Target Universe: {caption.targetUniverse}</span>
      <span>·</span>
      <span>{caption.measure}</span>
    </div>
  );
}

export const W = 640;
export const H = 200;
export const PAD = { top: 12, right: 16, bottom: 24, left: 40 };

// Phase 8(포트폴리오 리포트)도 같은 스케일 헬퍼를 쓸 수 있도록 export로 승격 — 로직 변경 없음.
export function scaleLinear(domain: [number, number], range: [number, number]) {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  return (v: number) => r0 + ((v - d0) / span) * (r1 - r0);
}

export function yDomainFrom(values: (number | null)[], padRatio = 0.15): [number, number] {
  const valid = values.filter((v): v is number => v !== null);
  if (valid.length === 0) return [0, 1];
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const pad = (max - min) * padRatio || max * 0.1 || 0.1;
  return [Math.max(0, min - pad), max + pad];
}

function polylinePoints(xs: number[], ys: (number | null)[]): string {
  const parts: string[] = [];
  xs.forEach((x, i) => {
    if (ys[i] === null) return;
    parts.push(`${x},${ys[i]}`);
  });
  return parts.join(" ");
}

/** 1. MODE A "시간대 프로파일" — 02~25시 라인 + 최근 12주 같은 시간대 평균선(음영 밴드 대신
 *  기준선으로 단순화, 밴드는 표준편차 계산이 필요해 다음 다듬기 대상). */
export function HourlyProfileChart({ points, caption }: { points: HourlyProfilePoint[]; caption: ChartCaptionInfo }) {
  const sorted = [...points].sort((a, b) => a.hour - b.hour);
  const x = scaleLinear([sorted[0]?.hour ?? 2, sorted[sorted.length - 1]?.hour ?? 25], [PAD.left, W - PAD.right]);
  const yDomain = yDomainFrom(sorted.flatMap((p) => [p.todayRating, p.baselineRating]));
  const y = scaleLinear(yDomain, [H - PAD.bottom, PAD.top]);
  const xs = sorted.map((p) => x(p.hour));
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="시간대별 시청률과 12주 기준선">
        <line x1={PAD.left} y1={H - PAD.bottom} x2={W - PAD.right} y2={H - PAD.bottom} stroke="currentColor" strokeOpacity={0.2} />
        <polyline points={polylinePoints(xs, sorted.map((p) => y(p.baselineRating ?? NaN)).map((v, i) => (sorted[i].baselineRating === null ? null : v)))} fill="none" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4 3" />
        <polyline points={polylinePoints(xs, sorted.map((p) => y(p.todayRating ?? NaN)).map((v, i) => (sorted[i].todayRating === null ? null : v)))} fill="none" stroke="#3a30df" strokeWidth={2} />
        {sorted.map((p, i) => (p.hour % 3 === 2 ? <text key={p.hour} x={xs[i]} y={H - 6} fontSize={9} textAnchor="middle" fill="currentColor" opacity={0.6}>{p.hour}시</text> : null))}
      </svg>
      <div className="flex gap-4 text-[11px] text-neutral-500">
        <span><span className="inline-block h-0.5 w-3 align-middle bg-[#3a30df]" /> 오늘</span>
        <span><span className="inline-block h-0.5 w-3 align-middle bg-[#94a3b8]" style={{ borderTop: "1.5px dashed #94a3b8" }} /> 최근 12주 평균</span>
      </div>
      <ChartCaption caption={caption} />
    </div>
  );
}

/** 2. MODE B "일자별 추이" — 일별 라인 + 7일 이동평균 보조선(요일 마커는 라벨 생략 없이 7일마다). */
export function DailyTrendChart({ points, caption }: { points: DailyTrendChartPoint[]; caption: ChartCaptionInfo }) {
  const x = scaleLinear([0, Math.max(1, points.length - 1)], [PAD.left, W - PAD.right]);
  const yDomain = yDomainFrom(points.flatMap((p) => [p.rating, p.movingAvg]));
  const y = scaleLinear(yDomain, [H - PAD.bottom, PAD.top]);
  const xs = points.map((_, i) => x(i));
  const labelEvery = Math.max(1, Math.ceil(points.length / 8));
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="일별 시청률 추이와 이동평균">
        <line x1={PAD.left} y1={H - PAD.bottom} x2={W - PAD.right} y2={H - PAD.bottom} stroke="currentColor" strokeOpacity={0.2} />
        <polyline points={polylinePoints(xs, points.map((p) => (p.movingAvg === null ? null : y(p.movingAvg))))} fill="none" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4 3" />
        <polyline points={polylinePoints(xs, points.map((p) => (p.rating === null ? null : y(p.rating))))} fill="none" stroke="#3a30df" strokeWidth={2} />
        {points.map((p, i) => (i % labelEvery === 0 ? <text key={p.date} x={xs[i]} y={H - 6} fontSize={9} textAnchor="middle" fill="currentColor" opacity={0.6}>{p.date.slice(5)}</text> : null))}
      </svg>
      <div className="flex gap-4 text-[11px] text-neutral-500">
        <span><span className="inline-block h-0.5 w-3 align-middle bg-[#3a30df]" /> 일별 시청률</span>
        <span>7일 이동평균(점선)</span>
      </div>
      <ChartCaption caption={caption} />
    </div>
  );
}

/** 3. MODE B "요일 × 시간대" — 7×8 히트맵. 라이브러리 없이 HTML table 색상농도(기존
 *  DowHourBlockTable과 같은 패턴). */
export function WeekdayHourHeatmap({ cells, caption }: { cells: WeekdayHourCell[]; caption: ChartCaptionInfo }) {
  const dows = Array.from(new Set(cells.map((c) => c.dow))).sort((a, b) => a - b);
  const hourBlocks = Array.from(new Set(cells.map((c) => c.hourBlock))).sort((a, b) => a - b);
  const values = cells.map((c) => c.avgRating).filter((v): v is number => v !== null);
  const max = values.length > 0 ? Math.max(...values) : 1;
  const cellByKey = new Map(cells.map((c) => [`${c.dow}_${c.hourBlock}`, c]));
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="border-collapse text-[11px]">
          <thead>
            <tr>
              <th className="p-1 text-left text-neutral-500">요일\시간</th>
              {hourBlocks.map((h) => (
                <th key={h} className="p-1 text-center text-neutral-500">{h}시</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dows.map((dow) => (
              <tr key={dow}>
                <td className="p-1 font-medium">{cellByKey.get(`${dow}_${hourBlocks[0]}`)?.dowLabel ?? dow}</td>
                {hourBlocks.map((h) => {
                  const c = cellByKey.get(`${dow}_${h}`);
                  const v = c?.avgRating ?? null;
                  const alpha = v !== null && max > 0 ? Math.min(1, v / max) : 0;
                  return (
                    <td key={h} className="p-1 text-center tabular-nums" style={{ backgroundColor: `rgba(58,48,223,${alpha * 0.75})`, color: alpha > 0.5 ? "#fff" : undefined }}>
                      {v !== null ? v.toFixed(3) : "—"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ChartCaption caption={caption} />
    </div>
  );
}

// Phase 12(2026-08-28, 계획서 J절 Phase 12) — 타깃×시간대. WeekdayHourHeatmap과 완전히 같은 HTML
// table 색상농도 패턴(요일 대신 연령대를 행으로) — 새 렌더링 방식 없음.
export function TargetHourlyHeatmap({ cells, caption }: { cells: TargetHourlyCell[]; caption: ChartCaptionInfo }) {
  const labels = Array.from(new Set(cells.map((c) => c.demographicLabel)));
  const hours = Array.from(new Set(cells.map((c) => c.hour))).sort((a, b) => a - b);
  const values = cells.map((c) => c.avgRating).filter((v): v is number => v !== null);
  const max = values.length > 0 ? Math.max(...values) : 1;
  const cellByKey = new Map(cells.map((c) => [`${c.demographicLabel}_${c.hour}`, c]));
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="border-collapse text-[11px]">
          <thead>
            <tr>
              <th className="p-1 text-left text-neutral-500">연령대\시간</th>
              {hours.map((h) => (
                <th key={h} className="p-1 text-center text-neutral-500">{h}시</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {labels.map((label) => (
              <tr key={label}>
                <td className="p-1 font-medium">{label}</td>
                {hours.map((h) => {
                  const c = cellByKey.get(`${label}_${h}`);
                  const v = c?.avgRating ?? null;
                  const alpha = v !== null && max > 0 ? Math.min(1, v / max) : 0;
                  return (
                    <td key={h} className="p-1 text-center tabular-nums" style={{ backgroundColor: `rgba(58,48,223,${alpha * 0.75})`, color: alpha > 0.5 ? "#fff" : undefined }}>
                      {v !== null ? v.toFixed(3) : "—"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ChartCaption caption={caption} />
    </div>
  );
}

/** 4. MODE C "KPI 대조표" — Slope chart(기간A→기간B 경사선), 지표별로 좌우 값 라벨. */
export function SlopeChart({ rows, caption }: { rows: KpiCompareRow[]; caption: ChartCaptionInfo }) {
  const rowH = 36;
  const chartH = rowH * rows.length + PAD.top + PAD.bottom;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${chartH}`} className="w-full" role="img" aria-label="기간A 대비 기간B 지표 변화 경사선">
        {rows.map((r, i) => {
          const yy = PAD.top + i * rowH + rowH / 2;
          const a = r.periodA ?? null;
          const b = r.periodB ?? null;
          const up = a !== null && b !== null && a > b;
          const color = a === null || b === null ? "#9995ac" : up ? "#047857" : a === b ? "#9995ac" : "#be123c";
          const leftX = PAD.left + 60;
          const rightX = W - PAD.right - 60;
          return (
            <g key={r.label}>
              <text x={PAD.left} y={yy + 4} fontSize={11} fill="currentColor">{r.label}</text>
              {a !== null && b !== null && <line x1={leftX} y1={yy} x2={rightX} y2={yy} stroke={color} strokeWidth={2} />}
              <circle cx={leftX} cy={yy} r={3} fill={color} />
              <circle cx={rightX} cy={yy} r={3} fill={color} />
              <text x={leftX} y={yy - 8} fontSize={10} textAnchor="middle" fill="currentColor">{r.formattedA}</text>
              <text x={rightX} y={yy - 8} fontSize={10} textAnchor="middle" fill="currentColor">{r.formattedB}</text>
            </g>
          );
        })}
      </svg>
      <div className="flex gap-4 text-[11px] text-neutral-500">
        <span>왼쪽 = 기간A, 오른쪽 = 기간B</span>
      </div>
      <ChartCaption caption={caption} />
    </div>
  );
}

/** 5. MODE C "시간대 이동" — 8구간 양방향 델타 바(0점 기준 좌우/상하). */
export function HourBlockDeltaChart({ rows, caption }: { rows: HourBlockDeltaRow[]; caption: ChartCaptionInfo }) {
  const sorted = [...rows].sort((a, b) => a.hourBlock - b.hourBlock);
  const values = sorted.map((r) => r.delta).filter((v): v is number => v !== null);
  const maxAbs = values.length > 0 ? Math.max(...values.map((v) => Math.abs(v))) : 1;
  const x = scaleLinear([0, Math.max(1, sorted.length - 1)], [PAD.left, W - PAD.right]);
  const midY = H / 2;
  const barScale = (H / 2 - PAD.top) / (maxAbs || 1);
  const barW = ((W - PAD.left - PAD.right) / Math.max(1, sorted.length)) * 0.6;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="시간대 구간별 시청률 이동 델타">
        <line x1={PAD.left} y1={midY} x2={W - PAD.right} y2={midY} stroke="currentColor" strokeOpacity={0.3} />
        {sorted.map((r, i) => {
          if (r.delta === null) return null;
          const xx = x(i);
          const barH = Math.abs(r.delta) * barScale;
          const y = r.delta >= 0 ? midY - barH : midY;
          const color = r.delta >= 0 ? "#047857" : "#be123c";
          return (
            <g key={r.hourBlock}>
              <rect x={xx - barW / 2} y={y} width={barW} height={barH} fill={color} rx={2} />
              <text x={xx} y={H - 6} fontSize={9} textAnchor="middle" fill="currentColor" opacity={0.6}>{r.hourBlock}시</text>
            </g>
          );
        })}
      </svg>
      <ChartCaption caption={caption} />
    </div>
  );
}

/** 6. MODE D "누적 수렴 곡선" — 누적 평균 수렴선 + 최근 7일 평균선. */
export function CumulativeConvergenceChart({ points, caption }: { points: CumulativeConvergencePoint[]; caption: ChartCaptionInfo }) {
  const x = scaleLinear([0, Math.max(1, points.length - 1)], [PAD.left, W - PAD.right]);
  const yDomain = yDomainFrom(points.flatMap((p) => [p.cumulativeAvg, p.recentAvg]));
  const y = scaleLinear(yDomain, [H - PAD.bottom, PAD.top]);
  const xs = points.map((_, i) => x(i));
  const labelEvery = Math.max(1, Math.ceil(points.length / 8));
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="누적 평균 수렴선과 최근 구간 평균선">
        <line x1={PAD.left} y1={H - PAD.bottom} x2={W - PAD.right} y2={H - PAD.bottom} stroke="currentColor" strokeOpacity={0.2} />
        <polyline points={polylinePoints(xs, points.map((p) => (p.recentAvg === null ? null : y(p.recentAvg))))} fill="none" stroke="#e0a35c" strokeWidth={1.5} strokeDasharray="4 3" />
        <polyline points={polylinePoints(xs, points.map((p) => (p.cumulativeAvg === null ? null : y(p.cumulativeAvg))))} fill="none" stroke="#3a30df" strokeWidth={2} />
        {points.map((p, i) => (i % labelEvery === 0 ? <text key={p.date} x={xs[i]} y={H - 6} fontSize={9} textAnchor="middle" fill="currentColor" opacity={0.6}>{p.date.slice(5)}</text> : null))}
      </svg>
      <div className="flex gap-4 text-[11px] text-neutral-500">
        <span><span className="inline-block h-0.5 w-3 align-middle bg-[#3a30df]" /> 누적 평균</span>
        <span>최근 7일 평균(점선) — 끌고 있으면 누적선 위, 끌려가면 아래</span>
      </div>
      <ChartCaption caption={caption} />
    </div>
  );
}

/** 7. MODE D "주기 비교 매트릭스" — DoD~YoY 발산 색 스케일 표. */
export function PeriodComparisonMatrix({ rows, caption }: { rows: ComparisonMatrixRow[]; caption: ChartCaptionInfo }) {
  return (
    <div>
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr className="text-neutral-500">
            <th className="p-1.5 text-left">구간</th>
            <th className="p-1.5 text-right">이번 구간</th>
            <th className="p-1.5 text-right">직전 구간</th>
            <th className="p-1.5 text-right">변화</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const up = r.changePct !== null && r.changePct > 0;
            const down = r.changePct !== null && r.changePct < 0;
            return (
              <tr key={r.preset} className="border-t border-neutral-200/60 dark:border-neutral-700/60">
                <td className="p-1.5 font-medium">{r.label}</td>
                <td className="p-1.5 text-right tabular-nums">{r.currentAvg !== null ? r.currentAvg.toFixed(3) : "—"}</td>
                <td className="p-1.5 text-right tabular-nums">{r.priorAvg !== null ? r.priorAvg.toFixed(3) : "—"}</td>
                <td className="p-1.5 text-right tabular-nums" style={{ color: up ? "#047857" : down ? "#be123c" : undefined }}>
                  {r.changePct !== null ? `${up ? "▲" : down ? "▼" : ""}${Math.abs(r.changePct).toFixed(1)}%` : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <ChartCaption caption={caption} />
    </div>
  );
}
