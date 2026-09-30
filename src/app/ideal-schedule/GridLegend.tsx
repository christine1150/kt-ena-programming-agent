// 그리드 범례(한 줄) — 색 = 기대 시청률, 테두리 = 고정·수동, 빗금 = 근거 부족, 배지 = 지난주 대비 뚜렷한 변경. 화면·인쇄 공용.
import { intensityColor } from "@/lib/scheduleGridLayout";

export function GridLegend({ themeColor, pivot, decimals }: { themeColor: string; pivot: number | null; decimals: number }) {
  const stops = [0.1, 0.3, 0.5, 0.7, 0.9].map((t) => intensityColor(themeColor, t).bg);
  const swatch = "inline-block h-2.5 w-3.5 rounded-[2px] align-middle";
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-500">
      <span className="flex items-center gap-1.5" title={pivot ? `가장 진한 색 = ${pivot.toFixed(decimals)}(채널 연평균×2)` : undefined}>
        <span className="inline-block h-2.5 w-16 rounded-[2px] align-middle" style={{ backgroundImage: `linear-gradient(to right, ${stops.join(",")})` }} />
        기대 시청률
      </span>
      <span className="flex items-center gap-1">
        <span className={swatch} style={{ border: "2px solid #18181b" }} />
        필수·잠금
      </span>
      <span className="flex items-center gap-1">
        <span className={swatch} style={{ border: "2px solid #0ea5e9" }} />
        직접 교체
      </span>
      <span className="flex items-center gap-1">
        <span className={swatch} style={{ backgroundColor: intensityColor(themeColor, 0.5).bg, backgroundImage: "repeating-linear-gradient(135deg, rgba(255,255,255,0.55) 0, rgba(255,255,255,0.55) 2px, transparent 2px, transparent 6px)" }} />
        근거 부족
      </span>
      <span className="flex items-center gap-1">
        <span className="rounded-full bg-white px-1 text-[9px] font-semibold text-emerald-600 ring-1 ring-black/10">▲.012</span>
        지난주 대비 바뀜
      </span>
    </div>
  );
}
