"use client";

// OTT 공개 예정 패널(2026-11-26 리디자인, 지시문 §8) — 공개일이 확정되지 않은 OTT 작품(월·분기·반기·연도 단위·미정)을 접이식 패널로.
// 접힌 상태: 플랫폼별 집계 한 줄. 펼치면 검색·정밀도 묶음·표. 원자료 원문 그대로이며 어떤 날짜도 지어내지 않는다.
// 공개일이 확정된 작품은 타임라인·캘린더에 정확한 날짜로 있고, 월 단위 작품은 타임라인의 범위 괄호로도 보인다.
import { useMemo, useState } from "react";
import type { LineupPayload, OutletDto, RunDto } from "@/lib/lineup/types";
import { episodeText, GENRE_LABEL, ottBucket, OTT_BUCKET_LABEL, outletSelected, runGenre, runMatchesQuery, runTitle, STATUS_LABEL, type Filters, type OttBucket } from "@/lib/lineup/viewModel";
import { GENRE_FILL } from "@/lib/lineup/tokens";
import { cx, Icon } from "./ui";

const ORDER: OttBucket[] = ["month", "quarter", "half", "year", "none"];

export default function UndatedStrip({
  data, filters, selectedId, onSelect, printMode = false, defaultOpen = false,
}: {
  data: LineupPayload;
  filters: Pick<Filters, "genres" | "outlets" | "statuses">;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  printMode?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen || printMode);
  const [q, setQ] = useState("");
  const [bucket, setBucket] = useState<OttBucket | "all">("all");
  const works = useMemo(() => new Map(data.works.map((w) => [w.id, w])), [data.works]);
  const items = useMemo(() => {
    const slots = new Map(data.slots.map((s) => [s.id, s]));
    const outlets = new Map(data.outlets.map((o) => [o.id, o]));
    const out: { run: RunDto; outlet: OutletDto; bucket: OttBucket }[] = [];
    for (const r of data.runs) {
      const s = slots.get(r.slotId);
      const o = s ? outlets.get(s.outletId) : undefined;
      if (!s || !o?.ott || !r.workId) continue;
      const b = ottBucket(r);
      if (b === "day") continue;
      const w = works.get(r.workId);
      const g = runGenre(r, w, s);
      if (filters.genres.length > 0 && !filters.genres.includes(g)) continue;
      if (!outletSelected(o, filters)) continue; // OTT 선택(전체·일부·없음, P0-06)
      if (filters.statuses && filters.statuses.length > 0 && !filters.statuses.includes(r.status)) continue;
      out.push({ run: r, outlet: o, bucket: b });
    }
    return out.sort(
      (a, b) =>
        ORDER.indexOf(a.bucket) - ORDER.indexOf(b.bucket) ||
        (a.run.startDate ?? "9999").localeCompare(b.run.startDate ?? "9999") ||
        a.outlet.sortOrder - b.outlet.sortOrder ||
        runTitle(a.run, works.get(a.run.workId ?? "")).localeCompare(runTitle(b.run, works.get(b.run.workId ?? "")), "ko")
    );
  }, [data, works, filters]);
  if (items.length === 0) return null;

  // 플랫폼 요약은 방송사 정렬값 순(넷플릭스·디즈니+·티빙·쿠팡플레이·웨이브·Apple TV, 2026-11-26 사용자 지정)
  const byPlatform = new Map<string, number>();
  for (const it of [...items].sort((a, b) => a.outlet.sortOrder - b.outlet.sortOrder)) byPlatform.set(it.outlet.name, (byPlatform.get(it.outlet.name) ?? 0) + 1);
  const counts = new Map<OttBucket, number>();
  for (const it of items) counts.set(it.bucket, (counts.get(it.bucket) ?? 0) + 1);
  const shown = items.filter((it) => (bucket === "all" || it.bucket === bucket) && (!q.trim() || runMatchesQuery(it.run, works.get(it.run.workId ?? ""), q)));

  return (
    <section aria-label="OTT 공개 예정" className={cx("mt-3 overflow-hidden rounded-[8px] border border-[var(--lu-line)] bg-white", printMode && "break-inside-avoid rounded-none")}>
      <button
        type="button"
        onClick={() => !printMode && setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-[var(--lu-hover)] print:hover:bg-transparent"
      >
        <Icon name={open ? "chevron" : "chevron-right"} size={12} className="text-[var(--lu-text-2)] print:hidden" />
        <span className="text-[14px] font-semibold text-[var(--lu-text)]">OTT 공개 예정</span>
        <span className="lu-num text-[12.5px] text-[var(--lu-text-2)]">공개일 미확정 {items.length}편</span>
        <span className="hidden min-w-0 flex-1 truncate text-[12.5px] text-[var(--lu-text-2)] md:block">
          {[...byPlatform.entries()].map(([n, c]) => `${n} ${c}`).join(" · ")}
        </span>
        {!printMode && <span className="ml-auto shrink-0 text-[12.5px] text-[var(--lu-text-2)]">{open ? "접기" : "펼치기"}</span>}
      </button>
      {open && (
        <div className="border-t border-[var(--lu-line)]">
          {!printMode && (
            <div className="flex flex-wrap items-center gap-2 px-3 py-2">
              <label className="flex h-8 w-[240px] items-center gap-1.5 rounded-[6px] border border-[var(--lu-line)] px-2 focus-within:border-[var(--lu-accent)]">
                <Icon name="search" size={13} className="text-[var(--lu-text-2)]" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="작품·출연진 검색" aria-label="OTT 공개 예정 검색" className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[var(--lu-text-2)]" />
              </label>
              <div role="group" aria-label="공개 시기 정밀도" className="flex flex-wrap items-center gap-1">
                {(["all", ...ORDER] as const).filter((b) => b === "all" || counts.has(b)).map((b) => (
                  <button
                    key={b}
                    type="button"
                    aria-pressed={bucket === b}
                    onClick={() => setBucket(b)}
                    className={cx("h-7 rounded-[6px] border px-2 text-[12.5px] font-medium", bucket === b ? "border-[var(--lu-accent-line)] bg-[var(--lu-accent-weak)] text-[var(--lu-accent)]" : "border-[var(--lu-line)] text-[var(--lu-text)] hover:bg-[var(--lu-hover)]")}
                  >
                    {b === "all" ? "전체" : OTT_BUCKET_LABEL[b]} <span className="lu-num text-[var(--lu-text-2)]">{b === "all" ? items.length : counts.get(b)}</span>
                  </button>
                ))}
              </div>
              <span className="ml-auto text-[12px] text-[var(--lu-text-2)]">발표된 시기 원문 그대로 · 날짜를 추정하지 않음</span>
            </div>
          )}
          <div className={cx(!printMode && "lu-scroll max-h-[320px] overflow-y-auto")}>
            <table className="w-full table-fixed text-[13px]">
              <colgroup>
                <col style={{ width: 110 }} />
                <col />
                <col style={{ width: 84 }} />
                <col style={{ width: 150 }} />
                <col style={{ width: 70 }} />
                <col style={{ width: "26%" }} />
                <col style={{ width: 64 }} />
              </colgroup>
              <thead className={cx("bg-[var(--lu-page)] text-left text-[12px] text-[var(--lu-text-2)]", !printMode && "sticky top-0")}>
                <tr>
                  <th className="px-3 py-1.5 font-medium">플랫폼</th>
                  <th className="px-3 py-1.5 font-medium">작품명</th>
                  <th className="px-3 py-1.5 font-medium">장르</th>
                  <th className="px-3 py-1.5 font-medium">공개 시기</th>
                  <th className="px-3 py-1.5 font-medium">편수</th>
                  <th className="px-3 py-1.5 font-medium">출연진</th>
                  <th className="px-3 py-1.5 font-medium">상태</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(({ run, outlet, bucket: b }) => {
                  const w = works.get(run.workId ?? "");
                  const g = w?.genre ?? "other";
                  return (
                    <tr key={run.id} onClick={() => onSelect(selectedId === run.id ? null : run.id)} className={cx("cursor-pointer border-t border-[var(--lu-grid)] hover:bg-[var(--lu-hover)]", selectedId === run.id && "bg-[var(--lu-accent-weak)]")}>
                      <td className="truncate px-3 py-1.5 text-[var(--lu-text-2)]">{outlet.name}</td>
                      <td className="px-3 py-1.5">
                        <button type="button" onClick={(e) => { e.stopPropagation(); onSelect(run.id); }} className="flex max-w-full items-center gap-1.5 text-left font-semibold text-[var(--lu-text)] hover:underline">
                          <span aria-hidden className="inline-block size-2.5 shrink-0 rounded-[2px] border-[1.5px] bg-white" style={{ borderColor: GENRE_FILL[g] }} />
                          <span className="truncate">{runTitle(run, w)}</span>
                        </button>
                      </td>
                      <td className="px-3 py-1.5 text-[var(--lu-text-2)]">{GENRE_LABEL[g]}</td>
                      <td className="px-3 py-1.5">
                        <span className="lu-num text-[var(--lu-text)]">{run.startDate ? run.startText ?? OTT_BUCKET_LABEL[b] : "미정"}</span>
                        <span className="ml-1 text-[11.5px] text-[var(--lu-text-2)]">{OTT_BUCKET_LABEL[b]}</span>
                      </td>
                      <td className="lu-num px-3 py-1.5 text-[var(--lu-text-2)]">{episodeText(run, w) || "—"}</td>
                      <td className="truncate px-3 py-1.5 text-[var(--lu-text-2)]">{(w?.cast ?? []).slice(0, 4).join(", ")}</td>
                      <td className="px-3 py-1.5 text-[var(--lu-text-2)]">{run.status === "tentative" ? STATUS_LABEL.tentative : ""}</td>
                    </tr>
                  );
                })}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-4 text-center text-[13px] text-[var(--lu-text-2)]">조건에 맞는 작품이 없습니다.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
