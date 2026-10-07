"use client";

// 홈 주간·월간 보기 전용 패널(단계 07) — 일간 화면의 섹션 제목만 바꾼 복제가 아니라 각 기간이 답해야 하는 질문을 다룬다.
//  · 주간: 다음 주에 바꿀 최소 변경안(지난주 기여 하락 프로그램의 슬롯 대안 비교로 연결)
//  · 월간: 채널 역할·라인업, 권리 소진(Avail), 차월 확인 항목
// 값은 이미 계산된 주간·월간 리뷰와 Avail 요약만 쓰고 원인을 단정하지 않는다.
import Link from "next/link";
import { useContextData } from "@/lib/workspace/useContextData";
import type { RightsHomeSummary } from "@/lib/avail/homeSummary";
import { DEFAULT_OPERATING_POLICY } from "@/lib/insight/operatingPolicy";
import { EMPTY_CONTEXT, hrefFor, type ViewContext } from "@/lib/workspace/viewContext";
import { PANEL, PanelHeader } from "./HomePanels";

export interface NextWeekItem {
  channelCode: string;
  channelName: string;
  /** 지난주 채널 시청률 기여가 가장 낮았던 프로그램(없으면 null) */
  program: string | null;
  /** 기여·효과 분해를 문장으로(이미 포맷된 값) */
  observation: string | null;
}

export function NextWeekPanel({ items, ctx }: { items: NextWeekItem[]; ctx: ViewContext }) {
  const withProgram = items.filter((i) => i.program);
  if (items.length === 0) return null; // 주간 리뷰가 없으면(미계산) '변경 없음'이라고 말하지 않고 패널 자체를 만들지 않는다.
  return (
    <section className={PANEL} aria-label="다음 주 대안" data-section="next_week">
      <PanelHeader title="다음 주 대안" question="다음 주에 바꿀 최소 변경안을 비교합니다" />
      {withProgram.length === 0 ? (
        <p className="rounded-lg bg-zinc-50 px-4 py-3 text-[13px] text-zinc-600">지난주 기여가 뚜렷하게 낮았던 프로그램이 없습니다. 변경 없이 유지하는 안이 최소 변경안입니다.</p>
      ) : (
        <ul className="space-y-2">
          {withProgram.map((i) => (
            <li key={i.channelCode} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-zinc-50 px-4 py-3 ring-1 ring-zinc-200/70">
              <span className="w-24 shrink-0 text-[13px] font-semibold text-zinc-800">{i.channelName}</span>
              <span className="min-w-0 flex-1 text-[13px] text-zinc-700">
                &lsquo;{i.program}&rsquo; — {i.observation}
              </span>
              <Link href={hrefFor("ideal_schedule", { ...ctx, channel: i.channelCode }, { from: `week:${i.channelCode}:${i.program}`, ft: `${i.channelName} '${i.program}' 슬롯 대안 비교`, sj: `${i.channelCode}|${i.program}|week` })} className="rounded-full bg-zinc-900 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-zinc-700">
                슬롯 대안 비교
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[11.5px] text-zinc-400">기여가 낮다는 것은 지난주 관측일 뿐 그 프로그램이 원인이라는 뜻이 아닙니다. 대안은 Avail·필수 편성 등 제약을 통과한 후보로만 확정됩니다.</p>
    </section>
  );
}

export interface MonthlyChannelItem {
  channelCode: string;
  channelName: string;
  rankChange: number | null;
  /** 프라임 시간대 상승·하락 프로그램 이름 */
  primeUp: string | null;
  primeDown: string | null;
  weaknessProgram: string | null;
}

function RightsBlock() {
  const r = useContextData<{ summary: RightsHomeSummary; loadError: string | null }>("rights|60", async (signal) => {
    const res = await fetch("/api/dashboard/rights-summary?days=60", { signal });
    const body = await res.json().catch(() => ({ ok: false }));
    if (!res.ok || !body.ok) throw new Error(body.message ?? "권리 요약을 불러오지 못했습니다.");
    return body;
  });
  const s = r.data?.summary;
  if (r.status === "loading" || (!s && r.status !== "error")) return <p className="text-[13px] text-zinc-500" role="status">권리 현황을 불러오는 중…</p>;
  if (!s) return <p className="text-[13px] text-red-700" role="alert">{r.errorMessage}</p>;
  if (!s.tablesApplied) return <p className="rounded-lg bg-zinc-50 px-4 py-3 text-[13px] text-zinc-600">권리(Avail) 저장소가 아직 적용되지 않아 권리 소진 현황을 표시할 수 없습니다.</p>;
  if (!s.configured) return <p className="rounded-lg bg-zinc-50 px-4 py-3 text-[13px] text-zinc-600">권리 정보가 입력되지 않았습니다. 입력 전에는 권리 소진을 판단할 수 없고, 이 상태를 &lsquo;문제 없음&rsquo;으로 보지 않습니다.</p>;
  return (
    <div>
      <p className="text-[13.5px] text-zinc-800">
        {s.windowDays}일 안에 종료되는 권리 <b className="tabular-nums">{s.expiringTotal}</b>건
        {s.endedStillListed > 0 ? ` · 종료일이 지났는데 남아 있는 권리 ${s.endedStillListed}건` : ""}
      </p>
      {s.expiring.length > 0 && (
        <ul className="mt-2 space-y-1">
          {s.expiring.map((e) => (
            <li key={e.grantId} className="flex flex-wrap gap-x-3 text-[12.5px] text-zinc-700">
              <span className="font-medium">{e.title}</span>
              <span className="text-zinc-400">{e.channels}</span>
              <span className="tabular-nums">
                {e.end} 종료 ({e.daysLeft === 0 ? "오늘" : `${e.daysLeft}일 남음`})
              </span>
            </li>
          ))}
        </ul>
      )}
      <ul className="mt-2 space-y-0.5 text-[11.5px] text-zinc-400">
        {s.notes.map((n, i) => (
          <li key={i}>※ {n}</li>
        ))}
      </ul>
    </div>
  );
}

export function MonthlyPlanningPanels({ channels, monthLabel, ctx }: { channels: MonthlyChannelItem[]; monthLabel: string | null; ctx: ViewContext }) {
  const policy = DEFAULT_OPERATING_POLICY;
  const fell = channels.filter((c) => c.rankChange !== null && c.rankChange < 0);
  const weak = channels.filter((c) => c.weaknessProgram);
  const strategy: { text: string; href?: string }[] = [];
  if (fell.length > 0) strategy.push({ text: `순위가 내려간 채널(${fell.map((c) => `${c.channelName} ▼${Math.abs(c.rankChange as number)}`).join(", ")}) — 위 월간 표의 하락 요인을 보고 다음 달 라인업을 확인`, href: hrefFor("schedule_grid", { ...ctx, channel: fell[0].channelCode }) });
  for (const c of weak) strategy.push({ text: `${c.channelName} '${c.weaknessProgram}' — 지난달 기여가 낮았음. 다음 달 편성 유지 여부를 대안과 비교`, href: hrefFor("ideal_schedule", { ...ctx, channel: c.channelCode }, { from: `month:${c.channelCode}:${c.weaknessProgram}`, ft: `${c.channelName} '${c.weaknessProgram}' 다음 달 편성 검토`, sj: `${c.channelCode}|${c.weaknessProgram}|month` }) });
  strategy.push({ text: "권리가 곧 끝나는 콘텐츠의 연장·대체 편성은 위 권리 소진 목록을 기준으로 확인", href: hrefFor("purchase", { ...EMPTY_CONTEXT, channel: ctx.channel ?? "ENA" }) });
  const unset = Object.keys(policy.brandRoleByChannel).length === 0 || policy.fixedSlots.length === 0 || policy.protectedOriginals.length === 0;
  if (unset) strategy.push({ text: "운영정책(채널 역할·고정 슬롯·보호 오리지널)이 입력되지 않아 라인업 판단이 제한됩니다. 입력 전에는 역할에 맞는지 자동으로 판단하지 않습니다." });

  return (
    <>
      <section className={PANEL} aria-label="채널 역할·라인업" data-section="roles">
        <PanelHeader title="채널 역할·라인업" question="채널 역할에 맞는 라인업이 유지되는가" />
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="가로로 스크롤되는 표">
          <table className="w-full text-left text-[12.5px]">
            <thead>
              <tr className="text-zinc-400">
                <th className="pb-1 pr-3 font-medium">채널</th>
                <th className="pb-1 pr-3 font-medium">역할(운영정책)</th>
                <th className="pb-1 pr-3 font-medium">프라임 상승 프로그램</th>
                <th className="pb-1 font-medium">프라임 하락 프로그램</th>
              </tr>
            </thead>
            <tbody>
              {channels.map((c) => (
                <tr key={c.channelCode} className="border-t border-zinc-100 align-top">
                  <td className="py-2 pr-3 font-semibold text-zinc-800">{c.channelName}</td>
                  <td className="py-2 pr-3 text-zinc-600">{policy.brandRoleByChannel[c.channelCode] ?? "미설정(운영정책 입력 전)"}</td>
                  <td className="py-2 pr-3 text-zinc-700">{c.primeUp ?? "—"}</td>
                  <td className="py-2 text-zinc-700">{c.primeDown ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {monthLabel === null && <p className="mt-2 text-[11.5px] text-zinc-400">이 달의 확정(공식 월간) 리뷰는 월 마지막 날 수신 후 표시되어 프라임 상승·하락 프로그램은 비어 있습니다.</p>}
      </section>

      <section className={PANEL} aria-label="권리 소진" data-section="rights">
        <PanelHeader title="권리 소진" question="곧 만료되거나 잔여가 부족한 권리는" />
        <RightsBlock />
      </section>

      <section className={PANEL} aria-label="차월 전략" data-section="strategy">
        <PanelHeader title="차월 전략" question="다음 달에 확인·결정할 항목" />
        <ul className="space-y-2">
          {strategy.map((s, i) => (
            <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-zinc-50 px-4 py-2.5 text-[13px] text-zinc-700 ring-1 ring-zinc-200/70">
              <span className="min-w-0 flex-1">{s.text}</span>
              {s.href && (
                <Link href={s.href} className="rounded-full bg-white px-3 py-1 text-[12px] font-medium text-zinc-700 ring-1 ring-zinc-200 hover:bg-zinc-100">
                  열기
                </Link>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11.5px] text-zinc-400">항목은 지난달 관측값·권리 목록·정책 입력 상태에서 기계적으로 골랐으며, 새 수치를 만들거나 원인을 단정하지 않습니다.</p>
      </section>
    </>
  );
}
