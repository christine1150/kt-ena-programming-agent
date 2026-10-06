"use client";

// 홈 첫 화면 패널(단계 07): 보기 탭·데이터 상태·오늘 결정할 사항·채널 KPI 표·후속 액션.
// 계산은 src/lib/workspace(순수 모듈)가 하고, 여기서는 그 결과를 그린다. 모바일은 요약·승인 검토 중심으로 카드형 세로 배치.
import Link from "next/link";
import type { ReactNode } from "react";
import { REVIEW_STATUS_LABEL, type Followup } from "@/lib/workspace/actionReview";
import type { DataStatus, DecisionCard } from "@/lib/workspace/homeData";
import { EMPTY_CONTEXT, hrefFor, HOME_VIEW_LABEL, HOME_VIEWS, type HomeView } from "@/lib/workspace/viewContext";
import type { KpiGroup, KpiRow } from "@/lib/workspace/kpi";

export const PANEL = "rounded-xl bg-white px-4 py-5 ring-1 ring-zinc-200/80 sm:px-8 sm:py-7";
const PANEL_TITLE = "font-heading text-[20px] font-bold tracking-tight text-zinc-900";

export function PanelHeader({ title, question, right }: { title: string; question?: string; right?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 className={PANEL_TITLE}>{title}</h2>
        {question && <p className="text-[12.5px] text-zinc-400">{question}</p>}
      </div>
      {right}
    </div>
  );
}

export function HomeViewTabs({ view, onChange }: { view: HomeView; onChange: (v: HomeView) => void }) {
  return (
    <div role="tablist" aria-label="보기 단위" className="inline-flex rounded-full bg-zinc-100 p-0.5">
      {HOME_VIEWS.map((v) => (
        <button
          key={v}
          role="tab"
          type="button"
          aria-selected={view === v}
          onClick={() => onChange(v)}
          className={`rounded-full px-4 py-1.5 text-[13px] font-medium transition ${view === v ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-800"}`}
        >
          {HOME_VIEW_LABEL[v]}
        </button>
      ))}
    </div>
  );
}

export function DataStatusCard({ status }: { status: DataStatus }) {
  const warn = status.level === "warn";
  return (
    <section className={`rounded-xl px-4 py-4 ring-1 sm:px-8 ${warn ? "bg-amber-50 ring-amber-200" : "bg-white ring-zinc-200/80"}`} aria-label="데이터 상태" data-section="data_status">
      <h2 className={`text-[14px] font-semibold ${warn ? "text-amber-900" : "text-zinc-800"}`}>
        {warn ? "⚠ " : ""}
        데이터 상태 — {status.headline}
      </h2>
      <ul className="mt-2 space-y-1">
        {status.lines.map((l, i) => (
          <li key={i} className={`text-[13px] ${l.tone === "warn" ? "font-medium text-amber-900" : l.tone === "muted" ? "text-zinc-500" : "text-zinc-700"}`}>
            · {l.text}
          </li>
        ))}
      </ul>
    </section>
  );
}

const KIND_LABEL: Record<DecisionCard["kind"], string> = { data: "데이터", anomaly: "동시 변동", program_decline: "하락 관측", program_rise: "상승 관측" };

export type ReviewStoreState = "loading" | "ready" | "unavailable" | "error";

const REVIEW_STORE_NOTE: Record<ReviewStoreState, string> = {
  ready: "",
  loading: " (검토 기록을 불러오는 중입니다 — 이미 처리한 항목이 잠시 다시 보일 수 있습니다.)",
  unavailable: " (검토 기록 저장소가 아직 적용되지 않아 기록은 저장되지 않습니다.)",
  error: " (검토 기록을 불러오지 못해 이미 처리한 항목이 다시 보일 수 있습니다.)",
};

export function DecisionCards({ cards, suppressed, candidates, reviewStore }: { cards: DecisionCard[]; suppressed: number; candidates: number; reviewStore: ReviewStoreState }) {
  return (
    <section className={PANEL} aria-label="오늘 결정할 사항" data-section="decisions">
      <PanelHeader title="오늘 결정할 사항" question={`기준에 해당하는 항목만 최대 3건 · 후보 ${candidates}건 중`} />
      {cards.length === 0 ? (
        <p className="rounded-lg bg-zinc-50 px-4 py-3 text-[13.5px] text-zinc-600">
          오늘 확인·결정이 필요한 항목이 없습니다.{suppressed > 0 ? ` (검토 기록 때문에 ${suppressed}건은 제외했습니다.)` : ""}
        </p>
      ) : (
        <ol className="grid gap-4 lg:grid-cols-3">
          {cards.map((c, idx) => (
            <li key={c.id} className="flex flex-col rounded-xl bg-zinc-50 p-4 ring-1 ring-zinc-200/70" data-decision={c.id}>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-[12px] font-semibold tabular-nums text-zinc-400">{idx + 1}</span>
                <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-zinc-600 ring-1 ring-zinc-200">{KIND_LABEL[c.kind]}</span>
                {c.review && (
                  <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 ring-1 ring-indigo-100">
                    {REVIEW_STATUS_LABEL[c.review.status]}
                    {c.review.actorName ? ` · ${c.review.actorName}` : ""}
                  </span>
                )}
              </div>
              <h3 className="text-[15px] font-bold leading-snug text-zinc-900">{c.title}</h3>
              <p className="mt-1 text-[11.5px] text-zinc-400">{c.why}</p>
              <div className="mt-3">
                <p className="text-[11px] font-semibold text-zinc-400">근거</p>
                <ul className="mt-1 space-y-1">
                  {c.evidence.map((e, i) => (
                    <li key={i} className="text-[13px] leading-snug text-zinc-700">
                      · {e}
                    </li>
                  ))}
                </ul>
              </div>
              {c.alternatives.length > 0 && (
                <div className="mt-3">
                  <p className="text-[11px] font-semibold text-zinc-400">대안</p>
                  <ul className="mt-1 space-y-1">
                    {c.alternatives.map((a, i) => (
                      <li key={i} className="text-[12.5px] leading-snug text-zinc-600">
                        · {a}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="mt-3">
                <p className="text-[11px] font-semibold text-zinc-400">확인할 조건</p>
                <p className="mt-1 text-[12.5px] leading-snug text-zinc-700">{c.confirm}</p>
              </div>
              <p className="mt-3 text-[12px] text-zinc-500">
                담당 {c.review?.actorName ?? "미지정(검토 기록 시 기록됨)"} · 검토일 {c.reviewBy ?? "해당 없음"}
              </p>
              {c.notes.length > 0 && (
                <details className="mt-2 text-[12px] text-zinc-500">
                  <summary className="cursor-pointer">제약·가정 {c.notes.length}건</summary>
                  <ul className="mt-1 space-y-1">
                    {c.notes.map((n, i) => (
                      <li key={i}>· {n}</li>
                    ))}
                  </ul>
                </details>
              )}
              <div className="mt-auto flex flex-wrap gap-2 pt-4">
                {c.links.evidence && (
                  <Link href={c.links.evidence} className="rounded-full bg-zinc-900 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-zinc-700">
                    근거 보기
                  </Link>
                )}
                {c.links.slot && (
                  <Link href={c.links.slot} className="rounded-full bg-white px-3 py-1.5 text-[12px] font-medium text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-100">
                    해당 슬롯
                  </Link>
                )}
                {c.links.compare && (
                  <Link href={c.links.compare} className="rounded-full bg-white px-3 py-1.5 text-[12px] font-medium text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-100">
                    대안 비교
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-3 text-[11.5px] text-zinc-400">
        카드는 같은 슬롯 평균 대비 변화 등 이미 계산된 값만으로 골랐고 원인을 단정하지 않습니다. 검토 상태 기록은 근거·슬롯·대안 화면 위의 띠에서 남깁니다.
        {REVIEW_STORE_NOTE[reviewStore]}
      </p>
    </section>
  );
}

function deltaClass(v: number | null): string {
  if (v === null || v === 0) return "text-zinc-500";
  return v > 0 ? "text-emerald-700" : "text-rose-700";
}

function KpiDeltaCell({ d }: { d: KpiRow["dod"] }) {
  return (
    <div className={`tabular-nums ${deltaClass(d.absolute ?? d.relativePct)}`}>
      <div>{d.ppText}</div>
      <div className="text-[11px] text-zinc-400">
        {d.pctText}
        {d.pctFromServer ? " (서버 계산)" : ""}
      </div>
    </div>
  );
}

export function KpiTable({ groups, asOfLabel }: { groups: KpiGroup[]; asOfLabel: string }) {
  return (
    <section className={PANEL} aria-label="채널 KPI 표" data-section="kpi">
      <PanelHeader title="채널 KPI" question={`${asOfLabel} · 타깃이 다른 채널은 서로 순위를 매기지 않고 같은 타깃끼리 묶었습니다`} />
      <div className="space-y-6">
        {groups.map((g) => (
          <div key={g.groupKey}>
            <h3 className="mb-2 text-[13px] font-semibold text-zinc-600">{g.title}</h3>
            {/* 데스크톱: 표 */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left text-[12.5px]">
                <thead>
                  <tr className="text-zinc-400">
                    <th className="pb-1 pr-3 font-medium">채널</th>
                    <th className="pb-1 pr-3 text-right font-medium">시청률(%)</th>
                    <th className="pb-1 pr-3 font-medium">공식 순위</th>
                    <th className="pb-1 pr-3 font-medium">목표 시청률 · 격차(%p)</th>
                    <th className="pb-1 pr-3 font-medium">목표 순위</th>
                    <th className="pb-1 pr-3 font-medium">전일 대비</th>
                    <th className="pb-1 font-medium">전주 동요일 대비</th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((r) => (
                    <tr key={r.code} className="border-t border-zinc-100 align-top" data-kpi-row={r.code}>
                      <td className="py-2 pr-3 font-semibold text-zinc-800">{r.name}</td>
                      <td className="py-2 pr-3 text-right font-bold tabular-nums text-zinc-900">{r.ratingText}</td>
                      <td className="py-2 pr-3 tabular-nums text-zinc-800" title={r.rank.universeDetail}>
                        {r.rank.text}
                        <span className={`ml-1.5 text-[11px] ${deltaClass(r.rankChange.value)}`}>{r.rankChange.text}</span>
                      </td>
                      <td className="py-2 pr-3 tabular-nums text-zinc-700">
                        <div>{r.goal.ratingText}</div>
                        <div className={`text-[11px] ${deltaClass(r.goal.gapPp)}`}>
                          {r.goal.gapText}
                          {r.goal.achievementPct !== null ? ` · 달성 ${r.goal.achievementText}` : ""}
                        </div>
                      </td>
                      <td className="py-2 pr-3 tabular-nums text-zinc-700">
                        <div>{r.targetRank.text}</div>
                        <div className="text-[11px] text-zinc-400" title={r.notes.join(" ")}>
                          {r.rankGap.text}
                        </div>
                      </td>
                      <td className="py-2 pr-3">
                        <KpiDeltaCell d={r.dod} />
                      </td>
                      <td className="py-2">
                        <KpiDeltaCell d={r.wow} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* 모바일: 채널별 요약 카드 */}
            <ul className="space-y-2 md:hidden">
              {g.rows.map((r) => (
                <li key={r.code} className="rounded-lg bg-zinc-50 px-3 py-2.5 ring-1 ring-zinc-200/70">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[14px] font-semibold text-zinc-800">{r.name}</span>
                    <span className="text-[17px] font-bold tabular-nums text-zinc-900">{r.ratingText}</span>
                  </div>
                  <p className="mt-1 text-[12px] text-zinc-600">
                    {r.rank.text} <span className={deltaClass(r.rankChange.value)}>{r.rankChange.text}</span> · {r.targetRank.text}
                  </p>
                  <p className="text-[12px] text-zinc-500">
                    목표 {r.goal.ratingText} · 격차 {r.goal.gapText}
                  </p>
                  <p className="text-[12px] text-zinc-500">
                    전일 {r.dod.ppText} / {r.dod.pctText} · 전주 {r.wow.ppText} / {r.wow.pctText}
                  </p>
                </li>
              ))}
            </ul>
            {g.rows.some((r) => r.notes.length > 0) && (
              <ul className="mt-2 space-y-0.5 text-[11.5px] text-zinc-400">
                {[...new Set(g.rows.flatMap((r) => r.notes.map((n) => `${r.name}: ${n}`)))].map((n, i) => (
                  <li key={i}>※ {n}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11.5px] text-zinc-400">
        시청률은 해당 타깃의 채널 단위 값이고, 순위는 닐슨 랭킹 시트(해당 타깃의 전체 채널) 기준입니다. 변화는 값의 차이(%p)와 상대 변화(%)를 따로 표기하며 일간 수신값은 잠정입니다.
      </p>
    </section>
  );
}

export function FollowupsCard({ followups, reviewStore }: { followups: Followup[]; reviewStore: ReviewStoreState }) {
  return (
    <section className={PANEL} aria-label="후속 액션" data-section="followups">
      <PanelHeader title="후속 액션" question="이전에 검토한 것 중 지금 처리할 것만 표시합니다" />
      {reviewStore === "loading" ? (
        <p className="rounded-lg bg-zinc-50 px-4 py-3 text-[13px] text-zinc-600">검토 기록을 불러오는 중입니다…</p>
      ) : reviewStore === "error" ? (
        <p className="rounded-lg bg-amber-50 px-4 py-3 text-[13px] text-amber-900">검토 기록을 불러오지 못해 후속 액션을 표시할 수 없습니다.</p>
      ) : reviewStore === "unavailable" ? (
        <p className="rounded-lg bg-zinc-50 px-4 py-3 text-[13px] text-zinc-600">검토 기록 저장소가 아직 적용되지 않아 후속 액션을 표시할 수 없습니다(마이그레이션 적용 후 표시).</p>
      ) : followups.length === 0 ? (
        <p className="rounded-lg bg-zinc-50 px-4 py-3 text-[13px] text-zinc-600">지금 처리할 후속 액션이 없습니다.</p>
      ) : (
        <ul className="space-y-2">
          {followups.map((f) => (
            <li key={f.actionId} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-zinc-50 px-4 py-2.5 ring-1 ring-zinc-200/70">
              <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 ring-1 ring-indigo-100">{REVIEW_STATUS_LABEL[f.status]}</span>
              <span className="min-w-0 flex-1 text-[13.5px] font-medium text-zinc-800">{f.title}</span>
              <span className="text-[12px] text-zinc-500">{f.why}</span>
              <Link
                href={f.linkedRunId ? hrefFor("ideal_schedule", { ...EMPTY_CONTEXT, channel: f.channelCode ?? "ENA" }, { run: f.linkedRunId, from: f.actionId, ft: f.title }) : hrefFor("channel", { ...EMPTY_CONTEXT, channel: f.channelCode ?? "ENA" }, { from: f.actionId, ft: f.title })}
                className="rounded-full bg-white px-3 py-1 text-[12px] font-medium text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-100"
              >
                {f.linkedRunId ? "연결된 편성안" : "다시 보기"}
              </Link>
              {f.reason && <span className="w-full text-[12px] text-zinc-400">이유: {f.reason}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
