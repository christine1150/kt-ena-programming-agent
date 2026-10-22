"use client";

// 프로그램 성과 화면 — 검색·필터·표시만 한다. 모든 수치(평균·배율·증감·표본·상태·월간 추이)는 /api/program-performance가 서버에서 확정해 준 값이다.
// 분석 구조 수정(2026-10-22): 채널별 성과 비교표 → 행(채널·타깃) 선택 → 2×2 분석(시청률 흐름·최고/최저·편성 비교·종합 평가) → 필요할 때 상세(방송 구분별 성과·방송 기록).
//  - 비교표: 시청률(아래 작은 채널 평균)·점유율·채널 평균 대비·같은 시간대 대비. 표본이 적은 채널은 채널명 옆 (n일).
//  - 문구(흐름·최고/최저·시간대·종합)는 서버 고정 템플릿. 최근 12주 편성 진단은 기간이 달라 이 화면에 섞지 않고 채널 화면으로 연결.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { formatInt, formatPct, formatRatingValue, formatSigned, MISSING } from "@/lib/ui/metricFormat";
import { WORK_CLASS_LABEL } from "@/lib/programPerformance/metrics";
import type { AiringFilter, AiringRef, ChannelLine, ChannelRow, CompetitorRow, Direction, MonthlyPoint, PerformanceResult, RatioValue, SearchItem, TargetMode, WorkClass } from "@/lib/programPerformance/types";

type ClassFilter = "all" | "drama" | "variety";
type PeriodPreset = "all" | "4w" | "12w" | "custom";

const CLASS_FILTERS: { id: Exclude<ClassFilter, "all">; label: string }[] = [
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
const TARGET_LABEL: Record<TargetMode, string> = { both: "수도권 2049·전국 유료가구 모두", kpi: "채널별 KPI만", common2049: "공통: 수도권 2049", commonHH: "공통: 전국 유료가구" };
const AIRING_LABEL: Record<AiringFilter, string> = { all: "전체 방송", first: "본방", rerun: "본방 외" };
const AIRING_HELP: Record<AiringFilter, string> = {
  all: "",
  first: "본방: 원본 자료에 본방 표시가 있는 방영(현재 ENA만 표시)",
  rerun: "본방 외: 확인된 재방과 본방 여부가 확인되지 않은 기록을 함께 포함",
};
// 채널 평균보다 좋으면 푸른색, 나쁘면 붉은색(사용자 지정, 2026-10-22) — 부호(+/−)와 함께 써 색만으로 전달하지 않는다
const DIR_CLASS: Record<Direction, string> = { HIGHER: "text-blue-700", SIMILAR: "text-zinc-700", LOWER: "text-rose-700", NA: "text-zinc-400" };
const DIR_WORD: Record<Direction, string> = { HIGHER: "높음", SIMILAR: "비슷", LOWER: "낮음", NA: "" };
const EXCLUDED: ChannelRow["status"][] = ["UNSUPPORTED", "NO_TARGET"];
const CLASS_BADGE: Record<WorkClass, string> = {
  ORIGINAL_DRAMA: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  ORIGINAL_VARIETY: "bg-amber-50 text-amber-800 ring-amber-200",
  OTHER_FEATURED: "bg-zinc-50 text-zinc-700 ring-zinc-200",
  UNCONFIRMED: "bg-white text-zinc-500 ring-zinc-200",
  CONFLICT: "bg-rose-50 text-rose-700 ring-rose-200",
};
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const chip = (on: boolean) => `rounded-full px-2.5 py-1 ring-1 ${on ? "bg-zinc-900 text-white ring-zinc-900" : "bg-white text-zinc-600 ring-zinc-200 hover:bg-zinc-50"}`;

function addDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
const fmtTime = (t: string | null) => {
  if (!t) return MISSING;
  const h = Number(t.slice(0, 2));
  return `${String(h < 2 ? h + 24 : h).padStart(2, "0")}:${t.slice(3, 5)}`;
};

/** 오리지널 드라마·예능(그리고 관리자 확인이 필요한 분류 충돌)만 배지를 단다 — 목록에 없는 작품은 아무 표시 없음(비오리지널로 단정하지 않음, 사용자 지정 2026-10-22) */
const SHOW_CLASS: WorkClass[] = ["ORIGINAL_DRAMA", "ORIGINAL_VARIETY", "CONFLICT"];

function ClassBadge({ cls }: { cls: WorkClass }) {
  if (!SHOW_CLASS.includes(cls)) return null;
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${CLASS_BADGE[cls]}`}>{WORK_CLASS_LABEL[cls]}</span>;
}

/** 채널 평균 대비 — 서버가 낸 상대 차이(%)를 부호와 색으로만. 화살표·상회/하회 글자를 겹쳐 쓰지 않는다(뜻은 접근성 텍스트로). */
function DeltaText({ r }: { r: RatioValue }) {
  if (r.ratio === null || r.pct === null) return <span className="text-zinc-400">산출 불가</span>;
  const label = `기준보다 ${formatSigned(r.pct, 0)}%${DIR_WORD[r.direction] ? `(${DIR_WORD[r.direction]})` : ""}`;
  return (
    <span className={`font-semibold tabular-nums ${DIR_CLASS[r.direction]}`} aria-label={label}>
      {formatSigned(r.pct, 0)}%
    </span>
  );
}

/** 표본 기준(콘텐츠 적합도와 같음): 3일 미만 자료 부족, 8일 미만 자료 적음 — 실제 일수와 함께 */
function sampleText(r: ChannelRow): string | null {
  if (r.sampleState === "NONE") return `자료 부족 · ${r.days}일`;
  if (r.sampleState === "SMALL") return `자료 적음 · ${r.days}일`;
  return null;
}

function emptyText(r: ChannelRow, airing: AiringFilter): string {
  if (r.status === "NO_PROGRAM_DATA" || r.status === "NO_TARGET") return "자료 없음";
  if (r.status === "OBSERVED") return airing === "first" ? "본방 없음" : "본방 외 방영 없음";
  return "자료 없음";
}

/** 채널 하나 = 방영 기록이 있는 채널. rows는 그 채널의 타깃별 행(KPI 타깃 먼저). */
interface ChannelEntry {
  main: ChannelRow;
  rows: ChannelRow[];
}

const rowKey = (r: ChannelRow) => `${r.channelCode}|${r.targetLabel}`;

/** 좁은 화면에서는 타깃을 짧게(2049·가구) — 표가 화면 폭 안에 들어오게 */
function TargetName({ label }: { label: string }) {
  const short = label.includes("2049") ? "2049" : label.includes("유료가구") ? "가구" : label;
  return (
    <>
      <span className="whitespace-nowrap sm:hidden">{short}</span>
      <span className="hidden whitespace-nowrap sm:inline">{label}</span>
    </>
  );
}

/**
 * 채널별 성과 비교표 — 방영 기록이 있는 채널만, 채널마다 수도권 2049·전국 유료가구 행(KPI 타깃 먼저, 'KPI' 표시).
 * 시청률 아래 작은 글씨로 그 행의 채널 평균. 두 대비 열은 시청률 기준 상대 차이(%). 행을 누르면 아래 분석이 그 채널·타깃으로 바뀐다.
 */
function ChannelTable({ entries, airing, selected, onSelect }: { entries: ChannelEntry[]; airing: AiringFilter; selected: string | null; onSelect: (r: ChannelRow) => void }) {
  return (
    <section className="mt-4">
      <div className="dense-grid overflow-x-auto rounded-lg border border-zinc-200 bg-white" tabIndex={0} role="region" aria-label="채널별 성과 비교 표">
        <table className="w-full text-[14px]">
          <thead className="break-keep bg-zinc-50 text-[12px] text-zinc-500">
            <tr>
              <th className="px-1.5 py-2 text-left font-medium sm:px-3">채널</th>
              <th className="px-1.5 py-2 text-left font-medium sm:px-3">타깃</th>
              <th className="px-1.5 py-2 text-right font-medium sm:px-3">시청률(%)</th>
              <th className="px-1.5 py-2 text-right font-medium sm:px-3">점유율(%)</th>
              <th className="px-1.5 py-2 text-right font-medium sm:px-3">
                채널 평균<span className="hidden sm:inline"> 대비</span>
              </th>
              <th className="px-1.5 py-2 text-right font-medium sm:px-3">
                같은 시간대<span className="hidden sm:inline"> 대비</span>
              </th>
            </tr>
          </thead>
          {entries.map(({ main, rows }) => {
            const code = main.channelCode;
            const sample = sampleText(main);
            return (
              <tbody key={code} className="border-t border-zinc-200">
                {rows.map((r, i) => {
                  const observed = r.status === "OBSERVED" && r.airings > 0;
                  const isSel = selected === rowKey(r);
                  return (
                    <tr key={r.targetLabel} className={`${i > 0 ? "border-t border-zinc-100" : ""} ${isSel ? "bg-sky-50" : observed ? "cursor-pointer hover:bg-zinc-50" : ""}`} onClick={observed ? () => onSelect(r) : undefined}>
                      {i === 0 && (
                        <td rowSpan={rows.length} className="bg-white px-1.5 py-2 align-top sm:px-3">
                          <button type="button" onClick={(e) => (e.stopPropagation(), onSelect(main))} className="text-left font-medium text-zinc-900 underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-600" aria-label={`${main.channelName} 분석 보기`}>
                            {main.channelName}
                          </button>
                          {sample && (
                            <span className={`ml-1 whitespace-nowrap text-[11px] ${main.sampleState === "NONE" ? "text-rose-700" : "text-amber-700"}`} title={`${sample} — 집계 방송일이 ${main.sampleState === "NONE" ? "3" : "8"}일 미만`} aria-label={sample}>
                              ({main.days}일)
                            </span>
                          )}
                        </td>
                      )}
                      <td className={`px-1.5 py-2 text-[12px] sm:px-3 ${r.primary ? "text-zinc-800" : "text-zinc-500"}`}>
                        {observed ? (
                          <button type="button" aria-pressed={isSel} onClick={(e) => (e.stopPropagation(), onSelect(r))} className="text-left" aria-label={`${r.channelName} ${r.targetLabel} 분석 보기`}>
                            <TargetName label={r.targetLabel} />
                          </button>
                        ) : (
                          <TargetName label={r.targetLabel} />
                        )}
                        {r.primary && rows.length > 1 && <span className="ml-1 rounded bg-zinc-100 px-1 text-[10px] text-zinc-600">KPI</span>}
                      </td>
                      <td className="px-1.5 py-2 text-right sm:px-3">
                        {observed ? <span className={`tabular-nums ${r.primary ? "font-semibold" : ""}`}>{formatRatingValue(r.programAvg, code)}</span> : <span className="text-[12px] text-zinc-400">{emptyText(r, airing)}</span>}
                        <div className="text-[11px] tabular-nums text-zinc-400 sm:whitespace-nowrap">채널 평균 {formatRatingValue(r.channelDaily?.mean ?? null, code)}</div>
                      </td>
                      <td className="px-1.5 py-2 text-right tabular-nums sm:px-3">{!observed ? <span className="text-zinc-300">{MISSING}</span> : r.shareAvg === null ? <span className="text-[12px] text-zinc-400">자료 없음</span> : formatPct(r.shareAvg)}</td>
                      <td className="px-1.5 py-2 text-right sm:px-3">{observed ? <DeltaText r={r.vsChannel} /> : <span className="text-zinc-300">{MISSING}</span>}</td>
                      <td className="px-1.5 py-2 text-right sm:px-3">{observed && r.slot && r.slot.airingsUsed > 0 ? <DeltaText r={r.slot.ratio} /> : <span className="text-zinc-300">{MISSING}</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            );
          })}
        </table>
      </div>
      <p className="mt-1 text-[11px] text-zinc-500">대비 두 열은 시청률 기준 상대 차이(%)입니다. 행을 누르면 아래 분석이 바뀝니다.</p>
    </section>
  );
}


/** 경쟁 채널 성과 — 선택해서 연다. 같은 작품이 등록 경쟁채널에서 방영된 기록만(닐슨 경쟁채널 시트), 채널 평균은 그 경쟁채널의 하루 시청률 일평균 */
function CompetitorSection({ rows, lines }: { rows: CompetitorRow[]; lines: ChannelLine[] }) {
  const names = [...new Set(rows.map((r) => r.competitorName))];
  return (
    <section className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50/50 p-3">
      <div className="space-y-1 text-[13px] leading-relaxed text-zinc-800">
        {lines.map((l) => (
          <p key={l.channelCode}>{l.text}</p>
        ))}
      </div>
      <div className="dense-grid mt-2 overflow-x-auto rounded-md border border-zinc-200 bg-white" tabIndex={0} role="region" aria-label="경쟁 채널 성과 표">
        <table className="w-full text-[14px]">
          <thead className="break-keep bg-zinc-50 text-[12px] text-zinc-500">
            <tr>
              <th className="px-1.5 py-2 text-left font-medium sm:px-3">경쟁 채널</th>
              <th className="px-1.5 py-2 text-left font-medium sm:px-3">타깃</th>
              <th className="px-1.5 py-2 text-right font-medium sm:px-3">시청률(%)</th>
              <th className="px-1.5 py-2 text-right font-medium sm:px-3">점유율(%)</th>
              <th className="px-1.5 py-2 text-right font-medium sm:px-3">
                채널 평균<span className="hidden sm:inline"> 대비</span>
              </th>
            </tr>
          </thead>
          {names.map((name) => {
            const rs = rows.filter((r) => r.competitorName === name);
            const main = rs[0];
            const sample = main.sampleState === "NONE" ? `자료 부족 · ${main.days}일` : main.sampleState === "SMALL" ? `자료 적음 · ${main.days}일` : null;
            return (
              <tbody key={name} className="border-t border-zinc-200">
                {rs.map((r, i) => (
                  <tr key={r.targetLabel} className={i > 0 ? "border-t border-zinc-100" : ""}>
                    {i === 0 && (
                      <td rowSpan={rs.length} className="px-1.5 py-2 align-top font-medium text-zinc-900 sm:px-3">
                        {name}
                        {sample && (
                          <span className={`ml-1 whitespace-nowrap text-[11px] font-normal ${main.sampleState === "NONE" ? "text-rose-700" : "text-amber-700"}`} title={sample} aria-label={sample}>
                            ({main.days}일)
                          </span>
                        )}
                        <div className="text-[11px] font-normal text-zinc-500">
                          {main.airings}회{main.rerunAirings ? ` · 재방 ${main.rerunAirings}` : ""}
                          {main.firstRunAirings ? ` · 본방 ${main.firstRunAirings}` : ""}
                        </div>
                      </td>
                    )}
                    <td className="px-1.5 py-2 text-[12px] text-zinc-700 sm:px-3">
                      <TargetName label={r.targetLabel} />
                    </td>
                    <td className="px-1.5 py-2 text-right sm:px-3">
                      <span className="tabular-nums">{formatRatingValue(r.programAvg, name)}</span>
                      <div className="text-[11px] tabular-nums text-zinc-400 sm:whitespace-nowrap">채널 평균 {formatRatingValue(r.channelDaily?.mean ?? null, name)}</div>
                    </td>
                    <td className="px-1.5 py-2 text-right tabular-nums sm:px-3">{r.shareAvg === null ? <span className="text-[12px] text-zinc-400">자료 없음</span> : formatPct(r.shareAvg)}</td>
                    <td className="px-1.5 py-2 text-right sm:px-3">
                      <DeltaText r={r.vsChannel} />
                    </td>
                  </tr>
                ))}
              </tbody>
            );
          })}
        </table>
      </div>
      <p className="mt-1 text-[11px] text-zinc-500">닐슨 일일 파일의 경쟁채널 시트(등록 경쟁채널만)에 같은 작품 이름으로 잡힌 방영입니다. 채널 평균은 그 경쟁채널의 하루 시청률 일평균(자사 채널 평균과 같은 정의). 같은 시간대 비교는 경쟁 채널 편성 전체가 없어 내지 않습니다.</p>
    </section>
  );
}

const monthTitle = (m: MonthlyPoint) => `${Number(m.month.slice(5))}월${m.partial ? ` ${Number(m.from.slice(8))}~${Number(m.to.slice(8))}일` : ""}`;
const shortDate = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}(${DOW[new Date(`${d}T00:00:00Z`).getUTCDay()]})`;
const slotName = (dow: number, hb: number) => `${DOW[dow]} ${hb}시대`;

function Card({ title, lead, children }: { title: string; lead: string; children?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-zinc-200 bg-white p-3">
      <h4 className="text-[12px] font-medium text-zinc-500">{title}</h4>
      <p className="mt-0.5 text-[14px] font-semibold leading-snug text-zinc-900">{lead}</p>
      {children && <div className="mt-2">{children}</div>}
    </div>
  );
}

/** 작은 추이 그래프 — 서버가 낸 점 값을 그대로 찍기만 한다(값이 없는 점은 끊는다, 0으로 잇지 않음). 보조선은 같은 달 채널 평균. */
function Spark({ points, base, code }: { points: { label: string; value: number | null }[]; base?: (number | null)[]; code: string }) {
  const W = 320;
  const H = 84;
  const P = 8;
  const vals = [...points.map((p) => p.value), ...(base ?? [])].filter((v): v is number => v !== null);
  if (vals.length === 0) return null;
  const max = Math.max(...vals);
  const min = Math.min(0, ...vals);
  const x = (i: number) => (points.length === 1 ? W / 2 : P + (i * (W - 2 * P)) / (points.length - 1));
  const y = (v: number) => H - 14 - ((v - min) / (max - min || 1)) * (H - 28);
  const path = (arr: (number | null)[]) =>
    arr
      .map((v, i) => (v === null ? null : `${i === 0 || arr[i - 1] === null ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`))
      .filter(Boolean)
      .join(" ");
  const vs = points.map((p) => p.value);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-[84px] w-full" role="img" aria-label={points.map((p) => `${p.label} ${formatRatingValue(p.value, code)}`).join(", ")}>
      {base && <path d={path(base)} fill="none" stroke="#a1a1aa" strokeWidth={1.2} strokeDasharray="3 3" />}
      <path d={path(vs)} fill="none" stroke="#2563eb" strokeWidth={1.8} />
      {vs.map((v, i) => v !== null && <circle key={i} cx={x(i)} cy={y(v)} r={2.6} fill="#2563eb" />)}
      <text x={x(0)} y={H - 2} fontSize={10} fill="#71717a" textAnchor={points.length === 1 ? "middle" : "start"}>
        {points[0].label}
      </text>
      {points.length > 1 && (
        <text x={x(points.length - 1)} y={H - 2} fontSize={10} fill="#71717a" textAnchor="end">
          {points[points.length - 1].label}
        </text>
      )}
    </svg>
  );
}

/** A. 시청률 흐름 — 회차별(본방·회차 확인분)과 월별을 이 영역 안에서만 전환 */
function TrendCard({ row }: { row: ChannelRow }) {
  const a = row.analysis!;
  const hasEp = a.episodes.length >= 2;
  const [unit, setUnit] = useState<"episode" | "month">(hasEp ? "episode" : "month");
  const code = row.channelCode;
  const months = row.monthly;
  return (
    <Card title="시청률 흐름" lead={a.trendText}>
      {hasEp && (
        <div className="mb-1 flex gap-1 text-[12px]" role="group" aria-label="추이 단위">
          <button type="button" aria-pressed={unit === "episode"} onClick={() => setUnit("episode")} className={chip(unit === "episode")}>
            회차별(본방)
          </button>
          <button type="button" aria-pressed={unit === "month"} onClick={() => setUnit("month")} className={chip(unit === "month")}>
            월별
          </button>
        </div>
      )}
      {unit === "episode" && hasEp ? (
        <Spark code={code} points={a.episodes.map((e) => ({ label: `${e.episode}회`, value: e.avg }))} />
      ) : (
        <>
          <Spark code={code} points={months.map((m) => ({ label: monthTitle(m), value: m.airings > 0 ? m.programAvg : null }))} base={months.map((m) => m.channelAvg)} />
          <p className="text-[11px] text-zinc-500">
            월별 방영 평균(파란 선) · 같은 달 채널 평균(점선){months.some((m) => m.airings === 0) ? " · 방영 없는 달은 비움" : ""}
          </p>
        </>
      )}
    </Card>
  );
}

/** B. 최고·최저 — 선택 기간·방송 구분 안의 개별 방영 */
function ExtremesCard({ row }: { row: ChannelRow }) {
  const a = row.analysis!;
  const x = a.extremes;
  const code = row.channelCode;
  const cell = (k: string, r: AiringRef) => (
    <div className="min-w-0">
      <dt className="text-[11px] text-zinc-500">{k}</dt>
      <dd className="font-semibold tabular-nums text-zinc-900">{formatRatingValue(r.rating, code, { unit: true })}</dd>
      <dd className="text-[11px] text-zinc-500">{r.episode !== null ? `${r.episode}회 · ` : ""}{shortDate(r.date)} {fmtTime(r.startTime)}{r.firstRun === true ? " · 본방" : ""}</dd>
    </div>
  );
  return (
    <Card title="최고·최저" lead={a.extremesText}>
      {x && (
        <dl className="grid grid-cols-3 gap-2 text-[14px]">
          {cell("최고", x.best)}
          {cell("최저", x.worst)}
          {cell("최근 방영", x.recent)}
        </dl>
      )}
    </Card>
  );
}

const SLOT_SHOW = 4;

/** C. 편성 비교 — 실제 방영한 요일·시간대별, 같은 요일·시 다른 프로그램 단순 평균 대비 */
function SlotCard({ row }: { row: ChannelRow }) {
  const a = row.analysis!;
  const code = row.channelCode;
  const [all, setAll] = useState(false);
  // 기본은 방송일 3일 이상 구간(서버가 앞에 정렬)만 최대 4개, 전체 목록은 따로 연다
  const judged = a.slots.filter((s) => s.sampleState !== "NONE");
  const list = all ? a.slots : (judged.length ? judged : a.slots).slice(0, SLOT_SHOW);
  return (
    <Card title="편성 비교" lead={a.slotText}>
      {a.slots.length > 0 && (
        <div className="dense-grid overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="text-[11px] text-zinc-500">
              <tr>
                <th className="py-1 text-left font-medium">요일·시간대</th>
                <th className="py-1 text-right font-medium">시청률</th>
                <th className="py-1 text-right font-medium">같은 시간대</th>
                <th className="py-1 text-right font-medium">차이</th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <tr key={`${s.dow}-${s.hourBlock}`} className="border-t border-zinc-100">
                  <td className="py-1">
                    {slotName(s.dow, s.hourBlock)}
                    <span className={`ml-1 text-[11px] ${s.sampleState === "OK" ? "text-zinc-400" : s.sampleState === "NONE" ? "text-rose-700" : "text-amber-700"}`} title={sampleTitle(s.sampleState, s.days)}>
                      {s.airings}회{s.sampleState !== "OK" ? `·${s.days}일` : ""}
                    </span>
                  </td>
                  <td className="py-1 text-right tabular-nums">{formatRatingValue(s.avg, code)}</td>
                  <td className="py-1 text-right tabular-nums">
                    {s.compAvg === null ? (
                      <span className="text-[11px] text-zinc-400" title={s.vs.naReason ?? ""}>
                        비교 부족
                      </span>
                    ) : (
                      <>
                        {formatRatingValue(s.compAvg, code)}
                        {s.basis === "HOUR" && (
                          <span className="ml-0.5 text-[10px] text-zinc-400" title={`같은 요일·시 비교 방송이 적어 같은 시(모든 요일) ${s.compAirings}건과 비교`}>
                            전 요일
                          </span>
                        )}
                      </>
                    )}
                  </td>
                  <td className="py-1 text-right">{s.vs.ratio === null ? <span className="text-zinc-300">{MISSING}</span> : <DeltaText r={s.vs} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {a.slots.length > list.length || all ? (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-1 text-[12px] text-zinc-600 underline underline-offset-2">
          {all ? "접기" : `전체 ${a.slots.length}개 시간대`}
        </button>
      ) : null}
      <p className="mt-1 text-[11px] text-zinc-500">같은 요일·시(적으면 같은 시·전 요일)에 방송한 다른 프로그램 단순 평균 대비, 시청률 기준 상대 차이. 방영하지 않은 시간대는 넣지 않습니다.</p>
    </Card>
  );
}

/** D. 종합 평가 — 서버 고정 문구(결론 한 줄 + 근거 최대 두 개). 판정 태그 없음 */
function VerdictCard({ row }: { row: ChannelRow }) {
  const a = row.analysis!;
  return (
    <Card title="종합 평가" lead={a.verdict}>
      {a.reasons.length > 0 && (
        <ul className="space-y-0.5 text-[13px] text-zinc-700">
          {a.reasons.map((t) => (
            <li key={t}>· {t}</li>
          ))}
        </ul>
      )}
      <a href={`/channel/${row.channelCode}#content-fits`} className="mt-2 inline-block text-[12px] text-zinc-500 underline underline-offset-2 hover:text-zinc-800">
        최근 12주 편성 진단은 채널 화면에서 보기
      </a>
    </Card>
  );
}

const sampleTitle = (s: "OK" | "SMALL" | "NONE", days: number) => (s === "NONE" ? `자료 부족 · ${days}일(3일 미만)` : s === "SMALL" ? `자료 적음 · ${days}일(8일 미만)` : `${days}일`);

/** 선택한 채널·타깃의 2×2 분석 + 상세(방송 구분별 성과·방송 기록) 한 곳 */
function Analysis({ row, result }: { row: ChannelRow; result: PerformanceResult }) {
  const code = row.channelCode;
  const airings = result.airings.filter((a) => a.channelCode === code);
  const splits = [
    { label: "본방", s: row.firstRun },
    { label: "확인된 재방", s: row.rerun },
    { label: "본방 여부 미확인", s: row.unknownRun },
  ].filter((x) => x.s.airings > 0);
  const cd = row.channelDaily;
  return (
    <section className="mt-6" aria-label={`${row.channelName} ${row.targetLabel} 분석`}>
      <h3 className="text-[15px] font-semibold text-zinc-900">
        {row.channelName} <span className="font-normal text-zinc-500">· {row.targetLabel}</span>
      </h3>
      <p className="text-[12px] text-zinc-500">
        {row.observedFrom} ~ {row.observedTo} 중 {formatInt(row.airings)}회 · 방송일 {row.days}일{row.episodes ? ` · 회차 ${row.episodes}개` : ""}
        {cd && cd.validDays < cd.periodDays ? ` · 채널 평균 자료 ${cd.validDays}/${cd.periodDays}일` : ""}
      </p>
      {!row.analysis ? (
        <p className="mt-2 text-[13px] text-zinc-600">{row.statusNote || "이 조건의 방영 기록이 없습니다."}</p>
      ) : (
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          <TrendCard key={`t-${code}-${row.targetLabel}`} row={row} />
          <ExtremesCard row={row} />
          <SlotCard key={`s-${code}-${row.targetLabel}`} row={row} />
          <VerdictCard row={row} />
        </div>
      )}
      {row.analysis && (
        <Fold title={`상세 · 방송 구분별 성과와 방송 기록 ${airings.length}건`}>
          {splits.length > 0 && (
            <table className="mb-2 w-full max-w-md text-[12px]">
              <thead className="text-zinc-500">
                <tr>
                  <th className="py-1 text-left font-medium">구분(조회 기간 전체)</th>
                  <th className="py-1 text-right font-medium">방영</th>
                  <th className="py-1 text-right font-medium">방송일</th>
                  <th className="py-1 text-right font-medium">평균(%)</th>
                </tr>
              </thead>
              <tbody>
                {splits.map((x) => (
                  <tr key={x.label} className="border-t border-zinc-100">
                    <td className="py-1">{x.label}</td>
                    <td className="py-1 text-right tabular-nums">{x.s.airings}회</td>
                    <td className="py-1 text-right tabular-nums">{x.s.days}일</td>
                    <td className="py-1 text-right tabular-nums">{formatRatingValue(x.s.avg, code)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {row.primary ? (
            <table className="w-full min-w-[520px] text-[12px]">
              <thead className="sticky top-0 bg-white text-zinc-500">
                <tr>
                  <th className="py-1 text-left font-medium">방송일</th>
                  <th className="py-1 text-left font-medium">시각</th>
                  <th className="py-1 text-left font-medium">원본 태그</th>
                  <th className="py-1 text-left font-medium">회차</th>
                  <th className="py-1 text-left font-medium">원본 표기</th>
                  <th className="py-1 text-right font-medium">시청률(%)</th>
                </tr>
              </thead>
              <tbody>
                {airings.map((a, i) => (
                  <tr key={i} className="border-t border-zinc-100">
                    <td className="py-1 tabular-nums">{a.date}</td>
                    <td className="py-1 tabular-nums">
                      {fmtTime(a.startTime)}
                      {a.endTime ? `~${fmtTime(a.endTime)}` : ""}
                    </td>
                    <td className="py-1">{a.firstRun === true ? "<본>" : a.firstRun === false ? "<재>" : "없음"}</td>
                    <td className="py-1">{a.episode ?? MISSING}</td>
                    <td className="py-1 text-zinc-500">{a.name}</td>
                    <td className="py-1 text-right tabular-nums">{formatRatingValue(a.rating, code)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-[12px] text-zinc-500">방송 기록 목록은 채널 KPI 타깃 기준으로만 제공합니다.</p>
          )}
          {row.primary && result.airingsTruncated && <p className="mt-1 text-[11px] text-zinc-500">기록이 많아 일부만 표시(평균 계산에는 전부 포함).</p>}
        </Fold>
      )}
    </section>
  );
}

function Fold({ title, children, defaultOpen }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="mt-2 rounded-md border border-zinc-200 bg-white" open={defaultOpen}>
      <summary className="cursor-pointer px-3 py-2 text-[13px] font-medium text-zinc-700">{title}</summary>
      <div className="dense-grid overflow-x-auto border-t border-zinc-100 px-3 py-2">{children}</div>
    </details>
  );
}

function CalcBasis() {
  return (
    <details className="mt-2 text-[12px]">
      <summary className="inline-block cursor-pointer rounded px-2 py-1 text-zinc-600 ring-1 ring-zinc-200 hover:bg-zinc-50">계산 기준</summary>
      <dl className="mt-2 space-y-1.5 rounded-md bg-zinc-50 p-3 text-zinc-700">
        <div>
          <dt className="font-medium">시청률</dt>
          <dd>선택한 기간·방송 구분에서 작품 방영 한 건마다의 시청률을 산술평균(방송시간 가중 아님). 같은 방영이 두 번 적재돼도 한 번만 셉니다.</dd>
        </div>
        <div>
          <dt className="font-medium">점유율</dt>
          <dd>닐슨 방영별 점유율(그 시간 TV를 본 같은 타깃 중 이 채널 비율)을 방영마다 산술평균한 값입니다. 채널의 기간 공식 점유율이나 시청시간 비율과 다르며, 값이 없는 방영은 빼고 셉니다.</dd>
        </div>
        <div>
          <dt className="font-medium">채널 평균</dt>
          <dd>같은 기간 닐슨 채널 하루 시청률의 일평균(채널 KPI 타깃). 방송 구분을 바꿔도 그대로입니다.</dd>
        </div>
        <div>
          <dt className="font-medium">채널 평균 대비</dt>
          <dd>(작품 시청률 ÷ 채널 평균 − 1) × 100. 상대 차이(%)이며 %p 차이가 아닙니다. 채널 평균이 0이거나 없으면 산출 불가.</dd>
        </div>
        <div>
          <dt className="font-medium">본방 구분</dt>
          <dd>원본 자료의 본방 표시 기준이며 현재 ENA만 표시가 있습니다. 표시가 없는 기록은 재방으로 단정하지 않고 ‘본방 여부 미확인’으로 둡니다.</dd>
        </div>
        <div>
          <dt className="font-medium">자료 적음·부족</dt>
          <dd>채널명 옆 (n일)은 집계 방송일이 적다는 표시입니다. 3일 미만은 자료 부족(붉은색), 8일 미만은 자료 적음(주황색) — 콘텐츠 적합도와 같은 기준.</dd>
        </div>
        <div>
          <dt className="font-medium">같은 시간대 대비</dt>
          <dd>표: 같은 채널·기간에서 같은 요일·시간대 다른 프로그램 평균과 비교(표본이 적으면 1배 쪽으로 보정, 콘텐츠 적합도와 같은 기준). 편성 비교의 시간대별 값은 보정 없는 단순 평균 대비라 표 값과 다를 수 있습니다. 같은 요일·시 비교 방송이 15건 미만이면 같은 시(전 요일)로 넓히고, 그래도 부족하면 산출하지 않습니다.</dd>
        </div>
        <div>
          <dt className="font-medium">시청률 흐름</dt>
          <dd>회차별은 본방 표시와 회차 번호가 있는 방영만 씁니다(재방은 넣지 않음). 회차 4개 이상이면 앞 절반·뒤 절반 회차 평균, 2~3개면 첫·최근 회차, 그 외에는 방영이 있는 첫 달·마지막 달의 채널 평균 대비를 비교합니다. 최고·최저는 선택 기간 안의 개별 방영입니다.</dd>
        </div>
        <div>
          <dt className="font-medium">종합 평가</dt>
          <dd>채널 평균 대비와 같은 시간대 대비의 방향을 이은 고정 문구입니다(점수·판정 태그 없음). 같은 유형 평균·순위는 앱 자료로 검증되지 않아 쓰지 않습니다. 최근 12주 편성 진단은 기간이 달라 채널 화면에서 따로 봅니다.</dd>
        </div>
      </dl>
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
  const [targetMode, setTargetMode] = useState<TargetMode>("both");
  const [airing, setAiring] = useState<AiringFilter>("all");
  const [fetched, setFetched] = useState<{ url: string; result: PerformanceResult | null; error: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 최신 자료일은 직전 응답에서 알게 된 값(기간 프리셋 계산용)
  const [latest, setLatest] = useState<string | null>(null);
  // 분석할 채널·타깃 행(채널코드|타깃). 응답에 없으면 진입 채널 → 첫 채널의 KPI 행으로 돌아간다(이전 선택이 남지 않게).
  const [selKey, setSelKey] = useState<string | null>(null);
  // 경쟁 채널 성과는 기록이 있을 때 사용자가 열 때만 보인다
  const [showComp, setShowComp] = useState(false);
  const analysisRef = useRef<HTMLDivElement>(null);

  // 검색·분류 선택은 작품 선택을 풀고 후보 목록만 보여 준다(이전 작품 상세와 새 후보가 섞이지 않게)
  const search = useCallback(
    async (text: string, f: ClassFilter) => {
      setGroup(null);
      setSelKey(null);
      setSearching(true);
      setError(null);
      const next = new URLSearchParams(sp.toString());
      next.delete("group");
      next.delete("q");
      router.replace(`/program-performance${next.size ? `?${next}` : ""}`, { scroll: false });
      try {
        const res = await fetch(`/api/program-performance/search?q=${encodeURIComponent(text)}&class=${f}`);
        const j = await res.json();
        setItems(j.ok ? (j.items as SearchItem[]) : []);
        if (!j.ok) setError(j.message ?? "검색 실패");
      } catch {
        setItems([]);
        setError("검색 중 오류가 났습니다.");
      } finally {
        setSearching(false);
      }
    },
    [router, sp]
  );

  // 첫 진입: 다른 화면에서 이름으로 넘어왔으면 그 이름으로 찾고, 아무것도 없으면 주요 오리지널 작품 목록을 보여 준다
  useEffect(() => {
    if (initialGroup) return;
    let cancelled = false;
    fetch(`/api/program-performance/search?q=${encodeURIComponent(initialQuery)}&class=all`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        const list = j.ok ? (j.items as SearchItem[]) : [];
        // 이름으로 넘어왔고 후보가 하나뿐이면 바로 연다(여럿이면 사용자가 고른다 — 다른 시즌·동명 작품을 임의로 고르지 않음)
        if (initialQuery && list.length === 1) setGroup(list[0].groupKey);
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
  const allRows = result ? result.groups.flatMap((g) => g.rows) : [];
  const excluded = allRows.filter((r) => EXCLUDED.includes(r.status));
  const aired = (r: ChannelRow) => r.status === "OBSERVED" && r.airings > 0;
  // 채널별 묶음(기존 채널 순서) — 방영 기록이 있는 채널만, 채널 KPI 타깃 행 먼저
  const entries: ChannelEntry[] = CHANNELS.map((c) => allRows.filter((r) => r.channelCode === c.code && !EXCLUDED.includes(r.status)))
    .filter((rs) => rs.some(aired))
    .map((rs) => {
      const sorted = [...rs].sort((a, b) => Number(b.primary) - Number(a.primary));
      return { main: sorted.find(aired) ?? sorted[0], rows: sorted };
    });
  const comparable = entries.map((e) => e.main);
  // 분류 안내 문구는 배지를 다는 경우(분류 충돌)에만 — 목록에 없는 작품의 '분류 미확인' 안내는 숨긴다
  const cls = result?.classification;
  const visibleNotes = result ? result.notes.filter((n) => !(cls && n === cls.note && !SHOW_CLASS.includes(cls.cls))) : [];
  const selectable = entries.flatMap((e) => e.rows.filter(aired));
  const selRow = selectable.find((r) => rowKey(r) === selKey) ?? comparable.find((r) => r.channelCode === focusChannel) ?? comparable[0] ?? null;
  const select = (r: ChannelRow) => {
    setSelKey(rowKey(r));
    requestAnimationFrame(() => {
      const el = analysisRef.current;
      // 분석 영역이 화면 밖일 때만 내린다(표와 분석이 함께 보이는 넓은 화면에서는 움직이지 않음)
      if (el && el.getBoundingClientRect().top > window.innerHeight - 120) el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  return (
    <div className="mx-auto w-full min-w-0 max-w-screen-xl px-4 py-5 sm:px-6">
      <h1 className="mb-3 text-[20px] font-bold text-zinc-900">프로그램 성과</h1>

      <section className="rounded-lg border border-zinc-200 bg-white p-3">
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setClassFilter("all");
            void search(q, "all");
          }}
        >
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="작품명(일부·약칭 가능)" aria-label="프로그램 검색" className="min-w-[180px] flex-1 rounded-md border border-zinc-300 px-3 py-1.5 text-[16px] sm:text-[14px]" />
          <button type="submit" className="rounded-md bg-zinc-900 px-3 py-1.5 text-[13px] font-medium text-white">
            검색
          </button>
          <div className="flex flex-wrap gap-1 text-[12px]" role="group" aria-label="오리지널 작품 목록">
            {CLASS_FILTERS.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={classFilter === c.id}
                onClick={() => {
                  setClassFilter(c.id);
                  void search("", c.id);
                }}
                className={`rounded-full px-3 py-1 ring-1 ${classFilter === c.id ? "bg-indigo-600 text-white ring-indigo-600" : "bg-white text-zinc-600 ring-zinc-200 hover:bg-zinc-50"}`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </form>
        {searching && <p className="mt-2 text-[12px] text-zinc-500">찾는 중…</p>}
        {!group && items && !searching && (
          <>
            <p className="mt-2 text-[12px] text-zinc-500">{classFilter === "all" && !q.trim() ? "주요 오리지널 작품(최근 방영 순)" : "검색 결과"}</p>
            <ul className="mt-1.5 flex max-h-56 flex-wrap gap-1.5 overflow-y-auto">
              {items.length === 0 && <li className="text-[12px] text-zinc-500">일치하는 자사 방영 작품이 없습니다.</li>}
              {items.map((it) => (
                <li key={it.groupKey}>
                  <button type="button" onClick={() => setGroup(it.groupKey)} className="flex items-center gap-1.5 rounded-md bg-white px-2.5 py-1 text-left text-[13px] ring-1 ring-zinc-200 hover:bg-zinc-50">
                    <span className="font-medium">{it.displayName}</span>
                    <ClassBadge cls={it.classification} />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {group && (
        <section className="mt-3 space-y-2 text-[12px]">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex flex-wrap items-center gap-1" role="group" aria-label="기간">
              {(
                [
                  ["all", "보유 자료 전체"],
                  ["4w", "최근 4주"],
                  ["12w", "최근 12주"],
                  ["custom", "직접 선택"],
                ] as const
              ).map(([id, label]) => (
                <button key={id} type="button" aria-pressed={preset === id} onClick={() => setPreset(id)} className={chip(preset === id)}>
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
              {result && (
                <span className="ml-1 font-medium tabular-nums text-zinc-800">
                  {result.period.from} ~ {result.period.to}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1" role="group" aria-label="방송 구분">
              {(Object.keys(AIRING_LABEL) as AiringFilter[]).map((a) => (
                <button key={a} type="button" aria-pressed={airing === a} onClick={() => setAiring(a)} className={chip(airing === a)}>
                  {AIRING_LABEL[a]}
                </button>
              ))}
            </div>
            <details className="relative">
              <summary className="cursor-pointer list-none rounded-full px-2.5 py-1 text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-50">
                비교 설정{channels.length || targetMode !== "both" ? " · 변경됨" : ""} ▾
              </summary>
              <div className="absolute left-0 z-20 mt-1 w-56 space-y-2 rounded-md border border-zinc-200 bg-white p-3 shadow-md">
                <fieldset>
                  <legend className="mb-1 font-medium text-zinc-700">채널</legend>
                  <label className="flex items-center gap-2 py-0.5">
                    <input type="checkbox" checked={channels.length === 0} onChange={() => setChannels([])} />
                    전체 채널
                  </label>
                  {CHANNELS.map((c) => (
                    <label key={c.code} className="flex items-center gap-2 py-0.5">
                      <input type="checkbox" checked={channels.includes(c.code)} onChange={() => toggleChannel(c.code)} />
                      {c.label}
                    </label>
                  ))}
                </fieldset>
                <label className="block">
                  <span className="mb-1 block font-medium text-zinc-700">타깃</span>
                  <select value={targetMode} onChange={(e) => setTargetMode(e.target.value as TargetMode)} className="w-full rounded border border-zinc-300 px-1.5 py-0.5 text-[16px] sm:text-[12px]">
                    {(Object.keys(TARGET_LABEL) as TargetMode[]).map((t) => (
                      <option key={t} value={t}>
                        {TARGET_LABEL[t]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </details>
          </div>
          {AIRING_HELP[airing] && <p className="text-zinc-500">{AIRING_HELP[airing]}</p>}
        </section>
      )}

      {(error || fetchError) && <p className="mt-4 rounded-md bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{fetchError ?? error}</p>}
      {loading && <p className="mt-4 text-[13px] text-zinc-500">채널별 성과를 계산하는 중…</p>}

      {result && !loading && (
        <section className="mt-4" aria-live="polite">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h2 className="min-w-0 break-words text-[18px] font-bold text-zinc-900">{result.work.displayName}</h2>
            <ClassBadge cls={result.classification.cls} />
            <span className="text-[13px] text-zinc-500">
              {result.totals.channels}개 채널 · {formatInt(result.totals.airings)}회 방영
            </span>
          </div>
          {visibleNotes.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-[12px] text-amber-800">
              {visibleNotes.map((n, i) => (
                <li key={i}>※ {n}</li>
              ))}
            </ul>
          )}

          {result.lines.length > 0 && (
            <div className="mt-3 space-y-1 text-[14px] leading-relaxed text-zinc-900">
              {result.lines.map((l) => (
                <p key={l.channelCode}>{l.text}</p>
              ))}
            </div>
          )}

          {entries.length > 0 ? (
            <ChannelTable entries={entries} airing={result.query.airing} selected={selRow ? rowKey(selRow) : null} onSelect={select} />
          ) : (
            <p className="mt-4 text-[13px] text-zinc-500">이 조건의 방영 기록이 없습니다.</p>
          )}
          {excluded.length > 0 &&
            (allRows.every((r) => EXCLUDED.includes(r.status)) ? (
              <div className="mt-4 rounded-md bg-zinc-50 px-3 py-2 text-[13px] text-zinc-700">
                {excluded.map((r) => (
                  <p key={r.channelCode}>
                    <span className="font-medium">{r.channelName}</span>: 비교할 수 없음 — {r.statusNote}
                  </p>
                ))}
              </div>
            ) : (
              <details className="mt-2 text-[12px] text-zinc-600">
                <summary className="inline-block cursor-pointer">비교 제외 {excluded.length}개 채널</summary>
                <ul className="mt-1 space-y-0.5 pl-4">
                  {excluded.map((r) => (
                    <li key={r.channelCode}>
                      <span className="font-medium">{r.channelName}</span> — {r.statusNote}
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          {result.competitors.length > 0 && (
            <div className="mt-3">
              <button type="button" aria-expanded={showComp} onClick={() => setShowComp((v) => !v)} className={chip(showComp)}>
                경쟁 채널 성과 {showComp ? "닫기" : `보기 · ${new Set(result.competitors.map((c) => c.competitorName)).size}개 채널`}
              </button>
              {showComp && <CompetitorSection rows={result.competitors} lines={result.competitorLines} />}
            </div>
          )}
          <CalcBasis />

          <div ref={analysisRef} className="scroll-mt-4">
            {selRow && <Analysis key={`${requestUrl}|${rowKey(selRow)}`} row={selRow} result={result} />}
          </div>
        </section>
      )}
    </div>
  );
}
