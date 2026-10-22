"use client";

// 프로그램 성과 화면 — 검색·필터·표시만 한다. 모든 수치(평균·배율·증감·표본·상태·설명)는 /api/program-performance가 서버에서 확정해 준 값이다.
// 첫 화면: 작품·조건 → 요약 숫자 → 채널별 비교 표(2049/가구 그룹). 상세 근거(회차 추이·시간대·본재·근거 방송)는 접힌 영역.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { formatDecimal, formatInt, formatRatingValue, formatSigned, MISSING } from "@/lib/ui/metricFormat";
import { TAG_DOT_COLOR, TAG_LABEL_KO, type ActionTag } from "@/lib/actionTags";
import { WORK_CLASS_LABEL } from "@/lib/programPerformance/metrics";
import type { AiringFilter, ChannelRow, Direction, PerformanceResult, RatioValue, SearchItem, TargetMode, WorkClass } from "@/lib/programPerformance/types";

type ClassFilter = "all" | "drama" | "variety";
type PeriodPreset = "all" | "4w" | "12w" | "custom";

const CLASS_FILTERS: { id: ClassFilter; label: string }[] = [
  { id: "all", label: "전체" },
  { id: "drama", label: "오리지널 드라마" },
  { id: "variety", label: "오리지널 예능" },
];
const CHANNELS: { code: string; label: string }[] = [
  { code: "ENA", label: "ENA" },
  { code: "ENA_DRAMA", label: "ENA DRAMA" },
  { code: "ENA_PLAY", label: "ENA PLAY" },
  { code: "OLIFE", label: "OLIFE" },
  { code: "ONCE", label: "ONCE" },
  { code: "ENA_STORY", label: "ENA STORY" },
  { code: "SKYUHD", label: "skyUHD" },
];
const TARGET_LABEL: Record<TargetMode, string> = { kpi: "채널별 KPI", common2049: "공통: 수도권 2049", commonHH: "공통: 전국 유료가구" };
const AIRING_LABEL: Record<AiringFilter, string> = { all: "전체", first: "본방(<본> 표시)", rerun: "본방 표시 없음(재방 등)" };
const DIR_TEXT: Record<Direction, string> = { HIGHER: "▲ 높음", SIMILAR: "≈ 비슷", LOWER: "▼ 낮음", NA: "산출 불가" };
const DIR_CLASS: Record<Direction, string> = { HIGHER: "text-emerald-700", SIMILAR: "text-zinc-600", LOWER: "text-rose-700", NA: "text-zinc-400" };
const STATUS_TEXT: Record<ChannelRow["status"], string> = {
  OBSERVED: "실적 확인",
  NO_OBSERVATION: "해당 기간 관측 없음",
  NO_PROGRAM_DATA: "프로그램 자료 없음",
  UNSUPPORTED: "이번 비교 제외",
  NO_TARGET: "타깃 자료 없음",
};
const CLASS_BADGE: Record<WorkClass, string> = {
  ORIGINAL_DRAMA: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  ORIGINAL_VARIETY: "bg-amber-50 text-amber-800 ring-amber-200",
  OTHER_FEATURED: "bg-zinc-50 text-zinc-700 ring-zinc-200",
  UNCONFIRMED: "bg-white text-zinc-500 ring-zinc-200",
  CONFLICT: "bg-rose-50 text-rose-700 ring-rose-200",
};
const DOW = ["일", "월", "화", "수", "목", "금", "토"];

function addDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
const fmtTime = (t: string | null) => {
  if (!t) return MISSING;
  const h = Number(t.slice(0, 2));
  return `${String(h < 2 ? h + 24 : h).padStart(2, "0")}:${t.slice(3, 5)}`;
};

function ClassBadge({ cls }: { cls: WorkClass }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${CLASS_BADGE[cls]}`}>{WORK_CLASS_LABEL[cls]}</span>;
}

/** 배율 셀: 1행 = 배율·방향, 2행 = 상대 차이·기준값(보조). 산출 불가면 사유 + 가능한 절대 차이. */
function RatioCell({ r, code, baseLabel }: { r: RatioValue; code: string; baseLabel: string }) {
  if (r.ratio === null) {
    return (
      <div className="text-[12px] text-zinc-400" title={r.naReason ?? ""}>
        산출 불가
        {r.diff !== null && <div className="text-[11px]">차이 {formatSigned(r.diff, 3)}%p</div>}
        {r.naReason && <div className="text-[11px] leading-tight">{r.naReason}</div>}
      </div>
    );
  }
  return (
    <div>
      <div className="flex items-baseline justify-end gap-1.5">
        <span className="tabular-nums font-semibold text-zinc-900">{formatDecimal(r.ratio, 2)}배</span>
        <span className={`text-[11px] ${DIR_CLASS[r.direction]}`}>{DIR_TEXT[r.direction]}</span>
      </div>
      <div className="text-right text-[11px] tabular-nums text-zinc-500">
        {formatSigned(r.pct, 0)}% · {baseLabel} {formatRatingValue(r.base, code)}
      </div>
    </div>
  );
}

function FitCell({ row }: { row: ChannelRow }) {
  if (!row.fit) return <span className="text-[11px] text-zinc-400">{row.status === "OBSERVED" ? "KPI 모드에서만" : MISSING}</span>;
  if (!row.fit.tag) return <span className="text-[11px] text-zinc-500">{row.fit.tier === "HOLD" ? "판단 보류" : "최근 12주 방영 없음"}</span>;
  const tag = row.fit.tag as ActionTag;
  return (
    <span className="inline-flex items-center gap-1 text-[12px]" title={`콘텐츠 적합도 ${row.fit.windowFrom}~${row.fit.asOf}(최근 12주) 기준${row.fit.note ? ` · ${row.fit.note}` : ""}`}>
      <span className="inline-block h-2 w-2 rounded-full" style={{ background: TAG_DOT_COLOR[tag] }} aria-hidden />
      {TAG_LABEL_KO[tag]}
      {row.fit.tier !== "FORMAL" && <span className="text-[10px] text-zinc-400">(참고)</span>}
    </span>
  );
}

function ChannelTable({ rows, focus, kpiGroup, targetMode }: { rows: ChannelRow[]; focus: string | null; kpiGroup: "2049" | "HH"; targetMode: TargetMode }) {
  const groupTitle = targetMode === "kpi" ? (kpiGroup === "2049" ? "2049 KPI 채널 (수도권 2049)" : "가구 KPI 채널 (전국 유료가구)") : TARGET_LABEL[targetMode];
  return (
    <section className="mt-4">
      <h3 className="mb-1.5 text-[13px] font-semibold text-zinc-700">{groupTitle}</h3>
      <div className="dense-grid overflow-x-auto rounded-lg border border-zinc-200 bg-white" tabIndex={0} role="region" aria-label={`${groupTitle} 채널별 비교 표`}>
        <table className="w-full min-w-[860px] text-[13px]">
          <thead className="bg-zinc-50 text-[12px] text-zinc-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium">채널</th>
              <th className="px-3 py-2 text-right font-medium" title="원본 닐슨 파일의 <본> 표시 기준. <본> 표시는 ENA에만 있어 다른 채널은 대부분 표시 없음으로 나옵니다.">본방 표시 / 그 외</th>
              <th className="px-3 py-2 text-right font-medium" title="선택 조건의 방영별 시청률 산술평균(방송시간 가중 아님)">작품 평균</th>
              <th className="px-3 py-2 text-right font-medium" title="같은 조회 기간 닐슨 채널 하루 시청률의 일별 평균(공식 주간 값과 다름)">채널 일평균</th>
              <th className="px-3 py-2 text-right font-medium" title="작품 평균 ÷ 채널 일평균 — 규모 참고(시간대 효과를 뺀 효율이 아님)">채널 평균 대비</th>
              <th className="px-3 py-2 text-right font-medium" title="같은 요일·시간대 다른 프로그램 대비(콘텐츠 적합도와 같은 기준·보정) — 편성 효율">동슬롯 대비</th>
              <th className="px-3 py-2 text-left font-medium">근거·상태</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isFocus = focus === r.channelCode;
              const observed = r.status === "OBSERVED";
              return (
                <tr key={r.channelCode} className={`border-t border-zinc-100 align-top ${isFocus ? "bg-sky-50/60" : ""}`}>
                  <td className="px-3 py-2">
                    <div className="font-medium text-zinc-900">
                      {r.channelName}
                      {isFocus && <span className="ml-1 text-[10px] text-sky-700">(진입 채널)</span>}
                    </div>
                    <div className="text-[11px] text-zinc-500">{r.targetLabel}</div>
                  </td>
                  {observed ? (
                    <>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <div>
                          {formatInt(r.firstRun.airings)} / {formatInt(r.rerun.airings + r.unknownRun.airings)}
                        </div>
                        {r.firstRun.airings === 0 && r.rerun.airings === 0 && <div className="text-[11px] text-zinc-400">본방 표시 없는 채널</div>}
                        <div className="text-[11px] text-zinc-500">{r.observedFrom} ~ {r.observedTo}</div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold">{formatRatingValue(r.programAvg, r.channelCode)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatRatingValue(r.channelDaily?.mean ?? null, r.channelCode)}
                        {r.channelDaily && r.channelDaily.validDays < r.channelDaily.periodDays && (
                          <div className="text-[11px] text-amber-700" title="조회 기간 중 채널 하루 자료가 없는 날이 있습니다">
                            자료 {r.channelDaily.validDays}/{r.channelDaily.periodDays}일
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <RatioCell r={r.vsChannel} code={r.channelCode} baseLabel="기준" />
                      </td>
                      <td className="px-3 py-2">{r.slot ? <RatioCell r={r.slot.ratio} code={r.channelCode} baseLabel="슬롯 기준" /> : <span className="text-zinc-400">{MISSING}</span>}</td>
                      <td className="px-3 py-2 text-[12px]">
                        <div className="text-zinc-800">{r.summary}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-zinc-500">
                          <span>
                            방송일 {r.days}일 · 회차 {r.episodes || MISSING}
                          </span>
                          {r.slot && <span title={r.slot.note}>슬롯 비교군 {formatInt(r.slot.comparisonAirings)}건</span>}
                          <span>
                            현재 판정 <FitCell row={r} />
                          </span>
                        </div>
                      </td>
                    </>
                  ) : (
                    <td colSpan={6} className="px-3 py-2 text-[12px] text-zinc-500">
                      <span className="font-medium text-zinc-600">{STATUS_TEXT[r.status]}</span>
                      {r.statusNote && <span> — {r.statusNote}</span>}
                      {r.channelDaily?.mean !== null && r.channelDaily?.mean !== undefined && <span className="ml-2 text-[11px]">(채널 일평균 {formatRatingValue(r.channelDaily.mean, r.channelCode)})</span>}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Details({ result }: { result: PerformanceResult }) {
  const [tab, setTab] = useState<"trend" | "slot" | "split" | "airings">("trend");
  const rows = result.groups.flatMap((g) => g.rows).filter((r) => r.status === "OBSERVED");
  const byChannel = useMemo(() => {
    const m = new Map<string, PerformanceResult["airings"]>();
    for (const a of result.airings) m.set(a.channelCode, [...(m.get(a.channelCode) ?? []), a]);
    return m;
  }, [result.airings]);
  return (
    <details className="mt-6 rounded-lg border border-zinc-200 bg-white">
      <summary className="cursor-pointer px-4 py-3 text-[13px] font-semibold text-zinc-700">상세 근거 — 회차 추이 · 시간대별 · 본방·재방 · 근거 방송</summary>
      <div className="border-t border-zinc-100 px-4 py-3">
        <div className="mb-3 flex flex-wrap gap-1" role="tablist">
          {(
            [
              ["trend", "회차·방송일 추이"],
              ["slot", "시간대별 성과"],
              ["split", "본방·재방 활용"],
              ["airings", `근거 방송 ${result.airings.length}건${result.airingsTruncated ? "+" : ""}`],
            ] as const
          ).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`rounded-full px-3 py-1 text-[12px] ring-1 ${tab === id ? "bg-zinc-900 text-white ring-zinc-900" : "bg-white text-zinc-600 ring-zinc-200 hover:bg-zinc-50"}`}>
              {label}
            </button>
          ))}
        </div>
        {tab === "trend" && (
          <div className="grid gap-4 md:grid-cols-2">
            {[...byChannel.entries()].map(([code, list]) => {
              const max = Math.max(...list.map((a) => a.rating ?? 0), 0);
              return (
                <div key={code}>
                  <div className="mb-1 text-[12px] font-medium text-zinc-700">{CHANNELS.find((c) => c.code === code)?.label ?? code}</div>
                  <ol className="max-h-64 space-y-0.5 overflow-y-auto pr-1">
                    {list.map((a, i) => (
                      <li key={i} className="flex items-center gap-2 text-[11px] tabular-nums">
                        <span className="w-[84px] shrink-0 text-zinc-500">{a.date}</span>
                        <span className="w-8 shrink-0 text-zinc-500">{a.firstRun === true ? "<본>" : a.firstRun === false ? "<재>" : ""}</span>
                        <span className="w-10 shrink-0 text-zinc-500">{a.episode ? `${a.episode}회` : ""}</span>
                        <span className="relative h-2 flex-1 rounded bg-zinc-100" aria-hidden>
                          <span className={`absolute inset-y-0 left-0 rounded ${a.firstRun === false ? "bg-zinc-400" : "bg-sky-500"}`} style={{ width: `${max > 0 ? ((a.rating ?? 0) / max) * 100 : 0}%` }} />
                        </span>
                        <span className="w-14 shrink-0 text-right">{formatRatingValue(a.rating, code)}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              );
            })}
          </div>
        )}
        {tab === "slot" && (
          <table className="w-full text-[12px]">
            <thead className="text-zinc-500">
              <tr>
                <th className="py-1 text-left font-medium">채널</th>
                <th className="py-1 text-left font-medium">요일·시</th>
                <th className="py-1 text-right font-medium">방영</th>
                <th className="py-1 text-right font-medium">평균</th>
              </tr>
            </thead>
            <tbody>
              {[...result.slotCells]
                .sort((a, b) => a.channelCode.localeCompare(b.channelCode) || b.airings - a.airings)
                .map((c, i) => (
                  <tr key={i} className="border-t border-zinc-100">
                    <td className="py-1">{CHANNELS.find((x) => x.code === c.channelCode)?.label ?? c.channelCode}</td>
                    <td className="py-1">
                      {DOW[c.dow]} {c.hourBlock}시
                    </td>
                    <td className="py-1 text-right tabular-nums">{c.airings}</td>
                    <td className="py-1 text-right tabular-nums">{formatRatingValue(c.avg, c.channelCode)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
        {tab === "split" && (
          <table className="w-full text-[12px]">
            <thead className="text-zinc-500">
              <tr>
                <th className="py-1 text-left font-medium">채널</th>
                <th className="py-1 text-right font-medium">&lt;본&gt; 표시 횟수·평균</th>
                <th className="py-1 text-right font-medium">&lt;재&gt; 표시 횟수·평균</th>
                <th className="py-1 text-right font-medium">표시 없음 횟수·평균</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.channelCode} className="border-t border-zinc-100">
                  <td className="py-1">{r.channelName}</td>
                  <td className="py-1 text-right tabular-nums">
                    {r.firstRun.airings}회 · {formatRatingValue(r.firstRun.avg, r.channelCode)}
                  </td>
                  <td className="py-1 text-right tabular-nums">
                    {r.rerun.airings}회 · {formatRatingValue(r.rerun.avg, r.channelCode)}
                  </td>
                  <td className="py-1 text-right tabular-nums">
                    {r.unknownRun.airings}회 · {formatRatingValue(r.unknownRun.avg, r.channelCode)}
                  </td>
                </tr>
              ))}
              <tr>
                <td colSpan={4} className="pt-2 text-[11px] text-zinc-500">
                  원본의 &lt;본&gt; 표시는 ENA에만 있고 &lt;재&gt; 표시는 쓰이지 않아, 다른 채널의 방영은 대부분 ‘표시 없음’입니다(재방으로 단정하지 않음). 재방 유지율(같은 회차 본방 대비)은 회차 연결이 확인된 경우에만 계산할 예정입니다. 본방과 재방은 시간대 조건이 달라 같은 조건으로 순위를 매기지 않습니다.
                </td>
              </tr>
            </tbody>
          </table>
        )}
        {tab === "airings" && (
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 bg-white text-zinc-500">
                <tr>
                  <th className="py-1 text-left font-medium">방송일</th>
                  <th className="py-1 text-left font-medium">채널</th>
                  <th className="py-1 text-left font-medium">시각</th>
                  <th className="py-1 text-left font-medium">표시</th>
                  <th className="py-1 text-left font-medium">회차</th>
                  <th className="py-1 text-left font-medium">표기</th>
                  <th className="py-1 text-right font-medium">시청률</th>
                </tr>
              </thead>
              <tbody>
                {result.airings.map((a, i) => (
                  <tr key={i} className="border-t border-zinc-100">
                    <td className="py-1 tabular-nums">{a.date}</td>
                    <td className="py-1">{CHANNELS.find((x) => x.code === a.channelCode)?.label ?? a.channelCode}</td>
                    <td className="py-1 tabular-nums">
                      {fmtTime(a.startTime)}
                      {a.endTime ? `~${fmtTime(a.endTime)}` : ""}
                    </td>
                    <td className="py-1">{a.firstRun === true ? "<본>" : a.firstRun === false ? "<재>" : "표시 없음"}</td>
                    <td className="py-1">{a.episode ?? MISSING}</td>
                    <td className="py-1 text-zinc-500">{a.name}</td>
                    <td className="py-1 text-right tabular-nums">{formatRatingValue(a.rating, a.channelCode)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {result.airingsTruncated && <p className="mt-2 text-[11px] text-zinc-500">근거 방송이 많아 앞 {result.airings.length}건만 보여 줍니다(평균·배율 계산에는 전부 들어감).</p>}
          </div>
        )}
      </div>
    </details>
  );
}

export default function ProgramPerformanceView({ initialQuery, initialGroup, focusChannel, initialFrom, initialTo }: { initialQuery: string; initialGroup: string | null; focusChannel: string | null; initialFrom: string | null; initialTo: string | null }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [q, setQ] = useState(initialQuery);
  const [classFilter, setClassFilter] = useState<ClassFilter>("all");
  const [items, setItems] = useState<SearchItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [group, setGroup] = useState<string | null>(initialGroup);
  const [preset, setPreset] = useState<PeriodPreset>(initialFrom || initialTo ? "custom" : "all");
  const [from, setFrom] = useState<string | null>(initialFrom);
  const [to, setTo] = useState<string | null>(initialTo);
  const [channels, setChannels] = useState<string[]>([]); // 비면 전체
  const [targetMode, setTargetMode] = useState<TargetMode>("kpi");
  const [airing, setAiring] = useState<AiringFilter>("all");
  const [fetched, setFetched] = useState<{ url: string; result: PerformanceResult | null; error: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 최신 자료일은 직전 응답에서 알게 된 값(기간 프리셋 계산용)
  const [latest, setLatest] = useState<string | null>(null);

  const search = useCallback(async (text: string, f: ClassFilter) => {
    setSearching(true);
    try {
      const res = await fetch(`/api/program-performance/search?q=${encodeURIComponent(text)}&class=${f}`);
      const j = await res.json();
      setItems(j.ok ? (j.items as SearchItem[]) : []);
      if (!j.ok) setError(j.message ?? "검색 실패");
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (!initialQuery || initialGroup) return;
    let cancelled = false;
    fetch(`/api/program-performance/search?q=${encodeURIComponent(initialQuery)}&class=all`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        const list = j.ok ? (j.items as SearchItem[]) : [];
        // 다른 화면에서 이름으로 넘어왔고 후보가 하나뿐이면 바로 연다(여럿이면 사용자가 고른다 — 다른 시즌·동명 작품을 임의로 고르지 않음)
        if (list.length === 1) setGroup(list[0].groupKey);
        else setItems(list);
      })
      .catch(() => !cancelled && setItems([]));
    return () => {
      cancelled = true;
    };
  }, [initialQuery, initialGroup]);

  // 기간 프리셋은 최신 자료일 기준(서버가 알려 준 날짜)으로 시작·종료일을 정한다
  const range = useMemo(() => {
    if (preset === "all") return { from: null, to: null };
    if (preset === "custom") return { from, to };
    if (!latest) return { from: null, to: null };
    return { from: addDays(latest, preset === "4w" ? -27 : -83), to: latest };
  }, [preset, from, to, latest]);

  const requestUrl = useMemo(() => {
    if (!group) return null;
    const params = new URLSearchParams({ group, airing, target: targetMode });
    if (range.from) params.set("from", range.from);
    if (range.to) params.set("to", range.to);
    if (channels.length) params.set("channels", channels.join(","));
    return `/api/program-performance?${params}`;
  }, [group, airing, targetMode, range.from, range.to, channels]);
  const loading = requestUrl !== null && fetched?.url !== requestUrl;
  const result = fetched && fetched.url === requestUrl ? fetched.result : null;
  const fetchError = fetched && fetched.url === requestUrl ? fetched.error : null;

  useEffect(() => {
    if (!requestUrl || !group) return;
    let cancelled = false;
    fetch(requestUrl)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        setFetched({ url: requestUrl, result: j.ok ? (j.result as PerformanceResult) : null, error: j.ok ? null : (j.message ?? "조회 실패") });
        if (j.ok) setLatest((j.result as PerformanceResult).period.latestDataDate);
      })
      .catch(() => !cancelled && setFetched({ url: requestUrl, result: null, error: "조회 중 오류가 났습니다." }));
    // 주소에 현재 작품을 남겨 새로고침·공유 시 같은 화면이 열리게 한다
    const next = new URLSearchParams(sp.toString());
    next.set("group", group);
    next.delete("q");
    router.replace(`/program-performance?${next}`, { scroll: false });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestUrl]);

  const toggleChannel = (code: string) => setChannels((cur) => (cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code]));

  return (
    <div className="mx-auto w-full min-w-0 max-w-screen-2xl px-4 py-5 sm:px-6">
      <header className="mb-4">
        <h1 className="text-[20px] font-bold text-zinc-900">프로그램 성과</h1>
        <p className="mt-0.5 text-[12px] text-zinc-500">한 작품의 채널별 실적, 채널 일평균 대비 수준, 같은 시간대 대비 효율을 한 표에서 비교합니다.</p>
      </header>

      <section className="rounded-lg border border-zinc-200 bg-white p-3">
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void search(q, classFilter);
          }}
        >
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="프로그램 이름(일부·약칭 가능)" aria-label="프로그램 검색" className="min-w-[220px] flex-1 rounded-md border border-zinc-300 px-3 py-1.5 text-[16px] sm:text-[14px]" />
          <button type="submit" className="rounded-md bg-zinc-900 px-3 py-1.5 text-[13px] font-medium text-white">
            검색
          </button>
          <div className="flex flex-wrap gap-1" role="group" aria-label="작품 분류">
            {CLASS_FILTERS.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={classFilter === c.id}
                onClick={() => {
                  setClassFilter(c.id);
                  void search(q, c.id);
                }}
                className={`rounded-full px-3 py-1 text-[12px] ring-1 ${classFilter === c.id ? "bg-indigo-600 text-white ring-indigo-600" : "bg-white text-zinc-600 ring-zinc-200 hover:bg-zinc-50"}`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </form>
        {searching && <p className="mt-2 text-[12px] text-zinc-500">찾는 중…</p>}
        {items && !searching && (
          <ul className="mt-2 flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
            {items.length === 0 && <li className="text-[12px] text-zinc-500">일치하는 자사 방영 작품이 없습니다.</li>}
            {items.map((it) => (
              <li key={it.groupKey}>
                <button
                  type="button"
                  onClick={() => {
                    setGroup(it.groupKey);
                    setItems(null);
                  }}
                  className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-left text-[13px] ring-1 ${group === it.groupKey ? "bg-zinc-900 text-white ring-zinc-900" : "bg-white ring-zinc-200 hover:bg-zinc-50"}`}
                >
                  <span className="font-medium">{it.displayName}</span>
                  <ClassBadge cls={it.classification} />
                  <span className="text-[11px] opacity-70">
                    {it.ownChannels.length}개 채널 · 최근 {it.lastDate ?? MISSING}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {group && (
        <section className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px]">
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="기간">
            {(
              [
                ["all", "보유 자료 전체"],
                ["4w", "최근 4주"],
                ["12w", "최근 12주"],
                ["custom", "직접 선택"],
              ] as const
            ).map(([id, label]) => (
              <button key={id} type="button" aria-pressed={preset === id} onClick={() => setPreset(id)} className={`rounded-full px-2.5 py-1 ring-1 ${preset === id ? "bg-zinc-900 text-white ring-zinc-900" : "bg-white text-zinc-600 ring-zinc-200"}`}>
                {label}
              </button>
            ))}
            {preset === "custom" && (
              <>
                <input type="date" value={from ?? ""} onChange={(e) => setFrom(e.target.value || null)} aria-label="시작일" className="rounded border border-zinc-300 px-1.5 py-0.5 text-[16px] sm:text-[12px]" />
                <span>~</span>
                <input type="date" value={to ?? ""} onChange={(e) => setTo(e.target.value || null)} aria-label="종료일" className="rounded border border-zinc-300 px-1.5 py-0.5 text-[16px] sm:text-[12px]" />
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="채널">
            <button type="button" aria-pressed={channels.length === 0} onClick={() => setChannels([])} className={`rounded-full px-2.5 py-1 ring-1 ${channels.length === 0 ? "bg-zinc-900 text-white ring-zinc-900" : "bg-white text-zinc-600 ring-zinc-200"}`}>
              전체 채널
            </button>
            {CHANNELS.map((c) => (
              <button key={c.code} type="button" aria-pressed={channels.includes(c.code)} onClick={() => toggleChannel(c.code)} className={`rounded-full px-2.5 py-1 ring-1 ${channels.includes(c.code) ? "bg-sky-600 text-white ring-sky-600" : "bg-white text-zinc-600 ring-zinc-200"}`}>
                {c.label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1">
            타깃
            <select value={targetMode} onChange={(e) => setTargetMode(e.target.value as TargetMode)} className="rounded border border-zinc-300 px-1.5 py-0.5 text-[16px] sm:text-[12px]">
              {(Object.keys(TARGET_LABEL) as TargetMode[]).map((t) => (
                <option key={t} value={t}>
                  {TARGET_LABEL[t]}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="본방·재방">
            {(Object.keys(AIRING_LABEL) as AiringFilter[]).map((a) => (
              <button key={a} type="button" aria-pressed={airing === a} onClick={() => setAiring(a)} className={`rounded-full px-2.5 py-1 ring-1 ${airing === a ? "bg-zinc-900 text-white ring-zinc-900" : "bg-white text-zinc-600 ring-zinc-200"}`}>
                {AIRING_LABEL[a]}
              </button>
            ))}
          </div>
        </section>
      )}

      {(error || fetchError) && <p className="mt-4 rounded-md bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{fetchError ?? error}</p>}
      {loading && <p className="mt-4 text-[13px] text-zinc-500">채널별 성과를 계산하는 중…</p>}

      {result && !loading && (
        <section className="mt-4" aria-live="polite">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[18px] font-bold text-zinc-900">{result.work.displayName}</h2>
            <ClassBadge cls={result.classification.cls} />
            <span className="text-[12px] text-zinc-500">
              {TARGET_LABEL[result.query.targetMode]} · {AIRING_LABEL[result.query.airing]} · {result.period.from} ~ {result.period.to}
            </span>
          </div>
          <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-[13px]">
            <div>
              <dt className="inline text-zinc-500">방영 채널 </dt>
              <dd className="inline font-semibold tabular-nums">{result.totals.channels}개</dd>
            </div>
            <div>
              <dt className="inline text-zinc-500">방영 횟수 </dt>
              <dd className="inline font-semibold tabular-nums">{formatInt(result.totals.airings)}회</dd>
            </div>
            <div>
              <dt className="inline text-zinc-500">고유 회차 </dt>
              <dd className="inline font-semibold tabular-nums">{result.totals.episodes ? `${result.totals.episodes}개` : "회차 정보 없음"}</dd>
            </div>
            <div className="text-[12px] text-zinc-500">
              작품 첫 관측 {result.period.workFirstObserved ?? MISSING} · 확인된 첫 본방 {result.period.workFirstFirstRun ?? MISSING} · 최신 자료 {result.period.latestDataDate ?? MISSING}
            </div>
          </dl>
          {result.notes.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-[12px] text-amber-800">
              {result.notes.map((n, i) => (
                <li key={i}>※ {n}</li>
              ))}
            </ul>
          )}

          {result.groups.map((g) => (
            <ChannelTable key={g.kpiGroup} rows={g.rows} focus={focusChannel} kpiGroup={g.kpiGroup} targetMode={result.query.targetMode} />
          ))}
          <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
            채널 평균 대비는 작품이 방영된 시간대의 유불리가 섞인 규모 참고 지표이고, 동슬롯 대비는 같은 요일·시간대의 다른 프로그램과 견준 편성 효율입니다. 서로 다른 KPI(2049·가구)의 값으로 채널 순위를 매기지 않습니다. 관측된 방향이며 인과·향후 효과를 뜻하지 않습니다. 현재 판정은 최근 12주 콘텐츠 적합도 기준입니다.
          </p>
          <Details result={result} />
        </section>
      )}
    </div>
  );
}
