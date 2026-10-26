"use client";

// 주요 콘텐츠 리뷰의 "회차별 본방 시청률" 꺾은선(사용자 지시 2026-10-27): 기존 "최근 성적 대비" 자리를 이 그래프가 차지한다.
// 수도권 2049는 파란 계열, 가구는 검정 계열. x축은 회차와 방영일을 함께 적는다. 값은 서버가 내려준 본방 이력(ratingHistory)을 그대로 찍을 뿐 새로 계산하지 않는다.
// SVG를 실제 픽셀 폭으로 그려(ResizeObserver) 글자가 가로로 눌리지 않게 한다.
import { useEffect, useRef, useState } from "react";

export interface EpisodeChartPoint {
  key: string;
  /** 회차(모르면 null — 그러면 방영일만 표기) */
  episode: number | null;
  /** x축 표기용 "10.26." */
  dateLabel: string;
  /** 툴팁용 "2026-10-26" */
  fullDate: string;
  p2049: number | null;
  household: number | null;
}

const BLUE = "#3c32e1"; // 채널 로고색 R60 G50 B225(사용자 지시 2026-10-27)
const BLACK = "#18181b";
const HEIGHT = 244; // 가구 값이 2049의 2~3배라 같은 축에서 2049 변화가 눌려 보이지 않도록 넉넉한 높이
const PAD = { left: 36, right: 92, top: 30, bottom: 40 }; // right: 맨 오른쪽 "평균" 칸
const MAX_STEP = 96; // 회차가 적을 때 오른쪽으로 억지로 늘어나지 않게 한 칸 최대 폭(2026-09-01 사용자 지시와 같은 원칙)
const NICE_STEPS = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10];

function niceAxis(maxValue: number): { ticks: number[]; top: number } {
  const target = Math.max(maxValue, 0.01) * 1.12;
  const step = NICE_STEPS.find((s) => target / s <= 4) ?? NICE_STEPS[NICE_STEPS.length - 1];
  const top = Math.ceil(target / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(Number(v.toFixed(4)));
  return { ticks, top };
}

const tickText = (v: number, step: number) => (step >= 1 ? v.toFixed(0) : step >= 0.1 && (step * 10) % 1 === 0 ? v.toFixed(1) : v.toFixed(2));

export function ReviewEpisodeChart({
  points,
  fmt,
  primary,
  caption,
}: {
  points: EpisodeChartPoint[];
  /** 값 표기(채널별 자릿수 규칙은 호출한 쪽이 정한다) */
  fmt: (v: number) => string;
  /** 주 타깃 — 굵게 그리는 쪽(2049 채널은 2049, 가구 채널은 가구) */
  primary: "p2049" | "household";
  caption?: string | null;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const apply = () => setWidth(Math.max(280, Math.floor(el.clientWidth)));
    apply();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = points.length;
  const values = points.flatMap((p) => [p.p2049, p.household]).filter((v): v is number => v !== null && Number.isFinite(v));
  if (n === 0 || values.length === 0) return null;

  const { ticks, top } = niceAxis(Math.max(...values));
  const tickStep = ticks.length > 1 ? ticks[1] - ticks[0] : 1;
  const plotW = width - PAD.left - PAD.right;
  const baseY = HEIGHT - PAD.bottom;
  const plotH = baseY - PAD.top;
  const step = n > 1 ? Math.min(plotW / (n - 1), MAX_STEP) : 0;
  const x0 = n > 1 ? PAD.left + 14 : PAD.left + plotW / 2;
  const xOf = (i: number) => x0 + step * i;
  const yOf = (v: number) => baseY - (v / top) * plotH;
  const lastIdx = n - 1;
  // 지금까지 회차(그래프에 그린 점 전부)의 평균 — 오른쪽 칸에 적는다(사용자 지시 2026-10-27)
  const avgOf = (pick: (p: EpisodeChartPoint) => number | null) => {
    const v = points.map(pick).filter((x): x is number => x !== null && Number.isFinite(x));
    return v.length > 0 ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const avgs = [
    { id: "household" as const, color: BLACK, v: avgOf((p) => p.household) },
    { id: "p2049" as const, color: BLUE, v: avgOf((p) => p.p2049) },
  ].filter((a): a is { id: "household" | "p2049"; color: string; v: number } => a.v !== null);
  const avgYs = avgs.map((a) => yOf(a.v));
  if (avgYs.length === 2 && Math.abs(avgYs[0] - avgYs[1]) < 30) {
    const mid = (avgYs[0] + avgYs[1]) / 2;
    const hi = avgYs[0] <= avgYs[1] ? 0 : 1;
    avgYs[hi] = mid - 15;
    avgYs[1 - hi] = mid + 15;
  }
  const hasHousehold = points.some((p) => p.household !== null);
  const has2049 = points.some((p) => p.p2049 !== null);

  const pathOf = (pick: (p: EpisodeChartPoint) => number | null) => {
    let d = "";
    let pen = false;
    points.forEach((p, i) => {
      const v = pick(p);
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${xOf(i).toFixed(1)},${yOf(v).toFixed(1)} `;
      pen = true;
    });
    return d.trim();
  };

  // 같은 회차에서 두 값이 가까우면 더 높은 쪽 숫자는 위에, 낮은 쪽은 아래에 둬 겹치지 않게 한다.
  const labelPos = (v: number, other: number | null): "above" | "below" => {
    const y = yOf(v);
    if (other === null) return y - 10 < 12 ? "below" : "above";
    if (v >= other) return y - 10 < 12 ? "below" : "above";
    return y + 18 > baseY - 2 ? "above" : "below";
  };

  const series: { id: "p2049" | "household"; color: string; label: string }[] = [
    { id: "household", color: BLACK, label: "가구" },
    { id: "p2049", color: BLUE, label: "수도권 2049" },
  ];

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.2em] text-zinc-400">회차별 본방 시청률</p>
        <p className="flex items-center gap-3 text-[11px] font-medium text-zinc-600">
          {has2049 && (
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-[3px] w-4 rounded-full" style={{ backgroundColor: BLUE }} />
              수도권 2049
            </span>
          )}
          {hasHousehold && (
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-[3px] w-4 rounded-full" style={{ backgroundColor: BLACK }} />
              가구
            </span>
          )}
        </p>
      </div>
      <div ref={wrapRef} className="mt-1.5 w-full">
        <svg role="img" aria-label="회차별 본방 수도권 2049·가구 시청률 꺾은선 그래프" width={width} height={HEIGHT} className="block overflow-visible">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={width - PAD.right} y1={yOf(t)} y2={yOf(t)} stroke="#e4e4e7" strokeWidth={1} strokeDasharray={t === 0 ? undefined : "2 3"} />
              <text x={PAD.left - 7} y={yOf(t) + 3.5} textAnchor="end" fontSize={10} fill="#a1a1aa" className="tabular-nums">
                {tickText(t, tickStep)}
              </text>
            </g>
          ))}
          {/* 평균선(점선)과 맨 오른쪽 평균 칸 */}
          {avgs.map((a) => (
            <line key={`avg-${a.id}`} x1={PAD.left} x2={width - PAD.right + 8} y1={yOf(a.v)} y2={yOf(a.v)} stroke={a.color} strokeOpacity={0.35} strokeWidth={1} strokeDasharray="4 3" />
          ))}
          <line x1={width - PAD.right + 8} x2={width - PAD.right + 8} y1={PAD.top - 10} y2={baseY} stroke="#e4e4e7" />
          <text x={width - PAD.right + 18} y={PAD.top - 14} fontSize={10} fill="#a1a1aa">평균</text>
          {avgs.map((a, i) => (
            <g key={`avgl-${a.id}`}>
              <text x={width - PAD.right + 18} y={avgYs[i] + 4} fontSize={14} fontWeight={700} fill={a.color} className="tabular-nums">{fmt(a.v)}</text>
            </g>
          ))}
          {/* 주 타깃이 위에 그려지도록 보조 → 주 순서 */}
          {[...series].sort((a) => (a.id === primary ? 1 : -1)).map((s) => {
            const pick = (p: EpisodeChartPoint) => p[s.id];
            if (!points.some((p) => pick(p) !== null)) return null;
            const isPrimary = s.id === primary;
            return (
              <g key={s.id}>
                {points.filter((p) => pick(p) !== null).length >= 2 && (
                  <path d={pathOf(pick)} fill="none" stroke={s.color} strokeWidth={isPrimary ? 2.4 : 1.7} strokeOpacity={isPrimary ? 1 : 0.85} strokeLinecap="round" strokeLinejoin="round" />
                )}
                {points.map((p, i) => {
                  const v = pick(p);
                  if (v === null) return null;
                  const isLast = i === lastIdx;
                  const otherV = s.id === "p2049" ? p.household : p.p2049;
                  const pos = labelPos(v, otherV);
                  const cx = xOf(i);
                  const cy = yOf(v);
                  return (
                    <g key={p.key}>
                      {isLast && <circle cx={cx} cy={cy} r={9} fill={s.color} fillOpacity={0.14} />}
                      <circle cx={cx} cy={cy} r={isLast ? 4.6 : 3.4} fill="#fff" stroke={s.color} strokeWidth={isLast ? 2.4 : 1.9} />
                      <text
                        x={cx}
                        y={pos === "above" ? cy - (isLast ? 12 : 9) : cy + (isLast ? 20 : 17)}
                        textAnchor="middle"
                        fontSize={isLast ? 12.5 : 11}
                        fontWeight={isPrimary || isLast ? 700 : 600}
                        fill={s.color}
                        className="tabular-nums"
                      >
                        {fmt(v)}
                      </text>
                      <circle cx={cx} cy={cy} r={11} fill="transparent">
                        <title>{`${p.fullDate}${p.episode !== null ? ` · ${p.episode}회` : ""} · ${s.label} ${fmt(v)}`}</title>
                      </circle>
                    </g>
                  );
                })}
              </g>
            );
          })}
          {points.map((p, i) => {
            const cx = xOf(i);
            const isLast = i === lastIdx;
            const hasEp = p.episode !== null;
            return (
              <g key={`x-${p.key}`}>
                <text x={cx} y={baseY + 16} textAnchor="middle" fontSize={11} fontWeight={isLast ? 700 : 500} fill={isLast ? "#18181b" : "#52525b"} className="tabular-nums">
                  {hasEp ? `${p.episode}회` : p.dateLabel}
                </text>
                {hasEp && (
                  <text x={cx} y={baseY + 30} textAnchor="middle" fontSize={10} fill="#a1a1aa" className="tabular-nums">
                    {p.dateLabel}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      {caption && <p className="mt-1 text-[11.5px] tabular-nums text-zinc-500">{caption}</p>}
    </div>
  );
}
