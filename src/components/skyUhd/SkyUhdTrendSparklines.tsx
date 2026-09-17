// skyUHD 전용 미니 시청률 흐름(연간·월간·주간) 스파크라인 (2026-09-17, 사용자 지시).
//
// 사용자 지시 원문: "skyUHD는 오히려 연간, 월간, 주간(월~금) 시청률 흐름이 보일 수 있게 작게
// 시각화해서 넣을 수 있는 방법을 하나 디자인해서 제안해줘."
//
// 디자인 제안 요지: 큰 차트 하나를 넣으면 skyUHD 페이지에서 가장 중요한 "편성 분석"을 밀어낸다.
// 대신 같은 정의(편성된 모든 방영분의 평균 시청률, 빈 칸=0 포함)를 쓰는 3단 스파크라인 카드
// 한 줄로 넣어, 한눈에 "연 단위 큰 흐름 → 최근 한 달 → 최근 주(월~금)"를 좁혀 읽게 한다.
// 카드마다 ①구간 라벨 ②마지막 값과 직전 대비 등락 ③점선(구간 평균) 위 실선 스파크라인 ④최저·최고
// 눈금만 둔다 — 축·격자·범례를 모두 빼 폭 240px 안에서도 읽히도록 절제했다.
// 이 저장소 관례대로 차트 라이브러리 없이 SVG로 직접 그린다(FitScoreQuadrantChart 등과 동일).
import type { SkyUhdTrendPoint, SkyUhdTrendSeries } from "@/lib/skyUhdSlotAnalysis";

const VIEW_W = 240;
const VIEW_H = 48;
const PAD_Y = 6;

function Sparkline({
  points,
  accentColor,
}: {
  points: SkyUhdTrendPoint[];
  accentColor: string;
}) {
  const values = points.map((p) => p.value);
  const present = values.filter((v): v is number => v !== null);
  if (present.length < 2) {
    return <div className="h-12 rounded-lg bg-zinc-50" aria-hidden />;
  }
  const min = Math.min(...present);
  const max = Math.max(...present);
  const range = max - min || Math.max(max, 1e-9);
  const mean = present.reduce((a, b) => a + b, 0) / present.length;
  const xOf = (i: number) => (points.length === 1 ? VIEW_W / 2 : (i / (points.length - 1)) * VIEW_W);
  const yOf = (v: number) => VIEW_H - PAD_Y - ((v - min) / range) * (VIEW_H - PAD_Y * 2);

  // 값이 비어 있는 구간(그 기간에 편성 자체가 없던 날)은 선을 잇지 않고 끊는다.
  const segments: string[] = [];
  let current: string[] = [];
  points.forEach((p, i) => {
    if (p.value === null) {
      if (current.length >= 2) segments.push(current.join(" "));
      current = [];
      return;
    }
    current.push(`${current.length === 0 ? "M" : "L"} ${xOf(i).toFixed(1)} ${yOf(p.value).toFixed(1)}`);
  });
  if (current.length >= 2) segments.push(current.join(" "));

  const lastIdx = (() => {
    for (let i = points.length - 1; i >= 0; i -= 1) if (points[i].value !== null) return i;
    return -1;
  })();

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className="h-12 w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label={`최저 ${min.toFixed(5)} · 최고 ${max.toFixed(5)}`}
    >
      {/* 구간 평균 기준선 — 지금 값이 평소보다 위인지 아래인지 한눈에 읽히게 하는 유일한 보조선 */}
      <line
        x1={0}
        x2={VIEW_W}
        y1={yOf(mean)}
        y2={yOf(mean)}
        stroke="#d4d4d8"
        strokeWidth={1}
        strokeDasharray="3 3"
        vectorEffect="non-scaling-stroke"
      />
      {segments.map((d, i) => (
        <path
          key={i}
          d={d}
          fill="none"
          stroke={accentColor}
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {lastIdx >= 0 && points[lastIdx].value !== null && (
        <circle cx={xOf(lastIdx)} cy={yOf(points[lastIdx].value!)} r={2.4} fill={accentColor} />
      )}
    </svg>
  );
}

function TrendCard({
  title,
  caption,
  points,
  accentColor,
  fmtR,
}: {
  title: string;
  caption: string;
  points: SkyUhdTrendPoint[];
  accentColor: string;
  fmtR: (v: number | null) => string;
}) {
  const present = points.filter((p) => p.value !== null);
  const last = present.length > 0 ? present[present.length - 1] : null;
  const prev = present.length > 1 ? present[present.length - 2] : null;
  const deltaPct =
    last?.value !== undefined && last?.value !== null && prev?.value !== undefined && prev?.value !== null && prev.value !== 0
      ? ((last.value - prev.value) / prev.value) * 100
      : null;
  const values = present.map((p) => p.value as number);
  const min = values.length > 0 ? Math.min(...values) : null;
  const max = values.length > 0 ? Math.max(...values) : null;

  return (
    <div className="rounded-2xl bg-zinc-50 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-zinc-700">{title}</p>
        {last && (
          <p className="text-[12px] text-zinc-400">
            {last.label} 기준
          </p>
        )}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <p className="text-lg font-semibold text-zinc-900">{fmtR(last?.value ?? null)}</p>
        {deltaPct !== null && (
          <span className={`text-sm font-medium ${deltaPct >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
            {deltaPct >= 0 ? "▲" : "▼"} {Math.abs(deltaPct).toFixed(1)}%
          </span>
        )}
      </div>
      <div className="mt-2">
        <Sparkline points={points} accentColor={accentColor} />
      </div>
      <div className="mt-1 flex items-center justify-between text-[11px] text-zinc-400">
        <span>최저 {fmtR(min)}</span>
        <span>최고 {fmtR(max)}</span>
      </div>
      <p className="mt-1.5 text-[12px] leading-relaxed text-zinc-400">{caption}</p>
    </div>
  );
}

export function SkyUhdTrendSparklines({
  trend,
  accentColor,
  fmtR,
}: {
  trend: SkyUhdTrendSeries;
  accentColor: string;
  fmtR: (v: number | null) => string;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <TrendCard
        title="연간 흐름 (월별)"
        caption="올해 1월부터 기준월까지 월별 편성 평균입니다. 점선은 구간 평균입니다."
        points={trend.yearly}
        accentColor={accentColor}
        fmtR={fmtR}
      />
      <TrendCard
        title="월간 흐름 (최근 30일)"
        caption="기준일 직전 30일의 일별 편성 평균입니다. 편성이 없던 날은 선이 끊깁니다."
        points={trend.monthly}
        accentColor={accentColor}
        fmtR={fmtR}
      />
      <TrendCard
        title="주간 흐름 (최근 12주, 월~금)"
        caption="주말을 뺀 월~금 편성만 모아 주 단위로 평균 낸 값입니다."
        points={trend.weekly}
        accentColor={accentColor}
        fmtR={fmtR}
      />
    </div>
  );
}
