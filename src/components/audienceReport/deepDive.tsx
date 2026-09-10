"use client";

// W절(2026-09-10) — 채널별 기간 심층 분석 블록의 화면 렌더러.
// 데이터 계층(dataCollector)·분석 엔진(deepDiveAnalyzer)·문서 출력(reportFlatten)은 이미 끝나
// 있고 이 파일은 화면만 담당한다 — 여기서 수치를 새로 계산하지 않고 DeepDiveSection에 담겨 온
// 값을 고르고 배치하기만 한다(CLAUDE.md "DB/Analytics Layer = Source of Truth").
//
// 섹션 순서는 문서(reportFlatten.ts)와 같다 — "무엇이 잘됐나 → 왜 → 무엇을 바꿔야 하나".
// 탭으로 쪼개지 않고 한 페이지 스크롤을 유지한다(사용자 명시 요구). 03의 확장 행은 탭이 아니라
// 표 안에서 한 번에 하나만 펼쳐지는 상세 행이다(ChannelDeepDive.tsx의 expandedProgram과 같은 패턴).
import { Fragment, useState, type ReactNode } from "react";
import type { ChartCaptionInfo, DeepDiveNotice, DeepDiveSection, Maybe } from "@/lib/audienceReport/reportModel";
import type {
  DowHourCell,
  EfficiencyRow,
  FirstRunInsight,
  HourPoint,
  MoveCandidate,
  OriginalRerunInsight,
  PrimeGapRow,
  ProgramProfile,
  QuadrantRow,
  SlotRelativeRow,
  TargetIndexPoint,
} from "@/lib/audienceReport/deepDiveAnalyzer";
import { TARGET_INDEX_STRONG, TARGET_INDEX_WEAK } from "@/lib/audienceReport/deepDiveAnalyzer";
import { ChartCaption, H, PAD, scaleLinear, yDomainFrom } from "@/components/audienceReport/charts";
import { formatPercent, formatRating } from "@/lib/audienceReport/format";

// page.tsx의 Section/Unavailable/WithMaybe와 같은 마크업이다 — page.tsx는 Next.js 페이지 파일이라
// 거기서 가져오면 순환 참조(page → deepDive → page)가 되므로 같은 클래스로 복제했다(새 패턴 아님).
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-neutral-200 py-6 dark:border-neutral-800">
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Unavailable({ reason }: { reason: string }) {
  return <p className="rounded bg-neutral-100 p-3 text-sm text-neutral-500 dark:bg-neutral-900">데이터 없음 — {reason}</p>;
}

function WithMaybe<T>({ maybe, render }: { maybe: Maybe<T>; render: (data: T) => ReactNode }) {
  return maybe.available ? <>{render(maybe.data)}</> : <Unavailable reason={maybe.reason} />;
}

// 이 프로젝트 차트의 기존 색(charts.tsx) 그대로 — 새 팔레트를 만들지 않는다.
const C_STRONG = "#3a30df"; // 브랜드 강조
const C_MID = "#7b74ea";
const C_LIGHT = "#c5c2ee";
const C_WARN = "#be123c"; // 경고(기존 델타 하락색)
const C_PRIME = "#fef3c7"; // 주요시간 음영(amber-100)
const C_PRIME_LINE = "#d97706"; // 주요시간 테두리(amber-600)

// 2단 그리드 한 칸의 실제 폭이 350px 안팎이라, 공용 W(640) viewBox를 쓰면 글자가 절반 크기로
// 줄어 읽히지 않는다 — 높이(H)와 여백(PAD)은 공용 값을 그대로 쓰고 폭만 좁힌다.
const SUB_W = 320;

export function DeepDiveView({ deep, channelCode }: { deep: DeepDiveSection; channelCode: string }) {
  return (
    <>
      <Section title="심층 분석 — 분석 기준">
        <NoticeBanner notice={deep.notice} />
      </Section>

      <Section title="심층 01 회당 성과가 높은 프로그램">
        <WithMaybe maybe={deep.efficiencyRanking} render={(d) => <EfficiencyView data={d} channelCode={channelCode} />} />
      </Section>

      <Section title="심층 01b 저시청 시간대(02~08시) 주목 콘텐츠">
        <WithMaybe maybe={deep.lowSlotStandouts} render={(d) => <LowSlotView rows={d.rows} caption={d.caption} />} />
      </Section>

      <Section title="심층 02 주요시간이 만든 차이">
        <WithMaybe maybe={deep.primeGap} render={(d) => <PrimeGapView data={d} channelCode={channelCode} />} />
      </Section>

      <Section title="심층 03 프로그램별 시간대·타깃 프로파일">
        <WithMaybe maybe={deep.programProfiles} render={(d) => <ProgramProfilesView programs={d.programs} caption={d.caption} channelCode={channelCode} />} />
      </Section>

      <Section title="심층 04 요일 × 시간대 편성 배분과 성과">
        <WithMaybe maybe={deep.scheduleCanvas} render={(d) => <ScheduleCanvasView data={d} channelCode={channelCode} />} />
      </Section>

      <Section title="심층 05 오리지널 본방·재방 확산">
        <WithMaybe maybe={deep.originalRerun} render={(rows) => <OriginalRerunView rows={rows} channelCode={channelCode} />} />
      </Section>

      <Section title="심층 06 본방(<본>) vs 본방 외 효율">
        <WithMaybe maybe={deep.firstRunEfficiency} render={(rows) => <FirstRunView rows={rows} channelCode={channelCode} />} />
      </Section>
    </>
  );
}

// ── 머리말 ────────────────────────────────────────────────────────────────────
// 주요시간이 요일에 따라 달라지므로(평일 19~23시 / 토·일·공휴일 18~23시) 이 고지가 없으면
// 아래 모든 격차 수치가 오독된다 — 그래서 차트·표 없이 기준만 먼저 못 박는다.
function NoticeBanner({ notice }: { notice: DeepDiveNotice }) {
  return (
    <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
      <ul className="space-y-1">
        <li>
          <span className="font-medium">주요시간 기준</span> — {notice.primeLabel}
        </li>
        <li>
          <span className="font-medium">기간 내 공휴일</span> —{" "}
          {notice.holidays.length === 0 ? (
            "공휴일 없음"
          ) : (
            <>
              {notice.holidays.length}일({notice.holidays.map((h) => `${h.date} ${h.name}`).join(", ")}) · 해당 일자는 주말 기준 주요시간이 적용됨
            </>
          )}
        </li>
        <li>
          <span className="font-medium">분석 대상</span> — 프로그램 {notice.programCount}편 · 편성 {notice.airings}회
        </li>
        <li>
          <span className="font-medium">제외 기준</span> — 회당 성과 비교에서 편성 {notice.minAiringsForRanking}회 미만은 제외함(1~2회 편성은 극단값을 만들어 순위를 지배함)
        </li>
      </ul>
    </div>
  );
}

// ── 심층 01 회당 성과가 높은 프로그램 ─────────────────────────────────────────
function TypeBadge({ type }: { type: EfficiencyRow["programType"] }) {
  // 총량형=회색(편성 물량으로 번 것) / 효율형=강조색(회당 성과로 번 것) / 균형형=옅은색.
  const cls =
    type === "효율형" ? "text-white" : type === "총량형" ? "bg-neutral-200 text-neutral-700" : "bg-indigo-50 text-indigo-500";
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${cls}`} style={type === "효율형" ? { backgroundColor: C_STRONG } : undefined}>
      {type}
    </span>
  );
}

function EfficiencyView({
  data,
  channelCode,
}: {
  data: { rows: EfficiencyRow[]; channelAvgRating: number | null; caption: ChartCaptionInfo };
  channelCode: string;
}) {
  return (
    <div>
      <p className="mb-3 text-xs text-neutral-600">
        채널 회당 평균 {formatRating(data.channelAvgRating, channelCode)} — &lsquo;채널 대비&rsquo;가 100%를 넘으면 채널 평균을 상회함.
      </p>

      {/* 누적 가로 막대 — 세 백분위를 각각 1/3씩 실어 막대 총길이가 곧 복합 지수(efficiencyIndex)가 된다. */}
      <div className="space-y-2.5">
        {data.rows.map((r) => (
          <div key={r.canonicalName}>
            <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <span className="font-medium">{r.canonicalName}</span>
              <span className="tabular-nums text-neutral-500">
                {r.airings}회 · 회당 {formatRating(r.avgRating, channelCode)}
              </span>
              <span className="ml-auto flex flex-wrap items-center gap-1">
                {r.compensatingMetrics.length > 0 && (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800" title="시청률은 채널 평균 이하지만 이 지표는 채널 평균을 넘음">
                    ⚑ {r.compensatingMetrics.join("·")}
                  </span>
                )}
                <TypeBadge type={r.programType} />
                <span className="tabular-nums text-neutral-500">지수 {r.efficiencyIndex}</span>
              </span>
            </div>
            <div
              className="flex h-3 w-full overflow-hidden rounded bg-neutral-100"
              title={`백분위 — 시청률 ${r.ratingEfficiencyPctl} · 도달율 ${r.reachPctl} · 시청시간 비율 ${r.timeSpentSharePctl}`}
            >
              <div style={{ width: `${r.ratingEfficiencyPctl / 3}%`, backgroundColor: C_STRONG }} />
              <div style={{ width: `${r.reachPctl / 3}%`, backgroundColor: C_MID }} />
              <div style={{ width: `${r.timeSpentSharePctl / 3}%`, backgroundColor: C_LIGHT }} />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-neutral-500">
        <span>
          <span className="mr-1 inline-block h-2 w-2 align-middle rounded-sm" style={{ backgroundColor: C_STRONG }} />
          시청률 백분위
        </span>
        <span>
          <span className="mr-1 inline-block h-2 w-2 align-middle rounded-sm" style={{ backgroundColor: C_MID }} />
          도달율 백분위
        </span>
        <span>
          <span className="mr-1 inline-block h-2 w-2 align-middle rounded-sm" style={{ backgroundColor: C_LIGHT }} />
          시청시간 비율 백분위
        </span>
        <span>· 막대 총길이 = 세 백분위의 평균(복합 지수)임</span>
      </div>

      <details className="mt-3">
        <summary className="cursor-pointer text-xs text-neutral-500">수치 표 펼치기</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[600px] text-sm">
            <thead>
              <tr className="text-left text-xs text-neutral-500">
                <th className="py-1">프로그램</th>
                <th className="py-1 text-right">편성</th>
                <th className="py-1 text-right">회당 평균</th>
                <th className="py-1 text-right">채널 대비</th>
                <th className="py-1 text-right">합산 기여</th>
                <th className="py-1 text-right">물량 백분위</th>
                <th className="py-1 text-right">성과 백분위</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.canonicalName} className="border-t border-neutral-200/60 dark:border-neutral-800/60">
                  <td className="py-1">{r.canonicalName}</td>
                  <td className="py-1 text-right tabular-nums">{r.airings}회</td>
                  <td className="py-1 text-right tabular-nums">{formatRating(r.avgRating, channelCode)}</td>
                  <td className={`py-1 text-right tabular-nums ${r.aboveChannelAvg ? "font-semibold" : ""}`} style={r.aboveChannelAvg ? { color: C_STRONG } : undefined}>
                    {r.vsChannelAvgPct === null ? "—" : formatPercent(r.vsChannelAvgPct)}
                  </td>
                  <td className="py-1 text-right tabular-nums">{formatRating(r.sumRating, channelCode)}</td>
                  <td className="py-1 text-right tabular-nums">{r.airtimePctl}</td>
                  <td className="py-1 text-right tabular-nums">{r.ratingEfficiencyPctl}</td>
                </tr>
              ))}
            </tbody>
            <caption className="mt-2 text-left text-[11px] text-neutral-500">
              합산 기여는 기간 내 모든 방영분의 시청률을 그대로 더한 값이라 편성 횟수가 곱해져 있음 — 회당 평균과 함께 봐야 함.
            </caption>
          </table>
        </div>
      </details>

      <ChartCaption caption={data.caption} />
    </div>
  );
}

// ── 심층 01b 저시청 시간대 주목 콘텐츠 ────────────────────────────────────────
/** 기준선(=100) 대비 비율 셀 — 100을 넘은 값만 강조한다. */
function RatioCell({ v }: { v: number | null }) {
  const over = v !== null && v > 100;
  return (
    <td className={`py-1 text-right tabular-nums ${over ? "font-semibold" : ""}`} style={over ? { color: C_STRONG } : undefined}>
      {formatPercent(v)}
    </td>
  );
}

function LowSlotView({ rows, caption }: { rows: SlotRelativeRow[]; caption: ChartCaptionInfo }) {
  return (
    <div>
      <p className="mb-2 text-xs text-neutral-600">채널 평균이 아니라 그 프로그램이 놓인 시간대의 채널 평균과 비교한 값임.</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[600px] text-sm">
          <thead>
            <tr className="text-left text-xs text-neutral-500">
              <th className="py-1">프로그램</th>
              <th className="py-1 text-right">편성</th>
              <th className="py-1 text-right">새벽 비중</th>
              <th className="py-1 text-right">시청률</th>
              <th className="py-1 text-right">점유율</th>
              <th className="py-1 text-right">시청시간 비율</th>
              <th className="py-1">주목 지표</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.canonicalName} className="border-t border-neutral-200/60 dark:border-neutral-800/60">
                <td className="py-1">{r.canonicalName}</td>
                <td className="py-1 text-right tabular-nums">{r.airings}회</td>
                <td className="py-1 text-right tabular-nums">{formatPercent(r.lowSlotAirtimePct)}</td>
                <RatioCell v={r.slotRatingPct} />
                <RatioCell v={r.slotSharePct} />
                <RatioCell v={r.slotTimeSpentPct} />
                <td className="py-1">
                  <span className="flex flex-wrap gap-1">
                    {r.standoutMetrics.map((m) => (
                      <span key={m} className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] text-indigo-600">
                        {m}
                      </span>
                    ))}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ChartCaption caption={caption} />
    </div>
  );
}

// ── 심층 02 주요시간이 만든 차이 ──────────────────────────────────────────────
/** 배율 셀 안에 넣는 인라인 막대 — 행 높이를 늘리지 않도록 숫자와 같은 줄에 눕힌다. */
function RatioBar({ ratio, maxRatio, strong }: { ratio: number | null; maxRatio: number; strong: boolean }) {
  const width = ratio === null ? 0 : Math.max(2, Math.round((ratio / maxRatio) * 48));
  return (
    <span className="inline-flex items-center justify-end gap-1.5">
      <span className="inline-block h-1.5 rounded-sm" style={{ width: `${width}px`, backgroundColor: strong ? C_STRONG : C_LIGHT }} />
      <span className="tabular-nums">{ratio === null ? "—" : `${ratio}배`}</span>
    </span>
  );
}

function PrimeGapView({
  data,
  channelCode,
}: {
  data: { channelBaselineRatio: number | null; rows: PrimeGapRow[]; caption: ChartCaptionInfo };
  channelCode: string;
}) {
  const baseline = data.channelBaselineRatio;
  const maxRatio = Math.max(1, baseline ?? 0, ...data.rows.map((r) => r.primeRatio ?? 0));
  return (
    <div>
      <p className="mb-2 text-xs text-neutral-600">
        채널 전체의 주요시간 배율은 {baseline === null ? "—" : `${baseline}배`}임. 프로그램 배율이 이보다 높으면 그 프로그램이 주요시간에 특히 강한 것이고, 낮으면
        주요시간이라 함께 오른 수준임.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[600px] text-sm">
          <thead>
            <tr className="text-left text-xs text-neutral-500">
              <th className="py-1">프로그램</th>
              <th className="py-1 text-right">주요시간 편성</th>
              <th className="py-1 text-right">주요시간 평균</th>
              <th className="py-1 text-right">그 외 편성</th>
              <th className="py-1 text-right">그 외 평균</th>
              <th className="py-1 text-right">배율</th>
            </tr>
          </thead>
          <tbody>
            {/* 채널 기준선을 첫 행에 고정 — 프로그램 배율은 이 값과 견줘야 읽힌다. */}
            <tr className="border-t border-neutral-200/60 bg-neutral-50 font-medium dark:border-neutral-800/60">
              <td className="py-1">채널 전체(기준선)</td>
              <td className="py-1 text-right text-neutral-400">—</td>
              <td className="py-1 text-right text-neutral-400">—</td>
              <td className="py-1 text-right text-neutral-400">—</td>
              <td className="py-1 text-right text-neutral-400">—</td>
              <td className="py-1 text-right">
                <RatioBar ratio={baseline} maxRatio={maxRatio} strong={false} />
              </td>
            </tr>
            {data.rows.map((r) => (
              <tr key={r.canonicalName} className="border-t border-neutral-200/60 dark:border-neutral-800/60">
                <td className="py-1">{r.canonicalName}</td>
                {/* 표본이 한쪽으로 쏠린 행은 편성 횟수를 회색으로 눕혀 배율을 그대로 믿지 않게 한다. */}
                <td
                  className={`py-1 text-right tabular-nums ${r.sampleSkewed ? "text-neutral-400" : ""}`}
                  title={r.sampleSkewed ? "한쪽 표본이 3회 미만이거나 10배 이상 쏠려 배율을 그대로 믿기 어려움" : undefined}
                >
                  {r.primeAirings}회
                </td>
                <td className="py-1 text-right tabular-nums">{formatRating(r.primeAvgRating, channelCode)}</td>
                <td
                  className={`py-1 text-right tabular-nums ${r.sampleSkewed ? "text-neutral-400" : ""}`}
                  title={r.sampleSkewed ? "한쪽 표본이 3회 미만이거나 10배 이상 쏠려 배율을 그대로 믿기 어려움" : undefined}
                >
                  {r.offPrimeAirings}회
                </td>
                <td className="py-1 text-right tabular-nums">{formatRating(r.offPrimeAvgRating, channelCode)}</td>
                <td className="py-1 text-right">
                  <RatioBar ratio={r.primeRatio} maxRatio={maxRatio} strong={baseline !== null && r.primeRatio !== null && r.primeRatio > baseline} />
                </td>
              </tr>
            ))}
          </tbody>
          <caption className="mt-2 text-left text-[11px] text-neutral-500">편성 횟수가 회색인 행은 표본이 한쪽으로 쏠려 배율을 참고값으로만 봐야 함.</caption>
        </table>
      </div>
      <ChartCaption caption={data.caption} />
    </div>
  );
}

// ── 심층 03 프로그램별 시간대·타깃 프로파일 ───────────────────────────────────
/** 확장부 좌측 — 시간대별 세로 막대(높이=회당 평균, 막대 위=편성 횟수, 음영=주요시간). */
function HourBarChart({ points, caption, channelCode }: { points: HourPoint[]; caption: ChartCaptionInfo; channelCode: string }) {
  const sorted = [...points].sort((a, b) => a.hour - b.hour);
  if (sorted.length === 0) return <Unavailable reason="시간대별 방영 자료가 없습니다" />;
  // 막대는 0에서 시작해야 왜곡이 없으므로 공용 yDomainFrom에서 위쪽 여유값만 가져다 쓴다.
  const [, top] = yDomainFrom(sorted.map((p) => p.avgRating));
  const y = scaleLinear([0, top], [H - PAD.bottom, PAD.top]);
  const x = scaleLinear([0, Math.max(1, sorted.length - 1)], [PAD.left, SUB_W - PAD.right]);
  // 방영 시간대가 1~2개뿐인 프로그램은 slotW가 화면 폭만큼 커진다 — 막대와 음영 폭에 상한을 둬
  // 캔버스 밖으로 삐져나가거나 막대 하나가 패널을 다 덮는 것을 막는다.
  const slotW = Math.min((SUB_W - PAD.left - PAD.right) / Math.max(1, sorted.length), 40);
  const barW = slotW * 0.6;
  const labelEvery = Math.max(1, Math.ceil(sorted.length / 12));
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-neutral-500">시간대별 회당 평균</div>
      <svg viewBox={`0 0 ${SUB_W} ${H}`} className="w-full" role="img" aria-label="시간대별 회당 평균 시청률과 편성 횟수">
        {sorted.map((p, i) =>
          p.isPrime ? (
            <rect key={`prime_${p.hour}`} x={x(i) - slotW / 2} y={PAD.top} width={slotW} height={H - PAD.bottom - PAD.top} fill={C_PRIME} />
          ) : null
        )}
        <line x1={PAD.left - 4} y1={H - PAD.bottom} x2={SUB_W - PAD.right} y2={H - PAD.bottom} stroke="currentColor" strokeOpacity={0.2} />
        <text x={PAD.left - 6} y={PAD.top + 4} fontSize={8} textAnchor="end" fill="currentColor" opacity={0.6}>
          {formatRating(top, channelCode)}
        </text>
        <text x={PAD.left - 6} y={H - PAD.bottom} fontSize={8} textAnchor="end" fill="currentColor" opacity={0.6}>
          0
        </text>
        {sorted.map((p, i) => {
          if (p.avgRating === null) return null;
          const yy = y(p.avgRating);
          return (
            <g key={p.hour}>
              <rect x={x(i) - barW / 2} y={yy} width={barW} height={Math.max(0, H - PAD.bottom - yy)} fill={C_STRONG} rx={2} />
              <text x={x(i)} y={yy - 3} fontSize={8} textAnchor="middle" fill="currentColor" opacity={0.65}>
                {p.airings}
              </text>
            </g>
          );
        })}
        {sorted.map((p, i) =>
          i % labelEvery === 0 ? (
            <text key={`h_${p.hour}`} x={x(i)} y={H - 8} fontSize={9} textAnchor="middle" fill="currentColor" opacity={0.6}>
              {p.hour}시
            </text>
          ) : null
        )}
      </svg>
      <div className="text-[11px] text-neutral-500">막대 위 숫자 = 편성 횟수 · 음영 구간 = 주요시간임</div>
      <ChartCaption caption={caption} />
    </div>
  );
}

/** 확장부 우측 — 타깃 지수 가로 막대(채널 동일 연령대 평균 = 100 기준선). */
function TargetIndexChart({ points, caption }: { points: TargetIndexPoint[]; caption: ChartCaptionInfo }) {
  const rows = [...points].sort((a, b) => (b.index ?? 0) - (a.index ?? 0));
  if (rows.length === 0) return <Unavailable reason="타깃 분해 자료가 없습니다" />;
  const rowH = 16;
  const chartH = PAD.top + rowH * rows.length + PAD.bottom;
  const maxIndex = Math.max(TARGET_INDEX_STRONG + 20, ...rows.map((r) => r.index ?? 0));
  // 오른쪽 18px는 막대 끝에 붙는 지수 숫자 자리로 비워 둔다 — 가장 긴 막대의 값이 잘리지 않게.
  const x = scaleLinear([0, maxIndex], [PAD.left, SUB_W - PAD.right - 18]);
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-neutral-500">타깃별 지수(채널 평균 100)</div>
      <svg viewBox={`0 0 ${SUB_W} ${chartH}`} className="w-full" role="img" aria-label="타깃별 채널 평균 대비 지수">
        {rows.map((t, i) => {
          const yy = PAD.top + i * rowH;
          const idx = t.index;
          const color = idx === null ? C_LIGHT : idx >= TARGET_INDEX_STRONG ? C_STRONG : idx <= TARGET_INDEX_WEAK ? C_WARN : C_MID;
          const barEnd = idx === null ? PAD.left : x(Math.min(idx, maxIndex));
          return (
            <g key={t.demographicLabel}>
              <text x={PAD.left - 4} y={yy + rowH - 5} fontSize={9} textAnchor="end" fill="currentColor" opacity={0.75}>
                {t.demographicLabel}
              </text>
              {idx !== null && <rect x={PAD.left} y={yy + 3} width={Math.max(1, barEnd - PAD.left)} height={rowH - 7} fill={color} rx={2} />}
              <text x={Math.min(barEnd + 3, SUB_W - 4)} y={yy + rowH - 5} fontSize={8} textAnchor="start" fill="currentColor" opacity={0.7}>
                {idx ?? "—"}
              </text>
            </g>
          );
        })}
        {/* 100 기준선은 실선 — 이 선을 넘었는지가 판정의 전부다. */}
        <line x1={x(100)} y1={PAD.top - 2} x2={x(100)} y2={chartH - PAD.bottom + 4} stroke="currentColor" strokeOpacity={0.55} strokeWidth={1} />
        <text x={x(100)} y={chartH - PAD.bottom + 14} fontSize={8} textAnchor="middle" fill="currentColor" opacity={0.6}>
          채널 평균 100
        </text>
      </svg>
      <div className="text-[11px] text-neutral-500">
        {TARGET_INDEX_STRONG} 이상은 강세, {TARGET_INDEX_WEAK} 이하는 미진으로 표시함
      </div>
      <ChartCaption caption={caption} />
    </div>
  );
}

/** 확장부 하단 한 줄 — "남20대(319)·여40대(218)에서 강세, 여30대(68)만 채널 평균 이하임" 형태. */
function buildTargetSentence(p: ProgramProfile): string {
  const strong = p.strongTargets.slice(0, 2).map((t) => `${t.demographicLabel}(${t.index})`);
  const weak = p.weakTargets.slice(0, 1).map((t) => `${t.demographicLabel}(${t.index})`);
  if (strong.length === 0 && weak.length === 0) return "채널 평균에서 크게 벗어난 타깃이 없어 전 연령대가 고르게 나온 편임.";
  if (strong.length === 0) return `채널 평균을 뚜렷하게 상회한 타깃은 없고, ${weak[0]}만 채널 평균 이하임.`;
  if (weak.length === 0) return `${strong.join("·")}에서 강세이며, 채널 평균을 크게 밑도는 타깃은 없음.`;
  return `${strong.join("·")}에서 강세, ${weak[0]}만 채널 평균 이하임.`;
}

function ProgramProfilesView({ programs, caption, channelCode }: { programs: ProgramProfile[]; caption: ChartCaptionInfo; channelCode: string }) {
  // 한 번에 하나만 펼친다(ChannelDeepDive.tsx의 expandedProgram과 같은 단일 개방 방식) — 탭이
  // 아니라 표 안의 상세 행이라 한 페이지 스크롤이 그대로 유지된다.
  const [openProgram, setOpenProgram] = useState<string | null>(null);
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="text-left text-xs text-neutral-500">
              <th className="py-1">프로그램</th>
              <th className="py-1 text-right">편성</th>
              <th className="py-1">최고 시간대</th>
              <th className="py-1">강세 타깃</th>
              <th className="py-1">미진 타깃</th>
              <th className="py-1">도달·체류</th>
            </tr>
          </thead>
          <tbody>
            {programs.map((p) => {
              const isOpen = openProgram === p.canonicalName;
              return (
                <Fragment key={p.canonicalName}>
                  <tr
                    className="cursor-pointer border-t border-neutral-200/60 align-top hover:bg-neutral-50 dark:border-neutral-800/60"
                    onClick={() => setOpenProgram(isOpen ? null : p.canonicalName)}
                  >
                    <td className="py-1.5 font-medium">
                      <span className="mr-1 text-neutral-400">{isOpen ? "▾" : "▸"}</span>
                      {p.canonicalName}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{p.airings}회</td>
                    <td className="py-1.5 tabular-nums">{p.peakHour === null ? "—" : `${p.peakHour}시 ${formatRating(p.peakRating, channelCode)}`}</td>
                    <td className="py-1.5">{p.strongTargets.slice(0, 2).map((t) => `${t.demographicLabel} ${t.index}`).join(", ") || "—"}</td>
                    <td className="py-1.5">{p.weakTargets.slice(0, 1).map((t) => `${t.demographicLabel} ${t.index}`).join(", ") || "—"}</td>
                    <td className="py-1.5">{p.engagementType ?? "—"}</td>
                  </tr>
                  {isOpen && (
                    <tr className="border-t border-neutral-200/60 bg-neutral-50/60 dark:border-neutral-800/60">
                      <td colSpan={6} className="p-3">
                        <div className="grid gap-4 sm:grid-cols-2">
                          <HourBarChart points={p.hourPoints} caption={caption} channelCode={channelCode} />
                          <TargetIndexChart points={p.targetPoints} caption={caption} />
                        </div>
                        <p className="mt-2 text-xs text-neutral-600">{buildTargetSentence(p)}</p>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
          <caption className="mt-2 text-left text-[11px] text-neutral-500">행을 누르면 그 프로그램의 시간대·타깃 프로파일이 펼쳐짐(한 번에 하나만 열림).</caption>
        </table>
      </div>
      <ChartCaption caption={caption} />
    </div>
  );
}

// ── 심층 04 요일 × 시간대 편성 배분과 성과 ────────────────────────────────────
function QuadrantTable({ rows, channelCode }: { rows: QuadrantRow[]; channelCode: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="text-left text-xs text-neutral-500">
            <th className="py-1">구분</th>
            <th className="py-1 text-right">편성</th>
            <th className="py-1 text-right">시청률</th>
            <th className="py-1 text-right">점유율</th>
            <th className="py-1 text-right">도달율</th>
            <th className="py-1 text-right">시청시간 비율</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((q) => (
            <tr key={`${q.dayType}_${q.primeLabel}`} className="border-t border-neutral-200/60 dark:border-neutral-800/60">
              <td className="py-1">
                {q.dayType} {q.primeLabel}
              </td>
              <td className="py-1 text-right tabular-nums">
                {q.airings}회 <span className="text-[11px] text-neutral-400">{Math.round(q.airtimeMin)}분</span>
              </td>
              <td className="py-1 text-right tabular-nums">{formatRating(q.avgRating, channelCode)}</td>
              <td className="py-1 text-right tabular-nums">{formatPercent(q.avgShare)}</td>
              <td className="py-1 text-right tabular-nums">{formatPercent(q.avgReach)}</td>
              <td className="py-1 text-right tabular-nums">{formatPercent(q.avgTimeSpentShare)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 24시간 해상도 요일×시간대 격자 — charts.tsx의 WeekdayHourHeatmap과 같은 색 농도 패턴이되,
 *  주요시간 셀에 테두리를 둘러 요일별로 다른 주요시간 경계를 눈으로 확인할 수 있게 한다. */
function DowHourHeatmap({ cells, channelCode }: { cells: DowHourCell[]; channelCode: string }) {
  const dows = Array.from(new Set(cells.map((c) => c.dow))).sort((a, b) => a - b);
  const hours = Array.from(new Set(cells.map((c) => c.hour))).sort((a, b) => a - b);
  const values = cells.map((c) => c.avgRating).filter((v): v is number => v !== null);
  const max = values.length > 0 ? Math.max(...values) : 1;
  const cellByKey = new Map(cells.map((c) => [`${c.dow}_${c.hour}`, c]));
  const labelByDow = new Map(cells.map((c) => [c.dow, c.dowLabel]));
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="border-collapse text-[10px]">
          <thead>
            <tr>
              <th className="p-1 text-left text-neutral-500">요일\시간</th>
              {hours.map((h) => (
                <th key={h} className="p-1 text-center text-neutral-500">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dows.map((dow) => (
              <tr key={dow}>
                <td className="p-1 font-medium">{labelByDow.get(dow) ?? dow}</td>
                {hours.map((h) => {
                  const c = cellByKey.get(`${dow}_${h}`);
                  const v = c?.avgRating ?? null;
                  const alpha = v !== null && max > 0 ? Math.min(1, v / max) : 0;
                  return (
                    <td
                      key={h}
                      className="p-1 text-center tabular-nums"
                      title={c ? `${labelByDow.get(dow) ?? dow} ${h}시 · ${c.airings}회 · ${formatRating(v, channelCode)}` : undefined}
                      style={{
                        backgroundColor: `rgba(58,48,223,${alpha * 0.75})`,
                        color: alpha > 0.5 ? "#fff" : undefined,
                        boxShadow: c?.isPrime ? `inset 0 0 0 1.5px ${C_PRIME_LINE}` : undefined,
                      }}
                    >
                      {v !== null ? formatRating(v, channelCode) : "—"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-1 text-[11px] text-neutral-500">열 머리글은 시(時)이며, 테두리가 있는 셀이 주요시간임 — 요일마다 시작 시각이 다름.</div>
    </div>
  );
}

function MoveCandidateList({ items, channelCode }: { items: MoveCandidate[]; channelCode: string }) {
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm">
      {items.map((m) => (
        <li key={`${m.dow}_${m.hour}_${m.kind}`}>
          {m.dowLabel} {m.hour}시 — {m.airings}회 편성, 회당 {formatRating(m.avgRating, channelCode)} ·{" "}
          <span style={{ color: m.kind === "편성 대비 성과 낮음" ? C_WARN : "#047857" }}>{m.kind}</span>
        </li>
      ))}
    </ul>
  );
}

function ScheduleCanvasView({
  data,
  channelCode,
}: {
  data: { quadrants: QuadrantRow[]; cells: DowHourCell[]; moveCandidates: MoveCandidate[]; caption: ChartCaptionInfo };
  channelCode: string;
}) {
  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1 text-xs font-medium text-neutral-500">평일·주말 × 주요시간 4분면</div>
        <QuadrantTable rows={data.quadrants} channelCode={channelCode} />
      </div>

      <div>
        <div className="mb-1 text-xs font-medium text-neutral-500">요일 × 시간대 격자</div>
        {/* 하루 리포트처럼 요일 축이 성립하지 않으면 억지로 격자를 그리지 않고 사유를 그대로 보여준다. */}
        {data.cells.length > 0 ? (
          <DowHourHeatmap cells={data.cells} channelCode={channelCode} />
        ) : (
          <p className="rounded bg-neutral-100 p-3 text-sm text-neutral-500 dark:bg-neutral-900">{data.caption.measure}</p>
        )}
      </div>

      <div>
        <div className="mb-1 text-xs font-medium text-neutral-500">이동 후보(확인해볼 지점)</div>
        {data.moveCandidates.length > 0 ? (
          <MoveCandidateList items={data.moveCandidates} channelCode={channelCode} />
        ) : (
          <p className="text-sm text-neutral-500">편성 3회 이상 셀 기준으로 뚜렷한 이동 후보가 확인되지 않았음.</p>
        )}
      </div>

      <ChartCaption caption={data.caption} />
    </div>
  );
}

// ── 심층 05 오리지널 본방·재방 확산 ───────────────────────────────────────────
function AmplificationBadge({ label }: { label: OriginalRerunInsight["amplificationLabel"] }) {
  if (label === null) return null;
  const cls = label === "확산 큼" ? "text-white" : label === "확산 보통" ? "bg-indigo-50 text-indigo-600" : "bg-neutral-200 text-neutral-700";
  return (
    <span className={`ml-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${cls}`} style={label === "확산 큼" ? { backgroundColor: C_STRONG } : undefined}>
      {label}
    </span>
  );
}

function OriginalRerunView({ rows, channelCode }: { rows: OriginalRerunInsight[]; channelCode: string }) {
  return (
    <div>
      <p className="mb-2 text-xs text-neutral-600">
        확산 배수는 본방일부터 1주일 내 방영분(본방·동시방영·재방 채널)의 시청률 합산을 본방 합산으로 나눈 값임. 1.0이면 재방 기여가 없다는 뜻임.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="text-left text-xs text-neutral-500">
              <th className="py-1">작품</th>
              <th className="py-1">카테고리</th>
              <th className="py-1 text-right">본방</th>
              <th className="py-1 text-right">직후재방</th>
              <th className="py-1 text-right">당일재방</th>
              <th className="py-1 text-right">자체재방</th>
              <th className="py-1 text-right">유지율</th>
              <th className="py-1 text-right">1주일 방영</th>
              <th className="py-1 text-right">확산 배수</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.canonicalName} className="border-t border-neutral-200/60 align-top dark:border-neutral-800/60">
                <td className="py-1">{o.canonicalName}</td>
                <td className="py-1 text-neutral-500">{o.category ?? "—"}</td>
                <td className="py-1 text-right tabular-nums">
                  {o.liveEpisodes}회 <span className="text-[11px] text-neutral-400">{formatRating(o.liveAvgRating, channelCode)}</span>
                </td>
                <td className="py-1 text-right tabular-nums">{o.immediateRerunEpisodes}회</td>
                <td className="py-1 text-right tabular-nums">{o.sameDayRerunEpisodes}회</td>
                <td className="py-1 text-right tabular-nums">{o.selfRerunEpisodes}회</td>
                <td className="py-1 text-right tabular-nums">
                  {formatPercent(o.retentionPct)}
                  {o.rerunChannelCode && <span className="ml-1 text-[11px] text-neutral-400">{o.rerunChannelCode}</span>}
                </td>
                <td className="py-1 text-right tabular-nums">
                  {o.windowAirings}회 <span className="text-[11px] text-neutral-400">합산 {formatRating(o.windowSumRating, channelCode)}</span>
                </td>
                <td className="py-1 whitespace-nowrap text-right tabular-nums">
                  {o.amplificationRatio === null ? "—" : `${o.amplificationRatio}배`}
                  <AmplificationBadge label={o.amplificationLabel} />
                </td>
              </tr>
            ))}
          </tbody>
          <caption className="mt-2 text-left text-[11px] text-neutral-500">유지율 옆 채널 코드는 재방 유지율을 잰 기준 채널임.</caption>
        </table>
      </div>
    </div>
  );
}

// ── 심층 06 본방 vs 본방 외 효율 ──────────────────────────────────────────────
function FirstRunView({ rows, channelCode }: { rows: FirstRunInsight[]; channelCode: string }) {
  return (
    <div>
      <p className="mb-2 text-xs text-neutral-600">
        &lsquo;&lt;본&gt;&rsquo; 태그가 붙은 방영분과 그 외를 갈라 본 값임. 태그가 없는 방영분은 재방으로 단정하지 않고 &lsquo;본방 외&rsquo;로 묶었음.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="text-left text-xs text-neutral-500">
              <th className="py-1">프로그램</th>
              <th className="py-1 text-right">본방 편성</th>
              <th className="py-1 text-right">본방 평균</th>
              <th className="py-1 text-right">본방 외 편성</th>
              <th className="py-1 text-right">본방 외 평균</th>
              <th className="py-1 text-right">유지율</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.canonicalName} className="border-t border-neutral-200/60 dark:border-neutral-800/60">
                <td className="py-1">{r.canonicalName}</td>
                <td className="py-1 text-right tabular-nums">{r.firstRunAirings}회</td>
                <td className="py-1 text-right tabular-nums">{formatRating(r.firstRunAvgRating, channelCode)}</td>
                <td className="py-1 text-right tabular-nums">{r.otherAirings}회</td>
                <td className="py-1 text-right tabular-nums">{formatRating(r.otherAvgRating, channelCode)}</td>
                <td className="py-1 text-right tabular-nums">{formatPercent(r.retentionPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
