"use client";

// 프로그램 성과 화면 — 검색·필터·표시만 한다. 모든 수치(평균·배율·증감·표본·상태·월간 추이)는 /api/program-performance가 서버에서 확정해 준 값이다.
// 분석 구조 수정(2026-10-22): 채널별 성과 비교표 → 행(채널·타깃) 선택 → 2×2 분석(시청률 흐름·최고/최저·편성 비교·종합 평가) → 필요할 때 상세(방송 구분별 성과·방송 기록).
//  - 비교표: 시청률(아래 작은 채널 평균)·점유율·채널 평균 대비·같은 시간대 대비. 표본이 적은 채널은 채널명 옆 (n일).
//  - 문구(흐름·최고/최저·시간대·종합)는 서버 고정 템플릿. 최근 12주 편성 진단은 기간이 달라 이 화면에 섞지 않고 채널 화면으로 연결.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { shortProgramName } from "@/lib/programAlias";
import { formatInt, formatPct, formatRatingValue, MISSING } from "@/lib/ui/metricFormat";
import { WORK_CLASS_LABEL, indexOf } from "@/lib/programPerformance/metrics";
import type { AiringFilter, AiringRef, TextPart, ChannelLine, ChannelRow, CompetitorRow, Direction, MonthlyPoint, PerformanceResult, RatioValue, SearchItem, TargetMode, WorkClass } from "@/lib/programPerformance/types";

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
  // 드라마 파랑·예능 초록(사용자 지정 2026-10-22)
  ORIGINAL_DRAMA: "bg-blue-50 text-blue-700 ring-blue-200",
  ORIGINAL_VARIETY: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  OTHER_FEATURED: "bg-zinc-50 text-zinc-700 ring-zinc-200",
  UNCONFIRMED: "bg-white text-zinc-500 ring-zinc-200",
  CONFLICT: "bg-rose-50 text-rose-700 ring-rose-200",
};
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const chip = (on: boolean) => `rounded-full px-2.5 py-1 ring-1 ${on ? "bg-zinc-900 text-white ring-zinc-900" : "bg-white text-zinc-600 ring-zinc-200 hover:bg-zinc-50"}`;

const fmtTime = (t: string | null) => {
  if (!t) return MISSING;
  const h = Number(t.slice(0, 2));
  return `${String(h < 2 ? h + 24 : h).padStart(2, "0")}:${t.slice(3, 5)}`;
};

/** 오리지널 드라마·예능(그리고 관리자 확인이 필요한 분류 충돌)만 배지를 단다 — 목록에 없는 작품은 아무 표시 없음(비오리지널로 단정하지 않음, 사용자 지정 2026-10-22) */
const SHOW_CLASS: WorkClass[] = ["ORIGINAL_DRAMA", "ORIGINAL_VARIETY", "CONFLICT"];

/** 계산 중 돌아가는 아이콘 */
function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin text-indigo-600" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function ClassBadge({ cls }: { cls: WorkClass }) {
  if (!SHOW_CLASS.includes(cls)) return null;
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${CLASS_BADGE[cls]}`}>{WORK_CLASS_LABEL[cls]}</span>;
}

/** 목록 칩용 — 구분 글자 대신 색 점만 두고 이름은 마우스를 올리면 보인다(사용자 지시 2026-10-22: 한 줄에 깔끔하게) */
const CLASS_DOT: Partial<Record<WorkClass, string>> = { ORIGINAL_DRAMA: "bg-blue-500", ORIGINAL_VARIETY: "bg-emerald-500", CONFLICT: "bg-rose-500" };
function ClassDot({ cls }: { cls: WorkClass }) {
  if (!SHOW_CLASS.includes(cls)) return null;
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${CLASS_DOT[cls] ?? "bg-zinc-400"}`} title={WORK_CLASS_LABEL[cls]} role="img" aria-label={WORK_CLASS_LABEL[cls]} />;
}

/** 기준(채널 평균·같은 시간대 평균) 대비 — 기준을 100으로 본 지수 %(서버 배율 × 100 반올림, 표시 형식만). 100 초과 푸른색·미만 붉은색(사용자 지정 2026-10-22) */
function DeltaText({ r }: { r: RatioValue }) {
  const i = indexOf(r.ratio);
  if (i === null) return <span className="text-zinc-400">산출 불가</span>;
  const label = `기준의 ${i}%${DIR_WORD[r.direction] ? `(${DIR_WORD[r.direction]})` : ""}`;
  return (
    <span className={`font-semibold tabular-nums ${DIR_CLASS[r.direction]}`} aria-label={label}>
      {i}%
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

const TARGET_ORDER = ["수도권 2049", "전국 유료가구"];
const sampleNote = (s: "OK" | "SMALL" | "NONE", days: number) => (s === "OK" ? "" : `, 실적 ${days}일, 표본 부족${s === "NONE" ? "·판단 보류" : ""}`);

const SOURCE_LABEL: Record<"registered" | "naver", string> = { registered: "관리자 등록(주요 콘텐츠 관리)", naver: "네이버 방송 정보" };

/**
 * 초방 편성 한 줄 — 관리자 등록·네이버 방송 정보로 알아낸 원 방송사 첫 방송(초방) 요일·시각을 닐슨 방영으로 맞춘 실제 시작 시각으로 보여 준다(예: "ENA 수 22:30").
 * 용어(사용자 정의 2026-10-23): 본방 = 각 채널에서의 첫 방송, 초방 = 본방 중 원 방송사의 첫 방송. 이 패턴의 채널은 원 방송사라 "초방"이다.
 * 근거와 패턴 시각은 마우스를 올리면 보인다. 확인된 방영이 없는 슬롯은 나오지 않는다.
 */
function PatternLine({ pattern, result }: { pattern: NonNullable<PerformanceResult["pattern"]>; result: PerformanceResult }) {
  if (pattern.slots.length === 0) return null;
  const nameOf = (code: string) => result.groups.flatMap((g) => g.rows).find((r) => r.channelCode === code)?.channelName ?? code.replace(/_/g, " ");
  const fetched = pattern.naverFetchedAt ? ` · 네이버 확인 ${pattern.naverFetchedAt.slice(0, 10)}` : "";
  return (
    <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-[13px] text-zinc-700">
      <span className="font-bold text-zinc-900">초방 편성</span>
      {pattern.slots.map((s) => (
        <span key={`${s.channelCode}|${s.days}|${s.actual}`} className="cursor-help underline decoration-zinc-300 decoration-dotted underline-offset-2" title={`${s.sources.map((x) => SOURCE_LABEL[x]).join(" · ")}에서 ${s.days} ${s.nominal}로 확인 → 닐슨 방영 ${s.observed}회로 맞춘 실제 시작 ${s.actual}${s.sources.includes("naver") ? `(${s.label})` : ""}${fetched}`}>
          {nameOf(s.channelCode)} {s.days} {s.actual}
        </span>
      ))}
    </p>
  );
}

/**
 * 채널당 한 줄(사용자 지정 형식) — "ENA Drama: 0.001(2049, 5%)·0.013(가구, 16%)로 채널 평균 대비 각각 95%·84% 낮음 (13회, 실적 5일, 표본 부족)".
 * 괄호 안 %는 채널 평균=100 지수(서버 값), 100 초과 푸른색·미만 붉은색.
 */
function LineList({ lines, className = "" }: { lines: ChannelLine[]; className?: string }) {
  return (
    <div className={`space-y-1 text-[14px] leading-relaxed text-zinc-900 ${className}`}>
      {lines.map((l) => (
        <p key={l.channelCode} aria-label={l.text}>
          <span className="font-semibold">{l.name}</span>:{" "}
          {l.pieces.map((p, i) => (
            <span key={p.target}>
              {i > 0 && "·"}
              <span className="tabular-nums">{formatRatingValue(p.value, l.channelCode)}</span>({p.target}, <span className={`font-semibold tabular-nums ${DIR_CLASS[p.direction]}`}>{p.index === null ? "산출 불가" : `${p.index}%`}</span>)
            </span>
          ))}
          로 채널 평균 대비 <span className={`font-medium ${DIR_CLASS[l.direction]}`}>{l.summary}</span>{" "}
          <span className={`text-[13px] ${l.sampleState === "OK" ? "text-zinc-500" : "text-amber-700"}`}>
            ({l.airings}회{sampleNote(l.sampleState, l.days)})
          </span>
        </p>
      ))}
    </div>
  );
}

/** 표의 타깃 한 칸 — 시청률 + 채널 평균 지수(%), 아래 작은 글씨로 채널 평균·점유율 */
function TargetCell({ r, code, kpi, airing }: { r: ChannelRow | CompetitorRow | undefined; code: string; kpi?: boolean; airing: AiringFilter }) {
  if (!r) return <span className="text-zinc-300">{MISSING}</span>;
  const observed = "status" in r ? r.status === "OBSERVED" && r.airings > 0 : r.airings > 0;
  if (!observed) return <span className="text-[12px] text-zinc-400">{"status" in r ? emptyText(r, airing) : "방영 없음"}</span>;
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-end gap-x-1.5">
        <span className={`tabular-nums ${kpi ? "font-semibold text-zinc-900" : "text-zinc-800"}`}>{formatRatingValue(r.programAvg, code)}</span>
        <DeltaText r={r.vsChannel} />
      </div>
      <div className="text-[11px] tabular-nums text-zinc-400">
        {kpi && <span className="mr-1 rounded bg-zinc-100 px-1 text-[10px] text-zinc-600">KPI</span>}
        채널 {formatRatingValue(r.channelDaily?.mean ?? null, code)}
        <span className="hidden sm:inline"> · 점유 {r.shareAvg === null ? "없음" : formatPct(r.shareAvg)}</span>
      </div>
    </div>
  );
}

/**
 * 채널별 성과 — 채널당 한 줄: 방영 횟수, 수도권 2049·전국 유료가구 각각의 시청률과 채널 평균 지수(%), 같은 시간대 대비(KPI 타깃).
 * 행을 누르면 아래 분석이 그 채널(KPI 타깃)로 바뀐다. 순서는 기존 채널 순서.
 */
function ChannelTable({ entries, airing, selected, onSelect }: { entries: ChannelEntry[]; airing: AiringFilter; selected: string | null; onSelect: (r: ChannelRow) => void }) {
  const cols = TARGET_ORDER.filter((t) => entries.some((e) => e.rows.some((r) => r.targetLabel === t)));
  return (
    <section className="mt-3">
      <div className="dense-grid overflow-x-auto rounded-lg border border-zinc-200 bg-white" tabIndex={0} role="region" aria-label="채널별 성과 비교 표">
        <table className="w-full text-[14px]">
          <thead className="break-keep bg-zinc-50 text-[12px] text-zinc-500">
            <tr>
              <th className="px-1.5 py-2 text-left font-medium sm:px-3">채널</th>
              <th className="px-1.5 py-2 text-right font-medium sm:px-3">방영</th>
              {cols.map((c) => (
                <th key={c} className="px-1.5 py-2 text-right font-medium sm:px-3">
                  <TargetName label={c} />
                </th>
              ))}
              <th className="px-1.5 py-2 text-right font-medium sm:px-3">
                같은 시간대<span className="hidden sm:inline">(KPI)</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map(({ main, rows }) => {
              const code = main.channelCode;
              const isSel = selected?.startsWith(`${code}|`) ?? false;
              const sample = sampleText(main);
              return (
                <tr key={code} onClick={() => onSelect(main)} className={`cursor-pointer border-t border-zinc-100 align-top ${isSel ? "bg-sky-50" : "hover:bg-zinc-50"}`}>
                  <td className="px-1.5 py-2 sm:px-3">
                    <button type="button" onClick={(e) => (e.stopPropagation(), onSelect(main))} aria-pressed={isSel} className="text-left font-medium text-zinc-900 underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-600" aria-label={`${main.channelName} 분석 보기`}>
                      {main.channelName}
                    </button>
                  </td>
                  <td className="px-1.5 py-2 text-right sm:px-3">
                    <span className="whitespace-nowrap tabular-nums">{formatInt(main.airings)}회</span>
                    <div className={`text-[11px] tabular-nums ${sample ? (main.sampleState === "NONE" ? "text-rose-700" : "text-amber-700") : "text-zinc-400"}`} title={sample ?? undefined}>
                      {main.days}일{sample ? " · 표본 부족" : ""}
                    </div>
                  </td>
                  {cols.map((c) => {
                    const r = rows.find((x) => x.targetLabel === c);
                    return (
                      <td key={c} className="px-1.5 py-2 text-right sm:px-3">
                        <TargetCell r={r} code={code} kpi={r?.primary && rows.length > 1} airing={airing} />
                      </td>
                    );
                  })}
                  <td className="px-1.5 py-2 text-right sm:px-3">{main.slot && main.slot.airingsUsed > 0 ? <DeltaText r={main.slot.ratio} /> : <span className="text-zinc-300">{MISSING}</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[11px] text-zinc-500">%는 채널 평균(같은 시간대 열은 같은 시간대 평균)을 100으로 본 시청률 지수입니다. 100 초과 푸른색, 미만 붉은색. 행을 누르면 아래 분석이 바뀝니다.</p>
    </section>
  );
}

/** 경쟁 채널 성과 — 선택해서 연다. 같은 작품이 등록 경쟁채널에서 방영된 기록만(닐슨 경쟁채널 시트), 채널 평균은 그 경쟁채널의 하루 시청률 일평균 */
function CompetitorSection({ rows, lines }: { rows: CompetitorRow[]; lines: ChannelLine[] }) {
  const names = [...new Set(rows.map((r) => r.competitorName))];
  return (
    <section className="mt-2 rounded-lg border border-zinc-200 bg-zinc-50/50 p-3">
      <LineList lines={lines} className="text-[13px]" />
      <div className="dense-grid mt-2 overflow-x-auto rounded-md border border-zinc-200 bg-white" tabIndex={0} role="region" aria-label="경쟁 채널 성과 표">
        <table className="w-full text-[14px]">
          <thead className="break-keep bg-zinc-50 text-[12px] text-zinc-500">
            <tr>
              <th className="px-1.5 py-2 text-left font-medium sm:px-3">경쟁 채널</th>
              <th className="px-1.5 py-2 text-right font-medium sm:px-3">방영</th>
              {TARGET_ORDER.map((c) => (
                <th key={c} className="px-1.5 py-2 text-right font-medium sm:px-3">
                  <TargetName label={c} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {names.map((name) => {
              const rs = rows.filter((r) => r.competitorName === name);
              const main = rs.reduce((a, b) => (b.airings > a.airings ? b : a));
              const small = main.sampleState !== "OK";
              return (
                <tr key={name} className="border-t border-zinc-100 align-top">
                  <td className="px-1.5 py-2 font-medium text-zinc-900 sm:px-3">{name}</td>
                  <td className="px-1.5 py-2 text-right sm:px-3">
                    <span className="whitespace-nowrap tabular-nums">{main.airings}회</span>
                    <div className={`text-[11px] ${small ? "text-amber-700" : "text-zinc-400"}`}>
                      {main.days}일{main.rerunAirings ? ` · 재방 ${main.rerunAirings}` : ""}
                      {small ? " · 표본 부족" : ""}
                    </div>
                  </td>
                  {TARGET_ORDER.map((c) => (
                    <td key={c} className="px-1.5 py-2 text-right sm:px-3">
                      <TargetCell r={rs.find((x) => x.targetLabel === c)} code={name} airing="all" />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[11px] text-zinc-500">닐슨 일일 파일의 경쟁채널 시트(등록 경쟁채널만)에 같은 작품 이름으로 잡힌 방영입니다. 채널 평균은 그 경쟁채널의 하루 시청률 일평균(자사와 같은 정의). 같은 시간대 비교는 경쟁 채널 편성 전체가 없어 내지 않습니다.</p>
    </section>
  );
}

const monthTitle = (m: MonthlyPoint) => `${Number(m.month.slice(5))}월${m.partial ? ` ${Number(m.from.slice(8))}~${Number(m.to.slice(8))}일` : ""}`;
const shortDate = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}(${DOW[new Date(`${d}T00:00:00Z`).getUTCDay()]})`;
const slotName = (dow: number, hb: number) => `${DOW[dow]} ${hb}시대`;

/** 서버가 만든 문장 조각 — 방향이 있는 숫자는 높음 푸른색·낮음 붉은색(사용자 지정 2026-10-22) */
function Parts({ parts }: { parts: TextPart[] }) {
  return (
    <>
      {parts.map((p, i) => (p.d ? (
        <span key={i} className={`font-bold tabular-nums ${DIR_CLASS[p.d]}`}>
          {p.t}
        </span>
      ) : (
        <span key={i}>{p.t}</span>
      )))}
    </>
  );
}

function Card({ title, lead, children }: { title: string; lead?: ReactNode; children?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-zinc-200 bg-white p-4">
      <h4 className="text-[12px] font-medium text-zinc-500">{title}</h4>
      {lead && <p className="mt-0.5 text-[14px] font-semibold leading-snug text-zinc-900">{lead}</p>}
      {children && <div className={lead ? "mt-2" : "mt-1"}>{children}</div>}
    </div>
  );
}

/** 눈금 간격 — 1·2·2.5·5 × 10^k 중 4칸 안팎(표시용) */
function niceStep(max: number): number {
  const raw = max / 4 || 0.1;
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? raw;
}

/**
 * 시청률 흐름 그래프(지구마불 세계여행 화면 참고) — 서버가 낸 점 값을 찍기만 한다. 가로축은 본방 방영(회차 번호가 있으면 'n회', 없으면 방영일)
 * 또는 월. 점선은 채널 평균(월별은 같은 달 채널 평균). 값이 없는 점은 끊는다(0으로 잇지 않음). 점에 마우스를 올리면 값.
 */
function TrendChart({ points, base, baseLabel, code }: { points: { label: string; sub: string; value: number | null }[]; base: (number | null)[]; baseLabel: string; code: string }) {
  const W = 800;
  const H = 240;
  const L = 44;
  const R = 12;
  const T = 14;
  const B = 34;
  const vals = [...points.map((p) => p.value), ...base].filter((v): v is number => v !== null);
  if (vals.length === 0) return <p className="py-6 text-center text-[13px] text-zinc-500">그래프로 볼 값이 없습니다.</p>;
  const step = niceStep(Math.max(...vals));
  const top = Math.ceil(Math.max(...vals) / step) * step || step;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const x = (i: number) => (points.length === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (points.length - 1));
  const y = (v: number) => T + (1 - v / top) * (H - T - B);
  const seg = (arr: (number | null)[]) => {
    const out: string[] = [];
    let cur = "";
    arr.forEach((v, i) => {
      if (v === null) {
        if (cur) out.push(cur);
        cur = "";
      } else cur += `${cur ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    });
    if (cur) out.push(cur);
    return out;
  };
  const vs = points.map((p) => p.value);
  const lines = seg(vs);
  const every = Math.max(1, Math.ceil(points.length / 12));
  const tickDigits = step < 0.01 ? 3 : step < 0.1 ? 2 : 1;
  const baseFlat = base.every((b) => b === base[0]);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={points.map((p) => `${p.label} ${formatRatingValue(p.value, code)}`).join(", ")}>
      <defs>
        <linearGradient id="pp-area" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#6366f1" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#6366f1" stopOpacity="0.03" />
        </linearGradient>
      </defs>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#e4e4e7" strokeWidth={1} />
          <text x={L - 6} y={y(t) + 4} fontSize={11} fill="#71717a" textAnchor="end">
            {t.toFixed(tickDigits)}
          </text>
        </g>
      ))}
      {lines.map((d, i) => {
        const nums = d.match(/[-\d.]+/g)!.map(Number);
        const x0 = nums[0];
        const x1 = nums[nums.length - 2];
        return <path key={`a${i}`} d={`${d}L${x1},${y(0)}L${x0},${y(0)}Z`} fill="url(#pp-area)" stroke="none" />;
      })}
      {base.some((b) => b !== null) &&
        (baseFlat ? (
          <g>
            <line x1={L} x2={W - R} y1={y(base[0] as number)} y2={y(base[0] as number)} stroke="#a1a1aa" strokeWidth={1.4} strokeDasharray="5 4" />
            <text x={W - R} y={y(base[0] as number) - 5} fontSize={11} fill="#71717a" textAnchor="end">
              {baseLabel} {formatRatingValue(base[0], code)}
            </text>
          </g>
        ) : (
          seg(base).map((d, i) => <path key={`b${i}`} d={d} fill="none" stroke="#a1a1aa" strokeWidth={1.4} strokeDasharray="5 4" />)
        ))}
      {lines.map((d, i) => (
        <path key={`l${i}`} d={d} fill="none" stroke="#4f46e5" strokeWidth={2.4} strokeLinejoin="round" />
      ))}
      {points.map((p, i) =>
        p.value === null ? null : (
          <circle key={`c${i}`} cx={x(i)} cy={y(p.value)} r={points.length > 40 ? 2 : 3.5} fill="#fff" stroke="#4f46e5" strokeWidth={2}>
            <title>{`${p.label}${p.sub ? ` · ${p.sub}` : ""} — ${formatRatingValue(p.value, code, { unit: true })}`}</title>
          </circle>
        )
      )}
      {points.map((p, i) =>
        i % every === 0 || i === points.length - 1 ? (
          <text key={`x${i}`} x={x(i)} y={H - 12} fontSize={11} fill="#71717a" textAnchor={points.length === 1 ? "middle" : i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}>
            {p.label}
          </text>
        ) : null
      )}
    </svg>
  );
}

/** 시청률 흐름 — 본방별(기본, 본방 2회 이상일 때)·일별 전환, 큰 그래프 + 핵심 숫자 4칸(평균·최고·최저·최근 방영) */
function TrendSection({ row }: { row: ChannelRow }) {
  const a = row.analysis!;
  const code = row.channelCode;
  const hasFirst = a.firstRuns.length >= 2;
  // 사용자 지시(2026-10-23): 월별 대신 일별 — 방영이 있는 방송일마다 그날 작품 평균과 그날 채널 하루 시청률
  const [unit, setUnit] = useState<"first" | "day">(hasFirst ? "first" : "day");
  const epLabel = (r: AiringRef) => (r.episode !== null ? `${r.episode}회` : `${Number(r.date.slice(5, 7))}/${Number(r.date.slice(8))}`);
  const points =
    unit === "first" && hasFirst
      ? a.firstRuns.map((r) => ({ label: epLabel(r), sub: `${shortDate(r.date)} ${fmtTime(r.startTime)}`, value: r.rating }))
      : row.daily.map((d) => ({ label: `${Number(d.date.slice(5, 7))}/${Number(d.date.slice(8))}`, sub: `${d.airings}회`, value: d.programAvg }));
  const base = unit === "first" && hasFirst ? points.map(() => a.channelAvg) : row.daily.map((d) => d.channelAvg);
  const x = a.extremes;
  const stat = (k: string, v: number | null, sub: ReactNode, extra?: ReactNode) => (
    <div className="min-w-0 rounded-xl border border-zinc-200 bg-white p-3">
      <div className="text-[12px] text-zinc-500">{k}</div>
      <div className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5">
        <span className="text-[22px] font-bold tabular-nums text-zinc-900">{formatRatingValue(v, code)}</span>
        <span className="text-[12px] text-zinc-400">%</span>
        {extra}
      </div>
      <div className="mt-0.5 text-[11px] text-zinc-500">{sub}</div>
    </div>
  );
  const refSub = (r: AiringRef) => `${r.episode !== null ? `${r.episode}회 · ` : ""}${shortDate(r.date)} ${fmtTime(r.startTime)}${r.firstRun === true ? " · 본방" : ""}`;
  return (
    <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(250px,310px)]">
      <div className="min-w-0 rounded-xl border border-zinc-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h4 className="text-[12px] font-medium text-zinc-500">시청률 흐름</h4>
            <p className="text-[15px] font-semibold leading-snug text-zinc-900">{a.trendText}</p>
          </div>
          <div className="flex items-center gap-1 text-[12px]" role="group" aria-label="그래프 단위">
            {hasFirst && (
              <button type="button" aria-pressed={unit === "first"} onClick={() => setUnit("first")} className={chip(unit === "first")}>
                본방별
              </button>
            )}
            <button type="button" aria-pressed={unit === "day"} onClick={() => setUnit("day")} className={chip(unit === "day")}>
              일별
            </button>
          </div>
        </div>
        <div className="mt-2">
          <TrendChart points={points} base={base} baseLabel="채널 평균" code={code} />
        </div>
        <p className="text-[11px] text-zinc-500">
          {unit === "first" && hasFirst ? `본방 ${a.firstRuns.length}회(회차 번호가 없으면 방영일 표기)` : "일별 방영 평균(방영이 있는 날만)"} · 점선은 {unit === "first" && hasFirst ? "같은 기간" : "그날"} 채널 평균 · 점에 마우스를 올리면 값
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-1 lg:content-between">
        {stat("평균", row.programAvg, `${formatInt(row.airings)}회 · 채널 평균 ${formatRatingValue(row.channelDaily?.mean ?? null, code)}`, <DeltaText r={row.vsChannel} />)}
        {x ? stat("최고", x.best.rating, refSub(x.best)) : stat("최고", null, "방영 1건")}
        {x ? stat("최저", x.worst.rating, refSub(x.worst)) : stat("최저", null, "방영 1건")}
        {x ? stat("최근 방영", x.recent.rating, `${refSub(x.recent)} · ${a.extremesText}`) : stat("최근 방영", null, a.extremesText)}
      </div>
    </div>
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
    <Card title="편성 비교" lead={a.slotParts ? <Parts parts={a.slotParts} /> : a.slotText}>
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
    <Card title="종합 평가" lead={a.insights.length > 0 ? undefined : a.verdict}>
      {/* 평균 카드·편성 비교에 이미 보이는 내용은 빼고, 그 둘로는 안 보이는 관계(본방 대비 재방 효율 등)만 보여 준다(사용자 지시 2026-10-22) */}
      {a.insights.length > 0 && (
        <ul className="space-y-1 text-[14px] font-medium leading-snug text-zinc-900">
          {a.insights.map((parts, i) => (
            <li key={i}>
              · <Parts parts={parts} />
            </li>
          ))}
        </ul>
      )}
      {a.insights.length === 0 && a.reasons.length > 0 && (
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
function Analysis({ row, result, siblings, onSelect }: { row: ChannelRow; result: PerformanceResult; siblings: ChannelRow[]; onSelect: (r: ChannelRow) => void }) {
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
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-[12px] font-semibold text-indigo-700">{row.channelName}</span>
        <h3 className="text-[16px] font-bold text-zinc-900">{shortProgramName(result.work.displayName)}</h3>
        {siblings.length > 1 && (
          <div className="ml-auto flex gap-1 text-[12px]" role="group" aria-label="분석 타깃">
            {siblings.map((s) => (
              <button key={s.targetLabel} type="button" aria-pressed={s.targetLabel === row.targetLabel} onClick={() => onSelect(s)} className={chip(s.targetLabel === row.targetLabel)}>
                {s.targetLabel}
                {s.primary ? " · KPI" : ""}
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="text-[12px] text-zinc-500">
        {row.observedFrom} ~ {row.observedTo} 중 {formatInt(row.airings)}회 · 방송일 {row.days}일{row.episodes ? ` · 회차 ${row.episodes}개` : ""}
        {cd && cd.validDays < cd.periodDays ? ` · 채널 평균 자료 ${cd.validDays}/${cd.periodDays}일` : ""}
      </p>
      {!row.analysis ? (
        <p className="mt-2 text-[13px] text-zinc-600">{row.statusNote || "이 조건의 방영 기록이 없습니다."}</p>
      ) : (
        <div className="mt-2">
          <TrendSection key={`t-${code}-${row.targetLabel}`} row={row} />
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            <SlotCard key={`s-${code}-${row.targetLabel}`} row={row} />
            <VerdictCard row={row} />
          </div>
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
  // 기본 기간은 최근 4주(사용자 지정 2026-10-22). 다른 화면에서 기간을 넘겨받으면 그 기간.
  const [preset, setPreset] = useState<PeriodPreset>(initialFrom || initialTo ? "custom" : "4w");
  const [from, setFrom] = useState<string | null>(initialFrom);
  const [to, setTo] = useState<string | null>(initialTo);
  const [channels, setChannels] = useState<string[]>([]); // 비면 전체
  const [targetMode, setTargetMode] = useState<TargetMode>("both");
  const [airing, setAiring] = useState<AiringFilter>("all");
  const [fetched, setFetched] = useState<{ url: string; result: PerformanceResult | null; error: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  // 최근 4주·12주는 서버가 최신 자료일 기준으로 정한다(첫 조회부터 같은 기간, 화면이 날짜를 계산하지 않음)
  const requestUrl = useMemo(() => {
    if (!group) return null;
    const params = new URLSearchParams({ group, airing, target: targetMode });
    if (preset === "4w" || preset === "12w") params.set("preset", preset);
    if (preset === "custom") {
      if (from) params.set("from", from);
      if (to) params.set("to", to);
    }
    if (channels.length) params.set("channels", channels.join(","));
    return `/api/program-performance?${params}`;
  }, [group, airing, targetMode, preset, from, to, channels]);
  const loading = requestUrl !== null && fetched?.url !== requestUrl;
  // 조건을 바꿔 다시 계산하는 동안에는 같은 작품의 직전 결과를 흐리게 그대로 둔다(화면이 비어 검색 단계로 돌아간 것처럼 보이지 않게)
  const current = fetched && fetched.url === requestUrl ? fetched.result : null;
  const stale = !current && loading && fetched?.result && fetched.result.work.groupKey === group ? fetched.result : null;
  const result = current ?? stale;
  const fetchError = fetched && fetched.url === requestUrl ? fetched.error : null;

  useEffect(() => {
    if (!requestUrl || !group) return;
    let cancelled = false;
    fetch(requestUrl)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        setFetched({ url: requestUrl, result: j.ok ? (j.result as PerformanceResult) : null, error: j.ok ? null : (j.message ?? "조회 실패") });
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
            {/* 한 줄 정리(사용자 지시 2026-10-22): 안내 문구는 짧은 앞 라벨 하나로(자세한 설명은 마우스 오버), 작품 구분은 색 점으로(이름은 마우스 오버), 넘치면 옆으로 넘긴다 */}
            <div className="mt-2 flex items-center gap-2">
              {/* 사용자 지시(2026-10-23): 기본 목록의 "최근 2주 방영" 라벨은 삭제 — 검색 중일 때만 "검색 결과" 표시 */}
              {!(classFilter === "all" && !q.trim()) && <span className="shrink-0 text-[12px] text-zinc-500">검색 결과</span>}
              <ul className="flex min-w-0 flex-nowrap gap-1.5 overflow-x-auto pb-1" aria-label="작품 목록" title={classFilter === "all" && !q.trim() ? "ENA에서 최근 2주 안에 방영한 오리지널(최근 방영 순)" : undefined}>
                {items.length === 0 && <li className="text-[12px] text-zinc-500">일치하는 작품이 없습니다.</li>}
                {items.map((it) => (
                  <li key={it.groupKey} className="shrink-0">
                    <button type="button" title={SHOW_CLASS.includes(it.classification) ? WORK_CLASS_LABEL[it.classification] : undefined} onClick={() => setGroup(it.groupKey)} className="flex items-center gap-1.5 whitespace-nowrap rounded-md bg-white px-2.5 py-1 text-left text-[13px] ring-1 ring-zinc-200 hover:bg-zinc-50">
                      <span className="font-medium">{shortProgramName(it.displayName)}</span>
                      <ClassDot cls={it.classification} />
                      {it.ownChannels.length === 0 && <span className="rounded bg-zinc-100 px-1 text-[10px] font-medium leading-4 text-zinc-500" title={`자사 방영 없음 — 경쟁채널 자료(${(it.compChannels ?? []).join(", ")})`}>타사</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </section>

      {group && (
        <section className="mt-3 space-y-2 text-[12px]">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex flex-wrap items-center gap-1" role="group" aria-label="기간">
              {(
                [
                  ["4w", "최근 4주"],
                  ["12w", "최근 12주"],
                  ["all", "전체 기간"],
                  ["custom", "기간 선택"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={preset === id}
                  onClick={() => {
                    // 기간 선택은 지금 보고 있는 기간에서 시작
                    if (id === "custom" && result && !from && !to) {
                      setFrom(result.period.from);
                      setTo(result.period.to);
                    }
                    setPreset(id);
                  }}
                  className={chip(preset === id)}
                >
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
      {loading && (
        <p className="mt-4 flex items-center gap-2 text-[13px] text-zinc-600" role="status">
          <Spinner />
          채널별 성과를 계산하는 중…{stale ? " (아래는 직전 조건의 결과)" : ""}
        </p>
      )}

      {result && (
        <section className={`mt-4 transition-opacity ${stale ? "pointer-events-none opacity-40" : ""}`} aria-live="polite" aria-busy={loading}>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h2 className="min-w-0 break-words text-[18px] font-bold text-zinc-900">{shortProgramName(result.work.displayName)}</h2>
            <ClassBadge cls={result.classification.cls} />
            <span className="text-[13px] text-zinc-500">
              {result.totals.channels}개 채널 · {formatInt(result.totals.airings)}회 방영
            </span>
          </div>
          {result.pattern && <PatternLine pattern={result.pattern} result={result} />}
          {visibleNotes.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-[12px] text-amber-800">
              {visibleNotes.map((n, i) => (
                <li key={i}>※ {n}</li>
              ))}
            </ul>
          )}

          {result.lines.length > 0 && <LineList lines={result.lines} className="mt-3" />}

          {entries.length > 0 ? (
            <ChannelTable entries={entries} airing={result.query.airing} selected={selRow ? rowKey(selRow) : null} onSelect={select} />
          ) : (
            <p className="mt-4 text-[13px] text-zinc-500">{result.competitors.length > 0 ? "자사 방영 기록은 없습니다. 아래 경쟁 채널 성과를 확인하세요." : "이 조건의 방영 기록이 없습니다."}</p>
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
              {/* 자사 방영이 없는 작품은 경쟁 채널 성과가 유일한 내용이라 처음부터 펼쳐 둔다(사용자 지시 2026-10-23) */}
              {entries.length > 0 && (
                <button type="button" aria-expanded={showComp} onClick={() => setShowComp((v) => !v)} className={chip(showComp)}>
                  경쟁 채널 성과 {showComp ? "닫기" : `보기 · ${new Set(result.competitors.map((c) => c.competitorName)).size}개 채널`}
                </button>
              )}
              {(showComp || entries.length === 0) && <CompetitorSection rows={result.competitors} lines={result.competitorLines} />}
            </div>
          )}
          <CalcBasis />

          <div ref={analysisRef} className="scroll-mt-4">
            {selRow && <Analysis key={`${requestUrl}|${rowKey(selRow)}`} row={selRow} result={result} siblings={selectable.filter((r) => r.channelCode === selRow.channelCode)} onSelect={(r) => setSelKey(rowKey(r))} />}
          </div>
        </section>
      )}
    </div>
  );
}
