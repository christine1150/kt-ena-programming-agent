"use client";

// 공개 시기 미정 OTT 작품 목록 — 날짜가 없어 시간 축에 놓을 수 없는 작품을 플랫폼별로 모아 격자 아래에 보인다
// (경쟁 비교 화면·인쇄). 원자료가 "시기 추정 금지"라 어떤 날짜도 지어내지 않고, 누르면 상세(공개 방식·비고)가 열린다.
import type { LineupPayload, OutletDto, RunDto } from "@/lib/lineup/types";
import { episodeText, GENRE_HEX, GENRE_LABEL, OTT_CAST_MAX, periodText, runTitle } from "@/lib/lineup/viewModel";

export default function UndatedStrip({
  data, groups, selectedId, onSelect,
}: {
  data: LineupPayload;
  groups: { outlet: OutletDto; runs: RunDto[] }[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  if (groups.length === 0) return null;
  const works = new Map(data.works.map((w) => [w.id, w]));
  const count = groups.reduce((n, g) => n + g.runs.length, 0);
  return (
    <section aria-label="OTT 공개 시기 미정" className="mt-3 overflow-hidden rounded-lg border border-zinc-200 bg-white print:break-inside-avoid print:rounded-none">
      <h3 className="border-b border-zinc-200 bg-zinc-100 px-3 py-1 text-[14px] font-bold text-zinc-800 print:[print-color-adjust:exact]">
        OTT · 공개 시기 미정·연 단위 <span className="font-normal text-zinc-600">{count}편 — 공개 연도만 알려졌거나 시기가 발표 전이라 시간 축에 놓지 않았습니다</span>
        <span className="ml-3 inline-flex items-center gap-2.5 align-middle text-[12.5px] font-normal text-zinc-700">
          {(["drama", "variety", "other"] as const).map((k) => (
            <span key={k} className="inline-flex items-center gap-1">
              <span aria-hidden className="inline-block h-3 w-3 rounded-[3px] print:[print-color-adjust:exact]" style={{ background: GENRE_HEX[k] }} />{GENRE_LABEL[k]}
            </span>
          ))}
        </span>
      </h3>
      {groups.map((g) => (
        <div key={g.outlet.id} className="flex items-start gap-3 border-b border-zinc-200 px-3 py-2 last:border-b-0">
          <span className="flex w-24 shrink-0 items-center gap-1.5 pt-1 text-[14px] font-bold text-zinc-900">
            <span aria-hidden className="inline-block h-4 w-1 rounded-sm ring-1 ring-black/10 print:[print-color-adjust:exact]" style={{ background: g.outlet.color ?? "var(--border-control)" }} />
            {g.outlet.name}
          </span>
          <ul className="flex min-w-0 flex-1 flex-wrap gap-1.5">
            {g.runs.map((r) => {
              const w = r.workId ? works.get(r.workId) : undefined;
              const c = GENRE_HEX[w?.genre ?? "other"]; // OTT는 장르색으로 구분(2026-11-26) — 플랫폼은 왼쪽 띠·이름
              const eps = episodeText(r, w);
              const cast = (w?.cast ?? []).slice(0, OTT_CAST_MAX).join(", ");
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(selectedId === r.id ? null : r.id)}
                    aria-pressed={selectedId === r.id}
                    className={`flex max-w-[300px] flex-col rounded-[4px] border px-2 py-0.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 print:[print-color-adjust:exact] ${selectedId === r.id ? "ring-2 ring-zinc-900" : ""}`}
                    style={{ borderColor: c, borderStyle: "dashed", background: `color-mix(in srgb, ${c} 10%, white)` }}
                  >
                    <span className="truncate text-[14px] leading-5 font-semibold text-zinc-900">
                      {runTitle(r, w)}
                      {(r.startDate || eps) && <span className="ml-1 text-[12.5px] font-normal text-zinc-700">{[r.startDate ? periodText(r) : "", eps].filter(Boolean).join(", ")}</span>}
                    </span>
                    {cast && <span className="truncate text-[12.5px] leading-[17px] text-zinc-700">{cast}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}
