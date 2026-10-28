"use client";

// 프로그램 성과 화면 — 검색·필터·표시만 한다. 모든 수치(평균·배율·증감·표본·상태·월간 추이)는 /api/program-performance가 서버에서 확정해 준 값이다.
// 성과 중심 개편(2026-10-23, docs/ena-features/F1_OUTCOME_REDESIGN_PLAN.md): 검색·필터 → 채널별 성과표(채널·수2049·가구·방영횟수, 채널당 한 줄) → 선택 채널 종합평가(최근 12주 편성진단 근거)
//  → [시청률 흐름+최고·최저·최근 | 편성 비교] → 접힌 방송 기록 → 계산 기준. 문구는 모두 서버 고정 템플릿, 표본 경고·보완 건수 배너·요약문·평균 카드는 기본 화면에서 뺐다.
//  - 검색·기간 흐름 정리(2026-10-23): 화면 상태는 주소 하나(새로고침·공유·뒤로 가기), 검색은 자동완성 목록, 직접 기간은 [적용]을 눌러야 조회.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { shortProgramName } from "@/lib/programAlias";
import { formatInt, formatPct, formatRatingValue, MISSING } from "@/lib/ui/metricFormat";
import { WORK_CLASS_LABEL, indexOf } from "@/lib/programPerformance/metrics";
import type { AiringFilter, AiringRef, Assessment, OriginalCompare, ChannelRow, CompetitorRow, Direction, OverallReview, PerformanceResult, RatioValue, SearchItem, SupplementCount, TargetMode, WorkClass } from "@/lib/programPerformance/types";

type ClassFilter = "all" | "drama" | "variety" | "culture";
type PeriodPreset = "all" | "4w" | "12w" | "custom";

const CLASS_FILTERS: { id: Exclude<ClassFilter, "all">; label: string }[] = [
  { id: "drama", label: "오리지널 드라마" },
  { id: "variety", label: "오리지널 예능" },
  { id: "culture", label: "오리지널 교양" },
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
// 채널 평균보다 좋으면 푸른색, 나쁘면 붉은색(사용자 지정, 2026-10-22) — 부호(+/−)와 함께 써 색만으로 전달하지 않는다
const DIR_CLASS: Record<Direction, string> = { HIGHER: "text-blue-700", SIMILAR: "text-zinc-700", LOWER: "text-rose-700", NA: "text-zinc-400" };
const EXCLUDED: ChannelRow["status"][] = ["UNSUPPORTED", "NO_TARGET"];
const CLASS_BADGE: Record<WorkClass, string> = {
  // 드라마 파랑·예능 초록(사용자 지정 2026-10-22)
  ORIGINAL_DRAMA: "bg-blue-50 text-blue-700 ring-blue-200",
  ORIGINAL_VARIETY: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  ORIGINAL_CULTURE: "bg-amber-50 text-amber-700 ring-amber-200",
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
const SHOW_CLASS: WorkClass[] = ["ORIGINAL_DRAMA", "ORIGINAL_VARIETY", "ORIGINAL_CULTURE", "CONFLICT"];

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
const CLASS_DOT: Partial<Record<WorkClass, string>> = { ORIGINAL_DRAMA: "bg-blue-500", ORIGINAL_VARIETY: "bg-emerald-500", ORIGINAL_CULTURE: "bg-amber-500", CONFLICT: "bg-rose-500" };
function ClassDot({ cls }: { cls: WorkClass }) {
  if (!SHOW_CLASS.includes(cls)) return null;
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${CLASS_DOT[cls] ?? "bg-zinc-400"}`} title={WORK_CLASS_LABEL[cls]} role="img" aria-label={WORK_CLASS_LABEL[cls]} />;
}

/**
 * 기준(채널 평균·같은 시간대 평균) = 100%로 본 비율 — "95%"(붉은색)·"120%"(푸른색). 사용자 지시(2026-10-23): 부호 대신 100% 기준 비율로.
 * 서버 배율 × 100 반올림(indexOf)이고 방향은 서버 값(배율 소수 둘째 자리) 그대로. 폭을 고정해 행마다 자리가 맞게.
 */
function IdxText({ r, paren = false }: { r: RatioValue; paren?: boolean }) {
  const i = indexOf(r.ratio);
  return (
    <span className={`inline-block min-w-[3.6rem] text-right tabular-nums ${i === null ? "text-zinc-400" : DIR_CLASS[r.direction]}`} aria-label={i === null ? "기준 대비 산출 불가" : `기준의 ${i}%`}>
      {i === null ? MISSING : paren ? `(${i}%)` : `${i}%`}
    </span>
  );
}

function emptyText(r: ChannelRow, airing: AiringFilter): string {
  if (r.status === "NO_PROGRAM_DATA" || r.status === "NO_TARGET") return "자료 없음";
  if (r.status === "OBSERVED") return airing === "first" ? "본방 없음" : airing === "rerun" ? "본방 외 방영 없음" : "실적 없음";
  return "실적 없음";
}

/** 채널 하나 = 방영 기록이 있는 채널. rows는 그 채널의 타깃별 행(KPI 타깃 먼저). */
interface ChannelEntry {
  main: ChannelRow;
  rows: ChannelRow[];
}

const rowKey = (r: ChannelRow) => `${r.channelCode}|${r.targetLabel}`;

const TARGET_ORDER = ["수도권 2049", "전국 유료가구"];
/** 표 열 이름 — 수2049 = 수도권 개인 2049, 가구 = 전국 유료가구(정식 명칭은 계산 기준) */
const targetShort = (label: string) => (label.includes("2049") ? "수2049" : label.includes("유료가구") ? "가구" : label);

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
 * 종합 리뷰(2026-10-23 개편) — 조회 기간에 방영한 자사 채널 전부를 통합 분석한 1~3문장. 제목·배지·칸 없이 문장만(사용자 지시).
 * 첫 문장은 전체 성과, 이후 문장은 채널 간 차이·타깃 차이·본방/시간대·라인업 대비 성적 중 의미 있는 것만. 문장은 모두 서버(overallReviewOf) 고정 문구다.
 */
function ReviewText({ review }: { review: OverallReview }) {
  const [head, ...rest] = review.sentences;
  return (
    <section className="min-w-0 flex-1 border-l-2 border-zinc-300 pl-3 text-[14px] leading-relaxed text-zinc-800" aria-label="종합 리뷰">
      <p className="font-semibold text-zinc-900">{head}</p>
      {rest.length > 0 && <p className="mt-0.5">{rest.join(" ")}</p>}
    </section>
  );
}

/** 표의 타깃 한 칸 —"0.134 (+9%)" 한 줄. 점유율·채널 평균 값·KPI 표식은 넣지 않는다(개편 2026-10-23). 결측은 —, 유효한 0은 0 */
function TargetCell({ r, code, airing }: { r: ChannelRow | CompetitorRow | undefined; code: string; airing: AiringFilter }) {
  if (!r) return <span className="text-zinc-400">{MISSING}</span>;
  const observed = "status" in r ? r.status === "OBSERVED" && r.airings > 0 : r.airings > 0;
  if (!observed) return <span className="whitespace-nowrap text-[12px] text-zinc-400">{"status" in r ? emptyText(r, airing) : "실적 없음"}</span>;
  return (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
      <span className="inline-block w-[3.75rem] text-right tabular-nums text-zinc-900">{formatRatingValue(r.programAvg, code)}</span>
      <IdxText r={r.vsChannel} paren />
    </span>
  );
}

/** 점유율 칸 — 방영별 점유율 평균(그 시간 TV를 본 같은 타깃 중 이 채널 비율, %). 값이 없으면 — */
function ShareCell({ r }: { r: ChannelRow | CompetitorRow | undefined }) {
  const observed = !!r && ("status" in r ? r.status === "OBSERVED" && r.airings > 0 : r.airings > 0);
  return <span className="inline-block w-[3.5rem] text-right tabular-nums text-zinc-700">{observed && r!.shareAvg !== null ? formatPct(r!.shareAvg) : MISSING}</span>;
}

/** 두 단 머리 — 타깃마다 시청률(채널 평균=100% 비율)·점유율 */
function TargetHead({ first, cols }: { first: string; cols: string[] }) {
  return (
    <thead className="bg-zinc-50 text-[12px] text-zinc-500">
      <tr>
        <th rowSpan={2} className="whitespace-nowrap px-3 py-2 text-left align-bottom font-medium">
          {first}
        </th>
        {cols.map((c) => (
          <th key={c} colSpan={2} className="whitespace-nowrap border-l border-zinc-200 px-3 pt-2 text-center font-medium text-zinc-700" title={c}>
            {targetShort(c)}
          </th>
        ))}
        <th rowSpan={2} className="whitespace-nowrap border-l border-zinc-200 px-3 py-2 text-center align-bottom font-medium">
          방영횟수
        </th>
      </tr>
      <tr>
        {cols.map((c) => [
          <th key={`${c}r`} className="whitespace-nowrap border-l border-zinc-200 px-3 pb-2 text-center font-normal">
            시청률(채널 평균 대비)
          </th>,
          <th key={`${c}s`} className="whitespace-nowrap px-3 pb-2 text-center font-normal">
            점유율
          </th>,
        ])}
      </tr>
    </thead>
  );
}

const airCount = (airings: number, days: number) => `${formatInt(airings)}회 (${formatInt(days)}일)`;

/** 표의 방영횟수 — "회"를 기준으로 줄을 맞춘다(횟수는 오른쪽, (n일)은 왼쪽 정렬, 고정 폭 · 사용자 지시 2026-10-23) */
function AirCount({ airings, days }: { airings: number; days: number }) {
  return (
    <span className="inline-flex items-baseline whitespace-nowrap tabular-nums" aria-label={airCount(airings, days)}>
      <span className="inline-block w-[2.75rem] text-right">{formatInt(airings)}</span>
      <span>회</span>
      <span className="inline-block w-[3.75rem] pl-1 text-left text-zinc-500">({formatInt(days)}일)</span>
    </span>
  );
}
const TABLE_NOTE = "시청률·점유율 단위 % · 괄호는 같은 기간 채널 평균을 100%로 본 비율(100% 초과 푸른색, 미만 붉은색)";

/**
 * 채널별 성과표 — 열 순서 고정(채널 → 수2049 → 가구 → 방영횟수), 채널당 한 줄. 방영횟수는 KPI 타깃 행의 고유 방영 건수(두 타깃을 보여도 두 배로 세지 않음).
 * 행을 누르면 아래 종합평가·흐름·편성 비교가 그 채널로 바뀐다. 순서는 기존 채널 순서.
 */
function ChannelTable({ entries, airing, selected, onSelect, simulcast }: { entries: ChannelEntry[]; airing: AiringFilter; selected: string | null; onSelect: (r: ChannelRow) => void; simulcast: CompetitorRow[] }) {
  const cols = TARGET_ORDER.filter((t) => entries.some((e) => e.rows.some((r) => r.targetLabel === t)));
  return (
    <section className="mt-3">
      <div className="dense-grid max-w-4xl overflow-x-auto rounded-lg border border-zinc-200 bg-white" tabIndex={0} role="region" aria-label="채널별 성과 표">
        <table className="w-full min-w-[640px] text-[14px]">
          <TargetHead first="채널" cols={cols} />
          <tbody>
            {entries.map(({ main, rows }) => {
              const code = main.channelCode;
              const isSel = selected?.startsWith(`${code}|`) ?? false;
              // 동시방송 채널(사용자 지시 2026-10-27) — 같은 시각에 함께 방송한 경쟁 채널은 그 자사 채널 행 바로 아래에 같은 열로
              const simNames = [...new Set(simulcast.filter((c) => c.simulcastWith === code).map((c) => c.competitorName))];
              return (
                <Fragment key={code}>
                <tr onClick={() => onSelect(main)} className={`cursor-pointer border-t border-zinc-100 ${isSel ? "bg-sky-50" : "hover:bg-zinc-50"}`}>
                  <td className="whitespace-nowrap px-3 py-2">
                    <button type="button" onClick={(e) => (e.stopPropagation(), onSelect(main))} aria-pressed={isSel} className="text-left font-medium text-zinc-900 underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-600" aria-label={`${main.channelName} 평가 보기`}>
                      {main.channelName}
                    </button>
                  </td>
                  {cols.map((c) => {
                    const r = rows.find((x) => x.targetLabel === c);
                    return [
                      <td key={`${c}r`} className="border-l border-zinc-100 px-3 py-2 text-center">
                        <TargetCell r={r} code={code} airing={airing} />
                      </td>,
                      <td key={`${c}s`} className="px-3 py-2 text-center">
                        <ShareCell r={r} />
                      </td>,
                    ];
                  })}
                  <td className="whitespace-nowrap border-l border-zinc-100 px-3 py-2 text-center text-zinc-800">
                    <AirCount airings={main.airings} days={main.days} />
                  </td>
                </tr>
                {simNames.map((name) => {
                  const rs = simulcast.filter((c) => c.competitorName === name && c.simulcastWith === code);
                  const sMain = rs.reduce((a, b) => (b.airings > a.airings ? b : a));
                  return (
                    <tr key={`sim-${code}-${name}`} className="border-t border-zinc-100 bg-zinc-50/70">
                      <td className="whitespace-nowrap py-2 pl-7 pr-3">
                        <span className="mr-1 text-zinc-300" aria-hidden="true">└</span>
                        <span className="font-medium text-zinc-800">{name}</span>
                        <span className="ml-1.5 rounded bg-zinc-200/70 px-1.5 py-0.5 text-[11px] font-medium text-zinc-600">동시방송</span>
                      </td>
                      {cols.map((c) => {
                        const r = rs.find((x) => x.targetLabel === c);
                        return [
                          <td key={`${c}r`} className="border-l border-zinc-100 px-3 py-2 text-center">
                            <TargetCell r={r} code={name} airing="all" />
                          </td>,
                          <td key={`${c}s`} className="px-3 py-2 text-center">
                            <ShareCell r={r} />
                          </td>,
                        ];
                      })}
                      <td className="whitespace-nowrap border-l border-zinc-100 px-3 py-2 text-center text-zinc-800">
                        <AirCount airings={sMain.airings} days={sMain.days} />
                      </td>
                    </tr>
                  );
                })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[12px] text-zinc-500">{TABLE_NOTE}{simulcast.length > 0 ? " · 동시방송 행은 자사와 같은 날 같은 시각(±15분)에 함께 방송한 경쟁 채널의 그 방송분만 센 값(채널 평균은 그 채널의 하루 시청률 평균)" : ""}</p>
    </section>
  );
}

/** 경쟁 채널 성과 — 선택해서 연다. 같은 작품이 등록 경쟁채널에서 방영된 기록만(닐슨 경쟁채널 시트), 채널 평균은 그 경쟁채널의 하루 시청률 일평균. 자사 표와 같은 열 */
function CompetitorSection({ rows }: { rows: CompetitorRow[] }) {
  const names = [...new Set(rows.map((r) => r.competitorName))];
  return (
    <section className="mt-2">
      <div className="dense-grid max-w-4xl overflow-x-auto rounded-lg border border-zinc-200 bg-white" tabIndex={0} role="region" aria-label="경쟁 채널 성과 표">
        <table className="w-full min-w-[640px] text-[14px]">
          <TargetHead first="경쟁 채널" cols={TARGET_ORDER} />
          <tbody>
            {names.map((name) => {
              const rs = rows.filter((r) => r.competitorName === name);
              const main = rs.reduce((a, b) => (b.airings > a.airings ? b : a));
              return (
                <tr key={name} className="border-t border-zinc-100">
                  <td className="whitespace-nowrap px-3 py-2 font-medium text-zinc-900">{name}</td>
                  {TARGET_ORDER.map((c) => {
                    const r = rs.find((x) => x.targetLabel === c);
                    return [
                      <td key={`${c}r`} className="border-l border-zinc-100 px-3 py-2 text-center">
                        <TargetCell r={r} code={name} airing="all" />
                      </td>,
                      <td key={`${c}s`} className="px-3 py-2 text-center">
                        <ShareCell r={r} />
                      </td>,
                    ];
                  })}
                  <td className="whitespace-nowrap border-l border-zinc-100 px-3 py-2 text-center text-zinc-800">
                    <AirCount airings={main.airings} days={main.days} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[12px] text-zinc-500">{TABLE_NOTE}(그 경쟁 채널의 하루 시청률 평균) · 같은 시간대 비교는 내지 않습니다</p>
    </section>
  );
}

const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;
const shortDate = (d: string) => `${md(d)}(${DOW[new Date(`${d}T00:00:00Z`).getUTCDay()]})`;
const slotName = (dow: number, hb: number) => `${DOW[dow]} ${hb}시대`;

/** 눈금 간격 — 1·2·2.5·5 × 10^k 중 4칸 안팎(표시용) */
function niceStep(max: number): number {
  const raw = max / 4 || 0.1;
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? raw;
}

/**
 * 시청률 흐름 그래프(지구마불 세계여행 화면 참고) — 서버가 낸 점 값을 찍기만 한다. 가로축은 본방 방영(회차 번호가 있으면 'n회', 없으면 방영일)
 * 또는 방송일. 점선은 채널 평균. 값이 없는 점은 끊는다(0으로 잇지 않음). 점이 하나면 점만. 점에 마우스를 올리면 값.
 */
type TrendOverlay = { name: string; color: string; values: (number | null)[] };
function TrendChart({ points, base, baseLabel, code, overlays = [] }: { points: { label: string; sub: string; value: number | null }[]; base: (number | null)[]; baseLabel: string; code: string; overlays?: TrendOverlay[] }) {
  const W = 800;
  const H = 220;
  const L = 44;
  const R = 12;
  const T = 14;
  const B = 34;
  const vals = [...points.map((p) => p.value), ...base, ...overlays.flatMap((o) => o.values)].filter((v): v is number => v !== null);
  if (vals.length === 0) return <p className="py-6 text-center text-[13px] text-zinc-500">표시할 시청률이 없습니다.</p>;
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
        return x0 === x1 ? null : <path key={`a${i}`} d={`${d}L${x1},${y(0)}L${x0},${y(0)}Z`} fill="url(#pp-area)" stroke="none" />;
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
      {overlays.map((o) => (
        <g key={`ov-${o.name}`}>
          {seg(o.values).map((d, i) => (
            <path key={i} d={d} fill="none" stroke={o.color} strokeWidth={2} strokeLinejoin="round" strokeDasharray="6 3" />
          ))}
          {o.values.map((v, i) =>
            v === null ? null : (
              <circle key={i} cx={x(i)} cy={y(v)} r={points.length > 40 ? 2 : 3.2} fill="#fff" stroke={o.color} strokeWidth={2}>
                <title>{`${o.name} 동시방송 · ${points[i]?.label ?? ""} — ${formatRatingValue(v, code, { unit: true })}`}</title>
              </circle>
            )
          )}
        </g>
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

/** 최고·최저·최근 한 줄 — 그래프와 같은 자료(서버가 고른 점). 점이 하나면 최근만 */
function ExtremesLine({ x, code }: { x: { best: { v: number; at: string }; worst: { v: number; at: string }; recent: { v: number; at: string }; count: number } | null; code: string }) {
  if (!x) return null;
  const item = (k: string, p: { v: number; at: string }) => (
    <span key={k} className="whitespace-nowrap">
      <span className="text-zinc-500">{k}</span> <span className="font-semibold tabular-nums text-zinc-900">{formatRatingValue(p.v, code)}</span> <span className="text-zinc-500">· {p.at}</span>
    </span>
  );
  const items = x.count === 1 ? [item("최근", x.recent)] : [item("최고", x.best), item("최저", x.worst), item("최근", x.recent)];
  return <p className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[13px]">{items}</p>;
}

/** 왼쪽: 시청률 흐름 — 그래프 하나 + 결론 한 줄 + 최고·최저·최근(본방별·일별 전환 시 셋 다 같은 자료로 바뀐다) */
const SIM_COLORS: Record<string, string> = { MBN: "#f26b0a", "SBS Plus": "#1b6fb5" };
const simColor = (name: string, i: number) => SIM_COLORS[name] ?? ["#e11d48", "#0d9488", "#a21caf"][i % 3];

function TrendSection({ row, simulcast = [] }: { row: ChannelRow; simulcast?: CompetitorRow[] }) {
  const a = row.analysis!;
  const code = row.channelCode;
  const hasFirst = a.firstRuns.length >= 2;
  // 사용자 지시(2026-10-23): 월별 대신 일별 — 방영이 있는 방송일마다 그날 작품 평균과 그날 채널 하루 시청률
  const [unit, setUnit] = useState<"first" | "day">(hasFirst ? "first" : "day");
  const isFirst = unit === "first" && hasFirst;
  const epLabel = (r: AiringRef) => (r.episode !== null ? `${r.episode}회` : md(r.date));
  const points = isFirst
    ? a.firstRuns.map((r) => ({ label: epLabel(r), sub: `${shortDate(r.date)} ${fmtTime(r.startTime)}`, value: r.rating }))
    : row.daily.map((d) => ({ label: md(d.date), sub: `${d.airings}회`, value: d.programAvg }));
  const base = isFirst ? points.map(() => a.channelAvg) : row.daily.map((d) => d.channelAvg);
  const fx = a.firstExtremes;
  const dx = a.dayExtremes;
  const ext = isFirst
    ? fx && { best: { v: fx.best.rating, at: epLabel(fx.best) }, worst: { v: fx.worst.rating, at: epLabel(fx.worst) }, recent: { v: fx.recent.rating, at: epLabel(fx.recent) }, count: fx.count }
    : dx && { best: { v: dx.best.programAvg as number, at: md(dx.best.date) }, worst: { v: dx.worst.programAvg as number, at: md(dx.worst.date) }, recent: { v: dx.recent.programAvg as number, at: md(dx.recent.date) }, count: dx.count };
  const text = isFirst ? (a.trendFirst ?? a.trendText) : (a.trendDaily ?? a.trendText);
  // 동시방송 채널 겹쳐 보기(사용자 지시 2026-10-27) — 같은 타깃의 동시방송 방영별 시청률을 이 그래프의 점(날짜)에 맞춰 얹는다. 켜고 끈다(기본 켬)
  const [simOff, setSimOff] = useState<Record<string, boolean>>({});
  const pointDates = isFirst ? a.firstRuns.map((r) => r.date) : row.daily.map((d) => d.date);
  const simSeries = simulcast
    .filter((c) => c.targetLabel === (row.kpiGroup === "HH" ? "전국 유료가구" : "수도권 2049") && c.points && c.points.length > 0)
    .map((c, i) => {
      const by = new Map<string, number[]>();
      for (const p of c.points ?? []) if (p.rating !== null) by.set(p.date, [...(by.get(p.date) ?? []), p.rating]);
      const values = pointDates.map((d) => {
        const v = by.get(d);
        return v ? v.reduce((x, y) => x + y, 0) / v.length : null;
      });
      return { name: c.competitorName, color: simColor(c.competitorName, i), values };
    })
    .filter((o) => o.values.some((v) => v !== null));
  const overlays = simSeries.filter((o) => !simOff[o.name]);
  return (
    <section className="min-w-0 rounded-xl border border-zinc-200 bg-white p-4" aria-label="시청률 흐름">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-[12px] font-medium text-zinc-500">시청률 흐름</h4>
          <p className="text-[15px] font-semibold leading-snug text-zinc-900">{text}</p>
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
      <ExtremesLine x={ext ?? null} code={code} />
      {simSeries.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]" role="group" aria-label="동시방송 채널 겹쳐 보기">
          <span className="inline-flex items-center gap-1 font-medium text-zinc-700">
            <span className="inline-block h-[3px] w-4 rounded-full" style={{ backgroundColor: "#4f46e5" }} />
            {row.channelName}
          </span>
          <span className="text-zinc-400">동시방송 겹쳐 보기</span>
          {simSeries.map((o) => (
            <button key={o.name} type="button" aria-pressed={!simOff[o.name]} onClick={() => setSimOff((cur) => ({ ...cur, [o.name]: !cur[o.name] }))} className={chip(!simOff[o.name])} title={`${o.name} 동시방송 시청률을 그래프에서 ${simOff[o.name] ? "켜기" : "끄기"}`}>
              <span className="mr-1 inline-block h-[3px] w-3 rounded-full align-middle" style={{ backgroundColor: o.color }} />
              {o.name}
            </button>
          ))}
        </div>
      )}
      <div className="mt-2">
        <TrendChart points={points} base={base} baseLabel="채널 평균" code={code} overlays={overlays} />
      </div>
      <p className="text-[11px] text-zinc-500">{isFirst ? `본방 ${a.firstRuns.length}회 · 점선은 같은 기간 채널 평균` : `방송일 ${row.daily.length}일 · 점선은 그날 채널 평균`}</p>
    </section>
  );
}

const SLOT_SHOW = 4;

/** 오른쪽: 편성 비교 — 실제 방영한 요일·시간대별 시청률과 같은 채널·시간대 다른 프로그램 평균 대비. 기본 4행(서버 정렬: 방송일 3일 이상 먼저, 방영 많은 순) + 전체 시간대 */
function SlotSection({ row }: { row: ChannelRow }) {
  const a = row.analysis!;
  const code = row.channelCode;
  const [all, setAll] = useState(false);
  const list = all ? a.slots : a.slots.slice(0, SLOT_SHOW);
  return (
    <section className="min-w-0 rounded-xl border border-zinc-200 bg-white p-4" aria-label="편성 비교">
      <h4 className="text-[12px] font-medium text-zinc-500">편성 비교</h4>
      <p className="text-[15px] font-semibold leading-snug text-zinc-900">{a.slotLead ?? a.slotText}</p>
      {a.slots.length > 0 && (
        <div className="dense-grid mt-2 overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="text-[12px] text-zinc-500">
              <tr>
                <th className="whitespace-nowrap py-1 text-left font-medium">요일·시간대</th>
                <th className="whitespace-nowrap py-1 text-right font-medium">시청률</th>
                <th className="whitespace-nowrap py-1 text-right font-medium">시간대 평균 대비</th>
                <th className="whitespace-nowrap py-1 pl-3 text-right font-medium">점유율</th>
                <th className="whitespace-nowrap py-1 text-right font-medium">평균 대비</th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <tr key={`${s.dow}-${s.hourBlock}`} className="border-t border-zinc-100">
                  <td className="whitespace-nowrap py-1.5" title={`${s.airings}회 · 방송일 ${s.days}일`}>
                    {slotName(s.dow, s.hourBlock)}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{formatRatingValue(s.avg, code)}</td>
                  <td className="whitespace-nowrap py-1.5 text-right">
                    {s.basis === "HOUR" && <span className="mr-1 text-[11px] text-zinc-400" title={`같은 요일·시 비교 방송이 적어 같은 시(모든 요일) ${s.compAirings}건과 비교`}>전 요일</span>}
                    <IdxText r={s.vs} />
                  </td>
                  <td className="py-1.5 pl-3 text-right tabular-nums text-zinc-700">{s.shareAvg === null || s.shareAvg === undefined ? MISSING : formatPct(s.shareAvg)}</td>
                  <td className="whitespace-nowrap py-1.5 text-right">{s.shareVs ? <IdxText r={s.shareVs} /> : <span className="text-zinc-400">{MISSING}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {a.slotBaseFrom && (
        <p className="mt-1 text-[11px] text-zinc-500">
          평균 = {a.slotBaseFrom} ~ {a.slotBaseTo} 같은 채널·요일·시간대의 다른 프로그램(100%)
        </p>
      )}
      {a.slots.length > SLOT_SHOW && (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-1 text-[12px] text-zinc-600 underline underline-offset-2">
          {all ? "접기" : `전체 시간대 ${a.slots.length}개`}
        </button>
      )}
    </section>
  );
}

/** 종합평가 — 서버 고정 문구(결론 한 줄 + 근거 한 줄). 범위(최근 12주·조회 기간)·타깃·방송 구분 차이는 제목에 한 번만 */
function AssessmentBlock({ a, oc }: { a: Assessment | null; oc: OriginalCompare | null }) {
  if (!a) return oc ? <section className="rounded-xl border border-zinc-200 bg-white p-4" aria-label="오리지널 비교"><OriginalLines oc={oc} /></section> : null;
  const scope = a.scope === "12w" ? "최근 12주" : "조회 기간";
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4" aria-label="종합평가">
      <h4 className="text-[12px] font-medium text-zinc-500" title={`${a.from} ~ ${a.to} · ${a.targetLabel}`}>
        종합평가 · {scope} · {targetShort(a.targetLabel)}
        {a.allAiringsBasis ? " · 전체 방송 기준" : ""}
      </h4>
      <p className="mt-0.5 text-[16px] font-semibold leading-snug text-zinc-900" title={a.evidence ?? undefined}>
        {a.headline}
      </p>
      {/* 어디서 강하고 약한지·점유율 효율·하락은 조회 기간 방영 기준(편성 비교와 같은 자료). 진단 지수(보정 배율)는 결론에 마우스를 올리면 */}
      {(a.where || a.shareNote || a.trendNote) && (
        <ul className="mt-1 space-y-0.5 text-[14px] text-zinc-800">
          {a.where && <li>· {a.where}</li>}
          {a.shareNote && <li>· {a.shareNote}</li>}
          {a.trendNote && <li>· {a.trendNote}</li>}
        </ul>
      )}
      {oc && (
        <div className="mt-3 border-t border-zinc-100 pt-2">
          <OriginalLines oc={oc} />
        </div>
      )}
    </section>
  );
}

/** 오리지널 비교 — 같은 채널·분류 오리지널과 같은 회차 기준 순위, 직전 동시간대, 흐름(서버 고정 문구). 범위는 방영 시작 이후 본방이라 제목에 따로 적는다 */
function OriginalLines({ oc }: { oc: OriginalCompare }) {
  return (
    <>
      <h5 className="text-[12px] font-medium text-zinc-500" title={`${oc.dataFrom} 이후 자료 · ${oc.targetLabel}`}>
        {oc.classLabel} 비교 · 방영 시작 이후 본방 · {targetShort(oc.targetLabel)}
      </h5>
      <ul className="mt-0.5 space-y-0.5 text-[14px] text-zinc-900">
        {oc.lines.map((t) => (
          <li key={t}>· {t}</li>
        ))}
      </ul>
    </>
  );
}

/** 접힘 — 열 때만 내용을 그린다(클릭하지 않았는데 방송 수십 행이 페이지를 차지하지 않게) */
function Fold({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="mt-2 rounded-md border border-zinc-200 bg-white" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer px-3 py-2 text-[13px] font-medium text-zinc-700">{title}</summary>
      {open && <div className="dense-grid overflow-x-auto border-t border-zinc-100 px-3 py-2">{children}</div>}
    </details>
  );
}

const supplementText = (s: SupplementCount) => [s.plan ? `업로드 편성표 ${s.plan}` : "", s.registered ? `관리자 등록 본방 시각 ${s.registered}` : "", s.naver ? `네이버 방송 정보 ${s.naver}` : "", s.episode ? `회차 ${s.episode}` : ""].filter(Boolean).join(" · ");

/** 선택한 채널 — 종합평가 → [흐름·최고최저 | 편성 비교] → 접힌 방송 기록 */
function Analysis({ row, result, siblings, onSelect }: { row: ChannelRow; result: PerformanceResult; siblings: ChannelRow[]; onSelect: (r: ChannelRow) => void }) {
  const code = row.channelCode;
  const airings = result.airings.filter((a) => a.channelCode === code);
  const assess = (siblings.find((s) => s.primary) ?? row).assessment ?? null;
  // 오리지널 비교는 방송 채널(그 채널 KPI 타깃)에서만
  const oc = result.originalCompare && result.originalCompare.channelCode === code ? result.originalCompare : null;
  const splits = [
    { label: "본방", s: row.firstRun },
    { label: "확인된 재방", s: row.rerun },
    { label: "본방 여부 미확인", s: row.unknownRun },
  ].filter((x) => x.s.airings > 0);
  const cd = row.channelDaily;
  const sup = (result.supplement ?? []).find((s) => s.channelCode === code);
  return (
    <section className="mt-5" aria-label={`${row.channelName} ${row.targetLabel} 평가`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-[12px] font-semibold text-indigo-700">{row.channelName}</span>
        <h3 className="text-[16px] font-bold text-zinc-900">{shortProgramName(result.work.displayName)}</h3>
        {siblings.length > 1 && (
          <div className="ml-auto flex gap-1 text-[12px]" role="group" aria-label="분석 타깃">
            {siblings.map((s) => (
              <button key={s.targetLabel} type="button" aria-pressed={s.targetLabel === row.targetLabel} onClick={() => onSelect(s)} className={chip(s.targetLabel === row.targetLabel)} title={s.targetLabel}>
                {targetShort(s.targetLabel)}
              </button>
            ))}
          </div>
        )}
      </div>
      {!row.analysis ? (
        <p className="mt-2 text-[13px] text-zinc-600">{row.statusNote || "이 조건의 방영 기록이 없습니다."}</p>
      ) : (
        <>
          {(assess || oc) && (
            <div className="mt-2">
              <AssessmentBlock a={assess} oc={oc} />
            </div>
          )}
          <div className="mt-2 grid gap-2 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <TrendSection key={`t-${code}-${row.targetLabel}`} row={row} simulcast={(result.simulcast ?? []).filter((c) => c.simulcastWith === code)} />
            <SlotSection key={`s-${code}-${row.targetLabel}`} row={row} />
          </div>
          <Fold key={`f-${code}-${row.targetLabel}`} title={`방송 기록 · ${row.channelName} ${formatInt(airings.length)}건`}>
            <p className="mb-2 text-[12px] text-zinc-600">
              {row.observedFrom} ~ {row.observedTo} · {airCount(row.airings, row.days)}
              {row.episodes ? ` · 회차 ${row.episodes}개` : ""} · 점유율(방영별 평균) {row.shareAvg === null ? MISSING : formatPct(row.shareAvg)}
              {cd && cd.validDays < cd.periodDays ? ` · 채널 평균 자료 ${cd.validDays}/${cd.periodDays}일` : ""}
            </p>
            {sup && supplementText(sup) && <p className="mb-2 text-[12px] text-zinc-600">본방 여부·회차 보완(닐슨에 표시가 없는 방영): {supplementText(sup)}</p>}
            {splits.length > 0 && (
              <table className="mb-2 w-full max-w-md text-[12px]">
                <thead className="text-zinc-500">
                  <tr>
                    <th className="py-1 text-left font-medium">방송 구분(조회 기간 전체)</th>
                    <th className="py-1 text-right font-medium">방영횟수</th>
                    <th className="py-1 text-right font-medium">평균</th>
                  </tr>
                </thead>
                <tbody>
                  {splits.map((x) => (
                    <tr key={x.label} className="border-t border-zinc-100">
                      <td className="py-1">{x.label}</td>
                      <td className="py-1 text-right tabular-nums">{airCount(x.s.airings, x.s.days)}</td>
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
                    <th className="py-1 text-left font-medium">본방 구분</th>
                    <th className="py-1 text-left font-medium">회차</th>
                    <th className="py-1 text-left font-medium">원본 표기</th>
                    <th className="py-1 text-right font-medium">시청률</th>
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
                      <td className="py-1">{a.firstRun === true ? "본방" : a.firstRun === false ? "재방" : "미확인"}</td>
                      <td className="py-1">{a.episode ?? MISSING}</td>
                      <td className="py-1 text-zinc-500">{a.name}</td>
                      <td className="py-1 text-right tabular-nums">{formatRatingValue(a.rating, code)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-[12px] text-zinc-500">방송별 목록은 채널 KPI 타깃 기준으로만 제공합니다.</p>
            )}
            {row.primary && result.airingsTruncated && <p className="mt-1 text-[11px] text-zinc-500">기록이 많아 일부만 표시(평균 계산에는 전부 포함).</p>}
          </Fold>
        </>
      )}
    </section>
  );
}

/** 계산 기준 — 정의·단위·기간을 한 곳에(화면 맨 아래, 접힘) */
function CalcBasis() {
  const items: [string, string][] = [
    ["타깃", "수2049 = 수도권 개인 2049, 가구 = 전국 유료방송가입가구. 두 타깃 값은 서로 합치거나 한 순위로 묶지 않습니다."],
    ["시청률", "선택한 기간·방송 구분에서 작품 방영 한 건마다의 닐슨 시청률(%)을 산술평균(방송시간 가중 아님). 같은 방영이 두 번 적재돼도 한 번만 셉니다. — 는 자료 없음, 0은 실제 0, <0.001은 0보다 크지만 표시 자릿수보다 작은 값입니다."],
    ["채널 평균 대비(표 괄호)", "작품 시청률 ÷ 같은 기간 공식 채널 하루 시청률의 일평균 × 100. 채널 평균을 100%로 본 비율이라 109%는 채널 평균보다 9% 높다는 뜻이고 %p나 점유율이 아닙니다. 100% 초과 푸른색, 미만 붉은색. 채널 평균이 0이거나 없으면 —."],
    ["점유율", "닐슨 방영별 점유율(그 시간 TV를 본 같은 타깃 중 이 채널 비율)의 산술평균입니다. 채널의 기간 공식 점유율이 아니며, 값이 없는 방영은 빼고 셉니다. 시청률이 낮아도 그 시간 TV 시청자가 적으면 점유율은 높을 수 있습니다."],
    ["방영횟수", "고유 방영 건수(채널 KPI 타깃 행 기준, 두 타깃을 함께 보여도 두 번 세지 않음)와 방송일 수."],
    ["종합 리뷰(제목 옆)", "조회 기간에 방영 기록이 있는 자사 채널을 모두 봅니다. 채널마다 시청 규모가 달라 시청률을 합치지 않고, 채널마다 표의 ‘채널 평균 대비’와 같은 시간대 기대치 대비(콘텐츠 적합도와 같은 표본 보정 배율)를 0.85배 미만·0.85~1.18배·1.18배 이상으로 나눠 채널마다 ‘평균에 못 미침·평균 수준·평균보다 높음’으로 판단합니다(방영 많은 채널 하나가 결론을 좌우하지 않게 시청률을 합치지 않음). 방영일 8일 미만 채널은 판단에서 뺍니다. 첫 문장은 채널 이름별 판단(ENA가 먼저, 그다음 방영 많은 순, 높은 채널과 낮은 채널이 함께 있으면 특징 없는 평균 수준 채널은 생략), 둘째 문장은 같은 채널 오리지널 순위(중간보다 위·아래), 최근 하락(선택한 기간의 마지막 1/3이 그 앞보다 같은 방송일 채널 평균 대비 약 30% 이상 낮음 — 12주면 최근 4주 vs 이전 8주, 양쪽 방송일 3일 이상), 2049와 가구 반응 차이, 같은 시간대 경쟁력, 본방과 본방 외 방송 차이 중 가장 앞선 하나만 씁니다. 의미 있는 사실이 없으면 한 문장으로 끝냅니다."],
    ["종합평가", "조회 기간이 최근 12주와 같으면 최근 12주 편성진단(콘텐츠 적합도, 채널 KPI 타깃·전체 방송)의 ‘같은 시간대 기준’(같은 요일·시간대 다른 프로그램 기대치 대비)과 ‘채널 방영 평균’(채널 프로그램 방영 1건당 평균 대비) 지수의 방향을 고정 문구로 잇습니다. 두 지수는 표본이 적으면 1배 쪽으로 보정된 값입니다. 채널 방영 평균은 표의 채널 하루 평균과 분모가 달라 표의 %와 맞지 않을 수 있습니다. 최근 4주가 이전 8주보다 약 30% 이상 낮으면 그 사실을 근거로 씁니다. 조회 기간이 최근 12주와 다르거나(결론과 세부 줄의 기간이 섞이지 않게), 최근 12주 방영이 3일 미만이거나 없으면 조회 기간의 채널 평균 대비·같은 시간대 기준으로 ‘조회 기간’ 평가를 내고, 하락도 그 기간 안에서(마지막 1/3이 그 앞보다 같은 방송일 채널 평균 대비 약 30% 이상 낮으면) 판단합니다. 점수·판정 태그·미래 예측은 쓰지 않습니다."],
    ["시청률 흐름", "본방별은 본방 방영(회차 번호가 있으면 회차로 표기), 일별은 방영이 있는 방송일의 평균. 최고·최저·최근은 그래프에 그린 점과 같은 자료입니다. 4점 이상이면 앞 절반·뒤 절반 평균, 2~3점이면 처음·최근을 비교합니다."],
    ["편성 비교", "조회 기간에 실제 방영한 요일·시(시작 시각)마다 작품 평균을, 올해 1월 1일부터 최신 자료일까지(12주 미만이면 최근 12주) 같은 채널·타깃·요일·시에 방송한 다른 프로그램의 단순 평균(=100%)과 비교합니다. 비교군을 조회 기간과 떼어 최근 4주 조회에서도 비교 방송이 모자라지 않게 했습니다. 같은 요일·시 비교 방송이 15건 미만이면 같은 시(전 요일)로 넓히고(‘전 요일’ 표시), 그래도 부족하면 —. 점유율도 같은 비교군의 점유율 평균과 견줍니다. 기본은 방송일 3일 이상 구간 먼저, 방영 많은 순 4개. ‘집중’·‘몇 곳 중 몇 곳’ 같은 문장은 방송일 3일 이상 구간만 씁니다."],
    ["종합평가의 세부 줄", "본방 시간은 방송일이 가장 많은 본방 구간의 같은 시간대 평균 대비 비율, 본방 외 시간대는 평균보다 높은 곳·낮은 곳의 개수입니다(편성 비교와 같은 자료). 시청률이 채널 평균보다 낮거나 그 시간대 시청률이 평균을 넘지 못해도 점유율이 같은 시간대 평균의 150%(콘텐츠 적합도 ‘강화’ 선과 같은 값) 이상인 시간대가 있으면 따로 적습니다."],
    ["본방 구분", "닐슨 <본>·<재> 표시를 먼저 쓰고, 없으면 업로드 편성표 → 관리자 등록 본방 요일·시각 → 네이버 방송 정보 순서로 보완합니다(보완 건수는 방송 기록에). 근거가 없으면 재방으로 단정하지 않고 ‘미확인’으로 둡니다. 본방 = 각 채널의 첫 방송."],
  ];
  return (
    <details className="mt-4 text-[12px]">
      <summary className="inline-block cursor-pointer rounded px-2 py-1 text-zinc-600 ring-1 ring-zinc-200 hover:bg-zinc-50">계산 기준</summary>
      <dl className="mt-2 space-y-1.5 rounded-md bg-zinc-50 p-3 text-zinc-700">
        {items.map(([k, v]) => (
          <div key={k}>
            <dt className="font-medium">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

/**
 * 화면 상태 = 주소 하나 — 새로고침·공유·뒤로 가기가 같은 화면을 연다. 기본값(최근 12주·전체 방송·두 타깃·전체 채널)은 주소에 쓰지 않는다.
 * 예전에는 상태를 화면이 따로 들고 주소는 작품만 적어, 주소를 바꿀 때마다 첫 진입 처리가 다시 돌아 검색 결과를 기본 목록으로 덮어썼다(2026-10-23 재현).
 * 다른 화면 링크(?q=이름&channel=채널코드, ?group=작품키&from&to)는 그대로 받는다.
 */
interface ViewState {
  group: string | null;
  /** 다른 화면에서 이름으로 넘어올 때만 — 작품을 정하면 지운다 */
  q: string;
  preset: PeriodPreset;
  from: string | null;
  to: string | null;
  airing: AiringFilter;
  target: TargetMode;
  channels: string[];
  /** 처음 분석할 채널(다른 화면에서 넘겨받은 채널) */
  focus: string | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function readState(sp: Pick<URLSearchParams, "get">): ViewState {
  const iso = (k: string) => {
    const v = sp.get(k);
    return v && ISO_DATE.test(v) ? v : null;
  };
  const from = iso("from");
  const to = iso("to");
  const p = sp.get("period");
  const a = sp.get("airing");
  const t = sp.get("target");
  const ch = sp.get("channel");
  return {
    group: (sp.get("group") ?? "").slice(0, 120) || null,
    q: (sp.get("q") ?? "").slice(0, 60),
    preset: from || to ? "custom" : p === "4w" || p === "all" ? p : "12w",
    from,
    to,
    airing: a === "first" || a === "rerun" ? a : "all",
    target: t === "kpi" || t === "common2049" || t === "commonHH" ? t : "both",
    channels: (sp.get("channels") ?? "").split(",").filter((c) => CHANNELS.some((x) => x.code === c)),
    focus: ch && /^[A-Z_]{2,12}$/.test(ch) ? ch : null,
  };
}

function writeState(s: ViewState): string {
  const p = new URLSearchParams();
  if (s.group) p.set("group", s.group);
  else if (s.q) p.set("q", s.q);
  if (s.preset === "custom") {
    if (s.from) p.set("from", s.from);
    if (s.to) p.set("to", s.to);
  } else if (s.preset !== "12w") p.set("period", s.preset);
  if (s.airing !== "all") p.set("airing", s.airing);
  if (s.target !== "both") p.set("target", s.target);
  if (s.channels.length) p.set("channels", s.channels.join(","));
  if (s.focus) p.set("channel", s.focus);
  const qs = p.toString();
  return `/program-performance${qs ? `?${qs}` : ""}`;
}

const SEARCH_SHOW = 40;
/** 이름 비교용 — 공백·문장부호·대소문자 무시 */
const looseName = (s: string) => s.replace(/[\s\p{P}\p{S}]/gu, "").toLowerCase();
const chName = (code: string) => CHANNELS.find((c) => c.code === code)?.label ?? code.replace(/_/g, " ");

/** 검색 목록 한 줄의 보조 정보 — 같은 이름의 다른 시즌·동명 작품을 고를 수 있게 방영 채널·마지막 방영일·방영 수 */
function SearchMeta({ it }: { it: SearchItem }) {
  const own = it.ownChannels.length > 0;
  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] tabular-nums text-zinc-500">
      {own ? <span>{it.ownChannels.map(chName).join("·")}</span> : <span className="rounded bg-zinc-100 px-1 font-medium text-zinc-600">타사 {(it.compChannels ?? []).slice(0, 3).join("·")}</span>}
      {it.lastDate && <span>· 마지막 방영 {it.lastDate}</span>}
      {it.airingsTotal > 0 && <span>· {formatInt(it.airingsTotal)}회</span>}
    </div>
  );
}

/**
 * 작품 찾기 — 입력하면 0.25초 뒤 자동으로 찾고(앞선 요청은 취소해 늦게 온 옛 결과가 덮어쓰지 않게) 입력창 아래에 목록을 펼친다.
 * ↑↓로 고르고 Enter, Esc로 닫는다. 보던 작품은 다른 작품을 고를 때까지 그대로 둔다(검색만으로 화면이 비지 않게).
 * 분류 버튼(오리지널 드라마·예능)은 그 분류 전체 목록을 같은 자리에 연다. 작품을 고르기 전에는 ENA 최근 2주 오리지널을 한 줄로 보여 준다.
 */
function ProgramSearch({ initialQuery, hasSelection, onPick }: { initialQuery: string; hasSelection: boolean; onPick: (it: SearchItem, auto: boolean) => void }) {
  const [text, setText] = useState(initialQuery);
  const [mode, setMode] = useState<ClassFilter>("all");
  const [open, setOpen] = useState(Boolean(initialQuery));
  const [recent, setRecent] = useState<SearchItem[] | null>(null);
  const [res, setRes] = useState<{ key: string; items: SearchItem[]; error: string | null } | null>(null);
  const [active, setActive] = useState(0);
  // 다른 화면에서 이름으로 넘어온 첫 검색만, 후보가 하나면 바로 연다(여럿이면 사용자가 고른다 — 다른 시즌·동명 작품을 임의로 고르지 않음)
  const autoPick = useRef(Boolean(initialQuery));
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const query = text.trim();
  const cls: ClassFilter = query ? "all" : mode;
  const key = `${query}|${cls}`;
  const isRecent = key === "|all";
  const showDrop = open && (query !== "" || mode !== "all" || hasSelection);

  useEffect(() => {
    const ac = new AbortController();
    fetch("/api/program-performance/search?q=&class=all", { signal: ac.signal })
      .then((r) => r.json())
      .then((j) => setRecent(j.ok ? (j.items as SearchItem[]) : []))
      .catch(() => !ac.signal.aborted && setRecent([]));
    return () => ac.abort();
  }, []);

  useEffect(() => {
    if (!open || isRecent) return;
    const ac = new AbortController();
    const timer = setTimeout(
      () => {
        fetch(`/api/program-performance/search?q=${encodeURIComponent(query)}&class=${cls}`, { signal: ac.signal })
          .then((r) => r.json())
          .then((j) => {
            const list = j.ok ? (j.items as SearchItem[]) : [];
            if (autoPick.current) {
              autoPick.current = false;
              // 후보가 하나이거나, 이름이 검색어와 똑같은 작품이 하나뿐일 때(편성표 링크의 '연애박사' → 연애박사몰아보기·연인 등이 함께 나와도 연애박사)
              const exact = list.filter((it) => looseName(it.displayName) === looseName(query));
              const only = list.length === 1 ? list[0] : exact.length === 1 ? exact[0] : null;
              if (only) {
                setOpen(false);
                setText("");
                onPick(only, true);
                return;
              }
            }
            setRes({ key, items: list, error: j.ok ? null : (j.message ?? "검색 실패") });
            setActive(0);
          })
          .catch(() => !ac.signal.aborted && setRes({ key, items: [], error: "검색 중 오류가 났습니다." }));
      },
      query ? 250 : 0
    );
    return () => {
      clearTimeout(timer);
      ac.abort();
    };
  }, [open, isRecent, key, query, cls, onPick]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const list = isRecent ? recent : (res?.items ?? null);
  const pending = isRecent ? recent === null : res?.key !== key;
  const error = !isRecent && !pending ? (res?.error ?? null) : null;
  const shown = (list ?? []).slice(0, SEARCH_SHOW);

  useEffect(() => {
    if (showDrop) document.getElementById(`pp-opt-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, showDrop]);

  const choose = (it: SearchItem) => {
    setOpen(false);
    setText("");
    setMode("all");
    inputRef.current?.blur();
    onPick(it, false);
  };
  const heading = query
    ? pending
      ? `‘${query}’ 찾는 중…`
      : `‘${query}’ ${formatInt(list?.length ?? 0)}개${(list?.length ?? 0) > SEARCH_SHOW ? ` · 상위 ${SEARCH_SHOW}개 표시(더 입력하면 좁혀집니다)` : ""}`
    : mode === "drama"
      ? "오리지널 드라마 · 최근 방영 순"
      : mode === "variety"
        ? "오리지널 예능 · 최근 방영 순"
        : "ENA 최근 2주 방영 오리지널 · 최근 방영 순";

  return (
    <div ref={boxRef} className="relative">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <svg className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
            <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setActive(0);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setOpen(true);
                setActive((i) => Math.min(i + 1, Math.max(shown.length - 1, 0)));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                // 찾는 중에는 흐리게 남아 있는 이전 목록에서 고르지 않는다
                if (!pending && shown[active]) choose(shown[active]);
                else setOpen(true);
              } else if (e.key === "Escape") setOpen(false);
            }}
            role="combobox"
            aria-label="프로그램 검색"
            aria-autocomplete="list"
            aria-expanded={showDrop}
            aria-controls="pp-search-list"
            aria-activedescendant={showDrop && shown[active] ? `pp-opt-${active}` : undefined}
            autoComplete="off"
            placeholder={hasSelection ? "다른 작품 검색 — 이름 일부·약칭 가능" : "작품명 검색 — 이름 일부·약칭 가능"}
            className="w-full rounded-md border border-zinc-300 py-1.5 pl-8 pr-8 text-[16px] focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100 sm:text-[14px]"
          />
          {text && (
            <button
              type="button"
              aria-label="검색어 지우기"
              onClick={() => {
                setText("");
                inputRef.current?.focus();
              }}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded px-1.5 text-[16px] leading-none text-zinc-400 hover:text-zinc-700"
            >
              ×
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1 text-[12px]" role="group" aria-label="오리지널 작품 목록">
          {CLASS_FILTERS.map((c) => {
            const on = showDrop && !query && mode === c.id;
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  setText("");
                  setMode(on ? "all" : c.id);
                  setActive(0);
                  setOpen(!on);
                }}
                className={`rounded-full px-3 py-1 ring-1 ${on ? "bg-indigo-600 text-white ring-indigo-600" : "bg-white text-zinc-600 ring-zinc-200 hover:bg-zinc-50"}`}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      {showDrop && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b border-zinc-100 bg-zinc-50 px-3 py-1.5 text-[11px] text-zinc-500">
            {pending && <Spinner />}
            <span>{heading}</span>
            <span className="ml-auto hidden sm:inline">↑↓ 이동 · Enter 선택 · Esc 닫기</span>
          </div>
          {error ? (
            <p className="px-3 py-3 text-[13px] text-rose-700">{error}</p>
          ) : !pending && shown.length === 0 ? (
            <p className="px-3 py-3 text-[13px] text-zinc-500">일치하는 작품이 없습니다. 이름 일부(예: ‘지구마불’)나 약칭으로 찾아 보세요.</p>
          ) : (
            <ul id="pp-search-list" role="listbox" aria-label="작품 후보" className={`max-h-[min(60vh,420px)] overflow-y-auto py-1 ${pending ? "opacity-50" : ""}`}>
              {shown.map((it, i) => (
                <li
                  key={it.groupKey}
                  id={`pp-opt-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => !pending && choose(it)}
                  className={`cursor-pointer px-3 py-1.5 ${i === active ? "bg-indigo-50" : ""}`}
                >
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-[14px] font-medium text-zinc-900" title={it.displayName}>
                      {shortProgramName(it.displayName)}
                    </span>
                    <ClassDot cls={it.classification} />
                    {SHOW_CLASS.includes(it.classification) && <span className="shrink-0 text-[11px] text-zinc-500">{WORK_CLASS_LABEL[it.classification]}</span>}
                  </div>
                  <SearchMeta it={it} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!hasSelection && (
        // 한 줄 정리(사용자 지시 2026-10-22): 작품 구분은 색 점으로(이름은 마우스 오버), 넘치면 옆으로 넘긴다. "최근 2주 방영" 라벨은 두지 않음(2026-10-23)
        <ul className="mt-2 flex min-w-0 flex-nowrap gap-1.5 overflow-x-auto pb-1" aria-label="작품 목록" title="ENA에서 최근 2주 안에 방영한 오리지널(최근 방영 순)">
          {recent === null && <li className="text-[12px] text-zinc-400">목록을 불러오는 중…</li>}
          {recent?.length === 0 && <li className="text-[12px] text-zinc-500">최근 2주 안에 방영한 오리지널이 없습니다. 위에서 작품명을 검색하세요.</li>}
          {recent?.map((it) => (
            <li key={it.groupKey} className="shrink-0">
              <button type="button" title={SHOW_CLASS.includes(it.classification) ? WORK_CLASS_LABEL[it.classification] : undefined} onClick={() => choose(it)} className="flex items-center gap-1.5 whitespace-nowrap rounded-md bg-white px-2.5 py-1 text-left text-[13px] ring-1 ring-zinc-200 hover:bg-zinc-50">
                <span className="font-medium">{shortProgramName(it.displayName)}</span>
                <ClassDot cls={it.classification} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const PRESETS: [Exclude<PeriodPreset, "custom">, string][] = [
  ["12w", "최근 12주"],
  ["all", "전체 기간"],
];
  ["4w", "최근 4주"],

/**
 * 기간 — 최근 4주·12주·전체는 누르는 즉시, '기간 선택'은 날짜 두 개를 고른 뒤 [적용]을 눌러야 조회한다
 * (예전에는 날짜를 입력하는 도중 연도 한 자리마다 다시 계산을 요청하고 "시작일이 종료일보다 늦습니다"가 번쩍였다, 2026-10-23).
 * 고를 수 있는 날짜는 자료 첫날~최신 자료일, 시작일이 종료일보다 늦으면 적용하지 않는다.
 */
function PeriodControl({ preset, from, to, period, dim, onPreset, onCustom }: { preset: PeriodPreset; from: string | null; to: string | null; period: PerformanceResult["period"] | null; dim: boolean; onPreset: (p: Exclude<PeriodPreset, "custom">) => void; onCustom: (from: string, to: string) => void }) {
  const [draft, setDraft] = useState<{ from: string; to: string } | null>(null); // null = 닫힘
  const isOpen = draft !== null;
  const boxRef = useRef<HTMLDivElement>(null);
  const min = period?.dbFirstDate ?? undefined;
  const max = period?.latestDataDate ?? undefined;

  useEffect(() => {
    if (!isOpen) return;
    const close = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setDraft(null);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setDraft(null);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [isOpen]);

  const err = !draft
    ? null
    : !draft.from || !draft.to
      ? "시작일과 종료일을 모두 고르세요."
      : draft.from > draft.to
        ? "시작일이 종료일보다 늦습니다."
        : min && draft.to < min
          ? `자료는 ${min}부터 있습니다.`
          : max && draft.from > max
            ? `최신 자료일은 ${max}입니다.`
            : null;
  const apply = () => {
    if (!draft || err) return;
    onCustom(draft.from, draft.to);
    setDraft(null);
  };
  const dateInput = (k: "from" | "to", label: string) => (
    <label className="block min-w-0">
      <span className="mb-0.5 block text-[11px] font-medium text-zinc-600">{label}</span>
      <input type="date" value={draft?.[k] ?? ""} min={min} max={max} onChange={(e) => setDraft((d) => d && { ...d, [k]: e.target.value })} className="w-full rounded border border-zinc-300 px-1.5 py-1 text-[16px] tabular-nums sm:text-[12px]" />
    </label>
  );

  return (
    <div ref={boxRef} className="relative flex flex-wrap items-center gap-1" role="group" aria-label="기간">
      {PRESETS.map(([id, label]) => (
        <button
          key={id}
          type="button"
          aria-pressed={preset === id}
          onClick={() => {
            setDraft(null);
            onPreset(id);
          }}
          className={chip(preset === id)}
        >
          {label}
        </button>
      ))}
      <button
        type="button"
        aria-pressed={preset === "custom"}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        // 지금 보고 있는 기간에서 시작
        onClick={() => setDraft(isOpen ? null : { from: from ?? period?.from ?? "", to: to ?? period?.to ?? "" })}
        className={chip(preset === "custom")}
      >
        기간 선택 ▾
      </button>
      {period && <span className={`ml-1 font-medium tabular-nums ${dim ? "text-zinc-400" : "text-zinc-800"}`}>{period.from} ~ {period.to}</span>}
      {isOpen && (
        <form
          role="dialog"
          aria-label="조회 기간 선택"
          onSubmit={(e) => {
            e.preventDefault();
            apply();
          }}
          className="absolute left-0 top-full z-30 mt-1 w-[min(320px,calc(100vw-32px))] space-y-2 rounded-md border border-zinc-200 bg-white p-3 shadow-md"
        >
          <div className="grid grid-cols-2 gap-2">
            {dateInput("from", "시작일")}
            {dateInput("to", "종료일")}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
            {period?.workFirstObserved && (
              <button type="button" onClick={() => setDraft((d) => d && { ...d, from: period.workFirstObserved! })} className="text-indigo-700 underline underline-offset-2">
                작품 첫 방영일({period.workFirstObserved})부터
              </button>
            )}
            {max && (
              <button type="button" onClick={() => setDraft((d) => d && { ...d, to: max })} className="text-indigo-700 underline underline-offset-2">
                최신 자료일({max})까지
              </button>
            )}
          </div>
          {err ? <p className="text-[11px] text-rose-700">{err}</p> : <p className="text-[11px] text-zinc-500">{min && max ? `자료가 있는 기간: ${min} ~ ${max}` : "날짜를 고른 뒤 적용을 누르세요."}</p>}
          <div className="flex justify-end gap-1.5">
            <button type="button" onClick={() => setDraft(null)} className="rounded px-2.5 py-1 text-zinc-600 ring-1 ring-zinc-200 hover:bg-zinc-50">
              취소
            </button>
            <button type="submit" disabled={Boolean(err)} className="rounded bg-zinc-900 px-3 py-1 font-medium text-white disabled:cursor-not-allowed disabled:opacity-40">
              적용
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

/** 조건별 결과를 화면에 잠시 보관 — 뒤로 가기·조건 되돌리기가 다시 계산 없이 바로 보인다 */
const RESULT_KEEP = 12;

export default function ProgramPerformanceView() {
  const sp = useSearchParams();
  const view = useMemo(() => readState(sp), [sp]);
  const { group, preset, from, to, airing, target: targetMode, channels, focus: focusChannel } = view;

  // 주소 바꾸기 — 브라우저 기록 API(Next.js가 useSearchParams와 맞춰 준다, 서버 왕복 없음). 작품 선택은 기록을 쌓아 뒤로 가기로 돌아가고, 조건 변경은 바꿔 쓴다.
  const nav = useCallback((patch: Partial<ViewState>, mode: "push" | "replace" = "replace") => {
    const url = writeState({ ...readState(new URLSearchParams(window.location.search)), ...patch });
    if (url === `${window.location.pathname}${window.location.search}`) return;
    window.history[mode === "push" ? "pushState" : "replaceState"](null, "", url);
  }, []);

  // 고른 작품 이름 — 첫 결과가 오기 전 계산 중 문구에 쓴다
  const [picked, setPicked] = useState<{ group: string; name: string } | null>(null);
  const pick = useCallback(
    (it: SearchItem, auto: boolean) => {
      setPicked({ group: it.groupKey, name: it.displayName });
      // 다른 화면에서 넘어온 이름으로 자동으로 연 경우만 넘겨받은 채널을 유지한다
      nav(auto ? { group: it.groupKey, q: "" } : { group: it.groupKey, q: "", focus: null }, auto ? "replace" : "push");
    },
    [nav]
  );

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

  const [results, setResults] = useState<Record<string, { result: PerformanceResult | null; error: string | null }>>({});
  const [last, setLast] = useState<PerformanceResult | null>(null);
  const [retry, setRetry] = useState(0);
  const kept = useRef<string[]>([]);
  useEffect(() => {
    if (!requestUrl || kept.current.includes(requestUrl)) return;
    // 조건을 빨리 바꾸면 앞선 요청을 취소한다 — 늦게 도착한 옛 조건의 결과가 새 조건 화면을 덮지 않게
    const ac = new AbortController();
    fetch(requestUrl, { signal: ac.signal })
      .then((r) => r.json())
      .then((j) => {
        const result = j.ok ? (j.result as PerformanceResult) : null;
        let drop: string | null = null;
        if (result) {
          kept.current.push(requestUrl);
          if (kept.current.length > RESULT_KEEP) drop = kept.current.shift() ?? null;
          setLast(result);
        }
        setResults((cur) => {
          const next = { ...cur, [requestUrl]: { result, error: j.ok ? null : (j.message ?? "조회 실패") } };
          if (drop) delete next[drop];
          return next;
        });
      })
      .catch(() => !ac.signal.aborted && setResults((cur) => ({ ...cur, [requestUrl]: { result: null, error: "조회 중 오류가 났습니다." } })));
    return () => ac.abort();
  }, [requestUrl, retry]);

  const entry = requestUrl ? results[requestUrl] : undefined;
  const loading = requestUrl !== null && !entry;
  const current = entry?.result ?? null;
  // 조건을 바꿔 다시 계산하는 동안에는 같은 작품의 직전 결과를 흐리게 그대로 둔다(화면이 비어 검색 단계로 돌아간 것처럼 보이지 않게)
  const stale = !current && loading && last && last.work.groupKey === group ? last : null;
  const result = current ?? stale;
  const fetchError = entry?.error ?? null;
  const retryFetch = () => {
    if (!requestUrl) return;
    setResults((cur) => {
      const next = { ...cur };
      delete next[requestUrl];
      return next;
    });
    setRetry((n) => n + 1);
  };

  // 분석할 채널·타깃 행(채널코드|타깃)·경쟁 채널 펼침은 작품별 — 작품을 바꾸면 처음 상태로(이전 선택이 남지 않게)
  const [sel, setSel] = useState<{ group: string; key: string } | null>(null);
  const selKey = sel && sel.group === group ? sel.key : null;
  const [compFor, setCompFor] = useState<string | null>(null);
  const showComp = compFor !== null && compFor === group;
  const analysisRef = useRef<HTMLDivElement>(null);

  const toggleChannel = (code: string) => nav({ channels: channels.includes(code) ? channels.filter((c) => c !== code) : [...channels, code] });
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
  // 동시방송 행 — 표에 있는 자사 채널 아래에 붙이고, 그 자사 채널이 표에 없으면(채널 선택으로 뺀 경우) 경쟁 채널 성과 쪽에 둔다
  const entryCodes = new Set(entries.map((e) => e.main.channelCode));
  const simAll = result?.simulcast ?? [];
  const simShown = simAll.filter((c) => c.simulcastWith !== null && c.simulcastWith !== undefined && entryCodes.has(c.simulcastWith));
  const competitorRows = result ? [...result.competitors, ...simAll.filter((c) => !simShown.includes(c))] : [];
  // 분류 안내 문구는 배지를 다는 경우(분류 충돌)에만 — 목록에 없는 작품의 '분류 미확인' 안내는 숨긴다
  const cls = result?.classification;
  const visibleNotes = result ? result.notes.filter((n) => !(cls && n === cls.note && !SHOW_CLASS.includes(cls.cls))) : [];
  const selectable = entries.flatMap((e) => e.rows.filter(aired));
  // 선택 행이 응답에 없으면 진입 채널 → 첫 채널의 KPI 행으로 돌아간다
  const selRow = selectable.find((r) => rowKey(r) === selKey) ?? comparable.find((r) => r.channelCode === focusChannel) ?? comparable[0] ?? null;
  const select = (r: ChannelRow) => {
    if (group) setSel({ group, key: rowKey(r) });
    requestAnimationFrame(() => {
      const el = analysisRef.current;
      // 분석 영역이 화면 밖일 때만 내린다(표와 분석이 함께 보이는 넓은 화면에서는 움직이지 않음)
      if (el && el.getBoundingClientRect().top > window.innerHeight - 120) el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };
  const loadingName = picked && picked.group === group ? shortProgramName(picked.name) : stale ? shortProgramName(stale.work.displayName) : null;

  return (
    <div className="mx-auto w-full min-w-0 max-w-screen-xl px-4 py-5 sm:px-6">
      <h1 className="mb-3 text-[20px] font-bold text-zinc-900">프로그램 성과</h1>

      <section className="rounded-lg border border-zinc-200 bg-white p-3">
        <ProgramSearch initialQuery={view.group ? "" : view.q} hasSelection={Boolean(group)} onPick={pick} />
      </section>

      {group && (
        <section className="mt-3 space-y-2 text-[12px]">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <PeriodControl preset={preset} from={from} to={to} period={result?.period ?? null} dim={Boolean(stale)} onPreset={(p) => nav({ preset: p, from: null, to: null })} onCustom={(f, t) => nav({ preset: "custom", from: f, to: t })} />
            <div className="flex flex-wrap items-center gap-1" role="group" aria-label="방송 구분">
              {(Object.keys(AIRING_LABEL) as AiringFilter[]).map((a) => (
                <button key={a} type="button" aria-pressed={airing === a} onClick={() => nav({ airing: a })} className={chip(airing === a)}>
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
                    <input type="checkbox" checked={channels.length === 0} onChange={() => nav({ channels: [] })} />
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
                  <select value={targetMode} onChange={(e) => nav({ target: e.target.value as TargetMode })} className="w-full rounded border border-zinc-300 px-1.5 py-0.5 text-[16px] sm:text-[12px]">
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
        </section>
      )}

      {fetchError && (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-md bg-rose-50 px-3 py-2 text-[13px] text-rose-700" role="alert">
          <span>{fetchError}</span>
          <button type="button" onClick={retryFetch} className="rounded px-2 py-0.5 font-medium ring-1 ring-rose-300 hover:bg-rose-100">
            다시 시도
          </button>
        </div>
      )}
      {loading && (
        <p className="mt-4 flex items-center gap-2 text-[13px] text-zinc-600" role="status">
          <Spinner />
          {loadingName ? `‘${loadingName}’ ` : ""}채널별 성과를 계산하는 중…{stale ? " (아래는 직전 조건의 결과)" : ""}
        </p>
      )}

      {result && (
        <section className={`mt-4 transition-opacity ${stale ? "pointer-events-none opacity-40" : ""}`} aria-live="polite" aria-busy={loading}>
          {/* 제목 | 종합 리뷰 — 넓은 화면은 나란히, 좁은 화면은 위아래(사용자 지시 2026-10-23: 표 위 빈 자리에서 한눈에) */}
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
            <div className="min-w-0 lg:max-w-[22rem] lg:shrink-0">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <h2 className="min-w-0 break-words text-[18px] font-bold text-zinc-900">{shortProgramName(result.work.displayName)}</h2>
                <ClassBadge cls={result.classification.cls} />
                <span className="text-[13px] text-zinc-500">
                  {result.totals.channels}개 채널 · {formatInt(result.totals.airings)}회 방영
                </span>
              </div>
              {result.pattern && <PatternLine pattern={result.pattern} result={result} />}
              {visibleNotes.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-[12px] text-zinc-500">
                  {visibleNotes.map((n, i) => (
                    <li key={i}>※ {n}</li>
                  ))}
                </ul>
              )}
            </div>
            {result.review && result.review.sentences.length > 0 && <ReviewText review={result.review} />}
          </div>

          {entries.length > 0 ? (
            <ChannelTable entries={entries} airing={result.query.airing} selected={selRow ? rowKey(selRow) : null} onSelect={select} simulcast={simShown} />
          ) : (
            <p className="mt-4 text-[13px] text-zinc-500">{competitorRows.length > 0 ? "자사 방영 기록은 없습니다. 아래 경쟁 채널 성과를 확인하세요." : "이 조건의 방영 기록이 없습니다. 기간을 ‘전체 기간’으로 넓히거나 방송 구분을 ‘전체 방송’으로 바꿔 보세요."}</p>
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
          <div ref={analysisRef} className="scroll-mt-4">
            {selRow && <Analysis key={`${requestUrl}|${rowKey(selRow)}`} row={selRow} result={result} siblings={selectable.filter((r) => r.channelCode === selRow.channelCode)} onSelect={(r) => group && setSel({ group, key: rowKey(r) })} />}
          </div>
          {competitorRows.length > 0 && (
            <div className="mt-4">
              {/* 자사 방영이 없는 작품은 경쟁 채널 성과가 유일한 내용이라 처음부터 펼쳐 둔다(사용자 지시 2026-10-23) */}
              {entries.length > 0 && (
                <button type="button" aria-expanded={showComp} onClick={() => setCompFor(showComp ? null : group)} className={chip(showComp)}>
                  경쟁 채널 성과 {showComp ? "닫기" : `보기 · ${new Set(competitorRows.map((c) => c.competitorName)).size}개 채널`}
                </button>
              )}
              {(showComp || entries.length === 0) && <CompetitorSection rows={competitorRows} />}
            </div>
          )}
          <CalcBasis />
        </section>
      )}
    </div>
  );
}
