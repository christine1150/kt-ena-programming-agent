"use client";

// 프로그램 성과 화면 — 검색·필터·표시만 한다. 모든 수치(평균·배율·증감·표본·상태·월간 추이)는 /api/program-performance가 서버에서 확정해 준 값이다.
// 화면·문구 수정 지시(2026-10-22): 첫 화면은 "어느 채널에서 채널 평균보다 잘 나오나"와 "월별로 어떻게 달라졌나"만 답한다.
//  - 채널별 비교표 4열(채널·작품 시청률·채널 평균·채널 평균 대비), 표본이 적은 채널만 채널명 아래 일수 표시, 비교 제외 채널은 표 아래 따로.
//  - 월별 추이는 월 × (작품 시청률·채널 평균·채널 평균 대비) 숫자 표 하나.
//  - 근거(방송 구분별 성과·같은 시간대 대비·집계 기준·방송 기록)는 채널을 하나 골라 여는 채널 상세에서. 최근 12주 편성 진단은 조회 기간 성과와 섞지 않고 독립 영역.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { formatDecimal, formatInt, formatRatingValue, formatSigned, MISSING } from "@/lib/ui/metricFormat";
import { TAG_DOT_COLOR, TAG_LABEL_KO, type ActionTag } from "@/lib/actionTags";
import { WORK_CLASS_LABEL } from "@/lib/programPerformance/metrics";
import type { AiringFilter, ChannelRow, Direction, MonthlyPoint, PerformanceResult, RatioValue, SearchItem, TargetMode, WorkClass } from "@/lib/programPerformance/types";

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
const TARGET_LABEL: Record<TargetMode, string> = { kpi: "채널별 KPI", common2049: "공통: 수도권 2049", commonHH: "공통: 전국 유료가구" };
const AIRING_LABEL: Record<AiringFilter, string> = { all: "전체 방송", first: "본방", rerun: "본방 외" };
const AIRING_HELP: Record<AiringFilter, string> = {
  all: "",
  first: "본방: 원본 자료에 본방 표시가 있는 방영(현재 ENA만 표시)",
  rerun: "본방 외: 확인된 재방과 본방 여부가 확인되지 않은 기록을 함께 포함",
};
const DIR_CLASS: Record<Direction, string> = { HIGHER: "text-emerald-700", SIMILAR: "text-zinc-700", LOWER: "text-rose-700", NA: "text-zinc-400" };
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

function ClassBadge({ cls }: { cls: WorkClass }) {
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
  if (r.status === "NO_PROGRAM_DATA") return "프로그램 자료 없음";
  if (r.status === "OBSERVED") return airing === "first" ? "본방 없음" : "본방 외 방영 없음";
  return "이 기간 방영 없음";
}

function ChannelTable({ rows, title, airing, focus, selected, onSelect }: { rows: ChannelRow[]; title: string; airing: AiringFilter; focus: string | null; selected: string | null; onSelect: (code: string) => void }) {
  return (
    <section className="mt-4">
      <h3 className="mb-1.5 text-[14px] font-semibold text-zinc-800">{title}</h3>
      <div className="dense-grid overflow-x-auto rounded-lg border border-zinc-200 bg-white" tabIndex={0} role="region" aria-label={`${title} 채널별 비교 표`}>
        <table className="w-full text-[14px]">
          <thead className="bg-zinc-50 text-[12px] text-zinc-500">
            <tr>
              <th className="px-2 py-2 text-left font-medium sm:px-3">채널</th>
              <th className="px-2 py-2 text-right font-medium sm:px-3">
                <span className="sm:hidden">작품(%)</span>
                <span className="hidden sm:inline">작품 시청률(%)</span>
              </th>
              <th className="px-2 py-2 text-right font-medium sm:px-3">
                <span className="sm:hidden">채널(%)</span>
                <span className="hidden sm:inline">채널 평균(%)</span>
              </th>
              <th className="px-2 py-2 text-right font-medium sm:px-3">
                <span className="sm:hidden">대비</span>
                <span className="hidden sm:inline">채널 평균 대비</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const observed = r.status === "OBSERVED" && r.airings > 0;
              const sample = observed ? sampleText(r) : null;
              const isSel = selected === r.channelCode;
              return (
                <tr key={r.channelCode} className={`border-t border-zinc-100 ${isSel ? "bg-sky-50" : focus === r.channelCode ? "bg-sky-50/40" : ""}`}>
                  <td className="px-2 py-2 sm:px-3">
                    <button type="button" onClick={() => onSelect(r.channelCode)} aria-pressed={isSel} className="text-left font-medium text-zinc-900 underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-600" aria-label={`${r.channelName} 채널 상세 열기`}>
                      {r.channelName}
                    </button>
                    {sample && (
                      <span className={`ml-1 whitespace-nowrap text-[11px] ${r.sampleState === "NONE" ? "text-rose-700" : "text-amber-700"}`} title={`${sample} — 집계 방송일이 ${r.sampleState === "NONE" ? "3" : "8"}일 미만`} aria-label={sample}>
                        ({r.days}일)
                      </span>
                    )}
                  </td>
                  {observed ? (
                    <td className="px-2 py-2 sm:px-3 text-right font-semibold tabular-nums">{formatRatingValue(r.programAvg, r.channelCode)}</td>
                  ) : (
                    <td className="px-2 py-2 sm:px-3 text-right text-[12px] text-zinc-500">{emptyText(r, airing)}</td>
                  )}
                  <td className="px-2 py-2 sm:px-3 text-right tabular-nums">{formatRatingValue(r.channelDaily?.mean ?? null, r.channelCode)}</td>
                  <td className="px-2 py-2 sm:px-3 text-right">{observed ? <DeltaText r={r.vsChannel} /> : <span className="text-zinc-300">{MISSING}</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const monthTitle = (m: MonthlyPoint) => `${Number(m.month.slice(5))}월${m.partial ? ` ${Number(m.from.slice(8))}~${Number(m.to.slice(8))}일` : ""}`;

function MonthCell({ m, kind, code }: { m: MonthlyPoint; kind: "program" | "channel" | "delta"; code: string }) {
  if (kind === "channel") {
    if (m.channelAvg === null) return <span className="text-zinc-400">자료 없음</span>;
    return (
      <span className="tabular-nums">
        {formatRatingValue(m.channelAvg, code)}
        {m.channelValidDays < m.periodDays && <span className="ml-1 text-[11px] text-amber-700">({m.channelValidDays}/{m.periodDays}일)</span>}
      </span>
    );
  }
  if (m.airings === 0) return <span className="text-zinc-400">방영 없음</span>;
  if (kind === "program") return m.programAvg === null ? <span className="text-zinc-400">자료 없음</span> : <span className="font-semibold tabular-nums">{formatRatingValue(m.programAvg, code)}</span>;
  return <DeltaText r={m.vsChannel} />;
}

const MONTH_ROWS: { kind: "program" | "channel" | "delta"; label: string }[] = [
  { kind: "program", label: "작품 시청률(%)" },
  { kind: "channel", label: "채널 평균(%)" },
  { kind: "delta", label: "채널 평균 대비" },
];

/** 월별 추이 — 월 × 3행 숫자 표(좁은 화면은 월을 행으로). 일부 기간만 들어간 달은 제목에 날짜 범위. */
function MonthlyTrend({ rows, channel, onChannel }: { rows: ChannelRow[]; channel: string | null; onChannel: (code: string) => void }) {
  const candidates = rows.filter((r) => r.monthly.some((m) => m.airings > 0));
  const current = candidates.find((r) => r.channelCode === channel) ?? candidates[0];
  if (!current) return null;
  const months = current.monthly;
  const code = current.channelCode;
  return (
    <section className="mt-7">
      <h3 className="text-[14px] font-semibold text-zinc-800">월별 추이</h3>
      <div className="mt-1.5 flex flex-wrap gap-1 text-[12px]" role="group" aria-label="월별 추이 채널">
        {candidates.map((r) => (
          <button key={r.channelCode} type="button" aria-pressed={r.channelCode === code} onClick={() => onChannel(r.channelCode)} className={chip(r.channelCode === code)}>
            {r.channelName}
          </button>
        ))}
      </div>
      <div className="dense-grid mt-2 hidden overflow-x-auto rounded-lg border border-zinc-200 bg-white sm:block" tabIndex={0} role="region" aria-label={`${current.channelName} 월별 추이`}>
        <table className="w-full text-[14px]">
          <thead className="bg-zinc-50 text-[12px] text-zinc-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium">{current.targetLabel}</th>
              {months.map((m) => (
                <th key={m.month} className="px-3 py-2 text-right font-medium">
                  {monthTitle(m)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MONTH_ROWS.map((row) => (
              <tr key={row.kind} className="border-t border-zinc-100">
                <th scope="row" className="px-3 py-2 text-left text-[13px] font-medium text-zinc-600">
                  {row.label}
                </th>
                {months.map((m) => (
                  <td key={m.month} className="px-3 py-2 text-right">
                    <MonthCell m={m} kind={row.kind} code={code} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* 좁은 화면: 월을 행으로 */}
      <div className="mt-2 overflow-hidden rounded-lg border border-zinc-200 bg-white sm:hidden">
        <table className="w-full text-[14px]" aria-label={`${current.channelName} 월별 추이`}>
          <thead className="bg-zinc-50 text-[12px] text-zinc-500">
            <tr>
              <th className="px-2.5 py-2 text-left font-medium">월</th>
              <th className="px-2.5 py-2 text-right font-medium">작품(%)</th>
              <th className="px-2.5 py-2 text-right font-medium">채널(%)</th>
              <th className="px-2.5 py-2 text-right font-medium">대비</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={m.month} className="border-t border-zinc-100">
                <th scope="row" className="px-2.5 py-2 text-left text-[13px] font-medium">
                  {monthTitle(m)}
                </th>
                {MONTH_ROWS.map((row) => (
                  <td key={row.kind} className="px-2.5 py-2 text-right">
                    <MonthCell m={m} kind={row.kind} code={code} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Fold({ title, children, defaultOpen }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="mt-2 rounded-md border border-zinc-200" open={defaultOpen}>
      <summary className="cursor-pointer px-3 py-2 text-[13px] font-medium text-zinc-700">{title}</summary>
      <div className="dense-grid overflow-x-auto border-t border-zinc-100 px-3 py-2">{children}</div>
    </details>
  );
}

function Fact({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-t border-zinc-100 py-1.5 first:border-t-0">
      <dt className="text-zinc-500">{k}</dt>
      <dd className="text-right tabular-nums text-zinc-900">{v}</dd>
    </div>
  );
}

/** 채널 상세 — 선택한 채널 하나의 근거. 조회 기간 성과(위 세 블록)와 최근 12주 편성 진단(아래 독립 영역)은 값·표본을 공유하지 않는다. */
function ChannelDetail({ row, result, onClose }: { row: ChannelRow; result: PerformanceResult; onClose: () => void }) {
  const code = row.channelCode;
  const airings = result.airings.filter((a) => a.channelCode === code);
  const cells = result.slotCells.filter((c) => c.channelCode === code).sort((a, b) => b.airings - a.airings || a.dow - b.dow || a.hourBlock - b.hourBlock);
  const splits = [
    { label: "본방", s: row.firstRun },
    { label: "확인된 재방", s: row.rerun },
    { label: "본방 여부 미확인", s: row.unknownRun },
  ].filter((x) => x.s.airings > 0);
  const observed = row.status === "OBSERVED";
  const cd = row.channelDaily;
  return (
    <section id="channel-detail" className="mt-7 rounded-lg border border-zinc-300 bg-white p-4" aria-label={`${row.channelName} 채널 상세`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold text-zinc-900">
          채널 상세 · {row.channelName} <span className="text-[12px] font-normal text-zinc-500">{row.targetLabel}</span>
        </h3>
        <button type="button" onClick={onClose} className="rounded px-2 py-1 text-[12px] text-zinc-500 ring-1 ring-zinc-200 hover:bg-zinc-50">
          닫기
        </button>
      </div>

      {!observed ? (
        <p className="mt-2 text-[13px] text-zinc-600">{row.statusNote || "이 조건의 방영 기록이 없습니다."}</p>
      ) : (
        <div className="mt-3 grid gap-4 lg:grid-cols-3">
          <div>
            <h4 className="mb-1 text-[13px] font-semibold text-zinc-700">방송 구분별 성과</h4>
            {splits.length === 0 ? (
              <p className="text-[12px] text-zinc-500">방영 기록 없음</p>
            ) : (
              <table className="w-full text-[13px]">
                <thead className="text-[12px] text-zinc-500">
                  <tr>
                    <th className="py-1 text-left font-medium">구분</th>
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
            <p className="mt-1 text-[11px] text-zinc-500">조회 기간 전체 방영 기준(방송 구분 선택과 무관)</p>
          </div>

          <div>
            <h4 className="mb-1 text-[13px] font-semibold text-zinc-700">같은 시간대 대비</h4>
            {row.slot && row.slot.airingsUsed > 0 ? (
              <dl className="text-[13px]">
                <Fact k="같은 시간대 다른 프로그램 대비" v={<DeltaText r={row.slot.ratio} />} />
                <Fact k="배율" v={row.slot.ratio.ratio === null ? MISSING : `${formatDecimal(row.slot.ratio.ratio, 2)}배`} />
                <Fact k="비교 기간" v={`${row.slot.windowFrom} ~ ${row.slot.windowTo}`} />
                <Fact k="작품 방영 / 비교 방송" v={`${formatInt(row.slot.airingsUsed)}회 / ${formatInt(row.slot.comparisonAirings)}건`} />
              </dl>
            ) : (
              <p className="text-[12px] text-zinc-500">{row.slot?.ratio.naReason ?? "비교할 방영 없음"}</p>
            )}
          </div>

          <div>
            <h4 className="mb-1 text-[13px] font-semibold text-zinc-700">집계 기준</h4>
            <dl className="text-[13px]">
              <Fact k="집계 방송일" v={`${row.days}일`} />
              <Fact k="방영 횟수" v={`${formatInt(row.airings)}회`} />
              <Fact k="회차" v={row.episodes ? `${row.episodes}개` : "회차 정보 없음"} />
              <Fact k="작품 방영 기간" v={row.observedFrom ? `${row.observedFrom} ~ ${row.observedTo}` : MISSING} />
              <Fact k="채널 평균 자료" v={cd ? `${cd.validDays}/${cd.periodDays}일${cd.conflictDays ? ` · 정정 ${cd.conflictDays}일` : ""}` : MISSING} />
              <Fact k="채널 평균 대비 배율" v={row.vsChannel.ratio === null ? (row.vsChannel.naReason ?? MISSING) : `${formatDecimal(row.vsChannel.ratio, 2)}배`} />
            </dl>
          </div>
        </div>
      )}

      {observed && (
        <Fold title={`방송 기록 ${airings.length}건`}>
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
          {result.airingsTruncated && <p className="mt-1 text-[11px] text-zinc-500">기록이 많아 일부만 표시(평균 계산에는 전부 포함).</p>}
          {cells.length > 0 && (
            <Fold title="요일·시간대별 작품 평균">
              <table className="w-full min-w-[280px] text-[12px]">
                <thead className="text-zinc-500">
                  <tr>
                    <th className="py-1 text-left font-medium">요일·시</th>
                    <th className="py-1 text-right font-medium">방영</th>
                    <th className="py-1 text-right font-medium">평균(%)</th>
                  </tr>
                </thead>
                <tbody>
                  {cells.map((c, i) => (
                    <tr key={i} className="border-t border-zinc-100">
                      <td className="py-1">
                        {DOW[c.dow]} {c.hourBlock}시
                      </td>
                      <td className="py-1 text-right tabular-nums">{c.airings}</td>
                      <td className="py-1 text-right tabular-nums">{formatRatingValue(c.avg, code)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Fold>
          )}
        </Fold>
      )}

      <div className="mt-4 rounded-md bg-zinc-50 p-3">
        <h4 className="text-[13px] font-semibold text-zinc-700">최근 12주 편성 진단</h4>
        <TwelveWeek row={row} />
      </div>
    </section>
  );
}

/** 최근 12주 편성 진단 — 콘텐츠 적합도 결과를 그 자체의 평가 기간·표본으로만 보여 준다(조회 기간 표본 경고를 섞지 않음). */
function TwelveWeek({ row }: { row: ChannelRow }) {
  const f = row.fit;
  if (!f) return <p className="mt-1 text-[12px] text-zinc-500">채널별 KPI 타깃에서만 제공합니다.</p>;
  const tag = f.tag as ActionTag | null;
  return (
    <dl className="mt-1 text-[13px]">
      <Fact
        k="진단"
        v={
          tag ? (
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: TAG_DOT_COLOR[tag] }} aria-hidden />
              {TAG_LABEL_KO[tag]}
              {f.tier !== "FORMAL" && <span className="text-[11px] text-zinc-500">(참고)</span>}
            </span>
          ) : f.tier === "HOLD" ? (
            "판단 보류"
          ) : (
            "최근 12주 방영 없음"
          )
        }
      />
      <Fact k="평가 기간" v={`${f.windowFrom} ~ ${f.asOf}`} />
      <Fact k="평가 표본" v={`${f.sampleDays}일`} />
      {f.note && <Fact k="기준 작품" v={f.note} />}
    </dl>
  );
}

function CalcBasis() {
  return (
    <details className="mt-2 text-[12px]">
      <summary className="inline-block cursor-pointer rounded px-2 py-1 text-zinc-600 ring-1 ring-zinc-200 hover:bg-zinc-50">계산 기준</summary>
      <dl className="mt-2 space-y-1.5 rounded-md bg-zinc-50 p-3 text-zinc-700">
        <div>
          <dt className="font-medium">작품 시청률</dt>
          <dd>선택한 기간·방송 구분에서 작품 방영 한 건마다의 시청률을 산술평균(방송시간 가중 아님). 같은 방영이 두 번 적재돼도 한 번만 셉니다.</dd>
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
          <dd>같은 채널·기간에서 같은 요일·시간대 다른 프로그램 평균과 비교(표본이 적으면 1배 쪽으로 보정, 콘텐츠 적합도와 같은 기준). 채널 상세에서 확인합니다.</dd>
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
  const [targetMode, setTargetMode] = useState<TargetMode>("kpi");
  const [airing, setAiring] = useState<AiringFilter>("all");
  const [fetched, setFetched] = useState<{ url: string; result: PerformanceResult | null; error: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 최신 자료일은 직전 응답에서 알게 된 값(기간 프리셋 계산용)
  const [latest, setLatest] = useState<string | null>(null);
  // 월별 추이 채널(기본: 진입 채널) / 채널 상세(사용자가 고를 때만 연다)
  const [trendChannel, setTrendChannel] = useState<string | null>(focusChannel);
  const [detailChannel, setDetailChannel] = useState<string | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  // 검색·분류 선택은 작품 선택을 풀고 후보 목록만 보여 준다(이전 작품 상세와 새 후보가 섞이지 않게)
  const search = useCallback(
    async (text: string, f: ClassFilter) => {
      setGroup(null);
      setDetailChannel(null);
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
  const comparable = allRows.filter((r) => !EXCLUDED.includes(r.status));
  const excluded = allRows.filter((r) => EXCLUDED.includes(r.status));
  const detailRow = comparable.find((r) => r.channelCode === detailChannel) ?? null;
  const openDetail = (code: string) => {
    setDetailChannel(code);
    setTrendChannel(code);
    requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const groupTitle = (g: "2049" | "HH") => (targetMode === "kpi" ? (g === "2049" ? "수도권 2049" : "전국 유료가구") : g === "2049" ? "수도권 2049 (공통 타깃)" : "전국 유료가구 (공통 타깃)");

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
                비교 설정{channels.length || targetMode !== "kpi" ? " · 변경됨" : ""} ▾
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
          {result.notes.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-[12px] text-amber-800">
              {result.notes.map((n, i) => (
                <li key={i}>※ {n}</li>
              ))}
            </ul>
          )}

          {result.groups.map((g) => {
            const rows = g.rows.filter((r) => !EXCLUDED.includes(r.status));
            return rows.length ? <ChannelTable key={g.kpiGroup} rows={rows} title={groupTitle(g.kpiGroup)} airing={result.query.airing} focus={focusChannel} selected={detailChannel} onSelect={openDetail} /> : null;
          })}
          {excluded.length > 0 &&
            (comparable.length === 0 ? (
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
          <CalcBasis />

          <MonthlyTrend rows={comparable} channel={trendChannel} onChannel={setTrendChannel} />

          <div ref={detailRef} className="scroll-mt-4">
            {detailRow ? (
              <ChannelDetail key={detailRow.channelCode} row={detailRow} result={result} onClose={() => setDetailChannel(null)} />
            ) : (
              comparable.length > 0 && (
                <section className="mt-7">
                  <h3 className="text-[14px] font-semibold text-zinc-800">채널 상세</h3>
                  <p className="mt-0.5 text-[12px] text-zinc-500">같은 시간대 대비·방송 구분별 성과·방송 기록·최근 12주 편성 진단</p>
                  <div className="mt-1.5 flex flex-wrap gap-1 text-[12px]" role="group" aria-label="채널 상세 열기">
                    {comparable.map((r) => (
                      <button key={r.channelCode} type="button" onClick={() => openDetail(r.channelCode)} className={chip(false)}>
                        {r.channelName}
                      </button>
                    ))}
                  </div>
                </section>
              )
            )}
          </div>
        </section>
      )}
    </div>
  );
}
