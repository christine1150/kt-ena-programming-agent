// 그리드 범례 — 색 = 기대 시청률, 테두리 = 편성 상태, 빗금 = 근거 부족, 배지 = 지난주 대비 변경.
// 화면·인쇄 공용(줄글 범례 대체).
import { intensityColor } from "@/lib/scheduleGridLayout";

export function GridLegend({ themeColor, pivot, decimals }: { themeColor: string; pivot: number | null; decimals: number }) {
  const stops = [0.1, 0.3, 0.5, 0.7, 0.9].map((t) => intensityColor(themeColor, t).bg);
  const swatch = "inline-block h-2.5 w-3.5 rounded-[2px] align-middle";
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[11px] text-zinc-500">
      <span className="flex items-center gap-1.5">
        <span className="font-medium text-zinc-600">색</span>
        <span className="inline-block h-2.5 w-20 rounded-[2px] align-middle" style={{ backgroundImage: `linear-gradient(to right, ${stops.join(",")})` }} />
        <span>기대 시청률 높을수록 진함{pivot ? ` (가장 진함 ${pivot.toFixed(decimals)} = 채널 연평균×2)` : ""}</span>
      </span>
      <span className="flex items-center gap-2">
        <span className="font-medium text-zinc-600">테두리</span>
        <span className="flex items-center gap-1">
          <span className={swatch} style={{ border: "2px solid #18181b" }} />
          필수·잠금
        </span>
        <span className="flex items-center gap-1">
          <span className={swatch} style={{ border: "2px solid #0ea5e9" }} />
          수동 교체
        </span>
        <span className="flex items-center gap-1">
          <span className={swatch} style={{ border: "1.5px dashed #7c3aed" }} />
          경쟁사 가상
        </span>
      </span>
      <span className="flex items-center gap-1">
        <span className={swatch} style={{ backgroundColor: intensityColor(themeColor, 0.5).bg, backgroundImage: "repeating-linear-gradient(135deg, rgba(255,255,255,0.55) 0, rgba(255,255,255,0.55) 2px, transparent 2px, transparent 6px)" }} />
        빗금 = 근거 부족(장르·채널 평균 추정)
      </span>
      <span className="flex items-center gap-1">
        <span className="rounded-full bg-white px-1 text-[9px] font-semibold text-emerald-600 ring-1 ring-black/10">▲.012</span>
        지난주 실제 편성 대비 바뀐 칸(기대 차이)
      </span>
      <span className="flex items-center gap-1">
        <span className={`${swatch} border border-dashed border-zinc-300 bg-zinc-50`} />
        편성 여백
      </span>
    </div>
  );
}
