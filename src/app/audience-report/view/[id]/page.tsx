"use client";

// 문서 보기(단계 14) — 저장된 스냅샷을 Word와 같은 모델(본문 + 부록)로 보여 주는 인쇄용 화면. 브라우저 인쇄의 "PDF로 저장"이 PDF 출력이다.
// Word·PPT와 같은 스냅샷 ID에서 같은 값·같은 문장(개조식)·같은 판단 ID를 그리고, A4 인쇄에서 표 머리행 반복·행 쪼개짐 방지·부록 새 쪽을 지킨다.
import { useParams } from "next/navigation";
import type { DocBlock, DocSection } from "@/lib/audienceReport/reportFlatten";
import type { ReportModel } from "@/lib/reportSnapshot/template";
import { kstStamp } from "@/lib/reportSnapshot/cadence";
import { ChartBars, MetaCaption } from "@/components/audienceReport/snapshotUi";
import { ReportError, ReportLoading } from "@/components/audienceReport/useSnapshotReport";
import { useReportModel } from "@/components/audienceReport/useDeckPlan";
import { isNumericText } from "@/lib/reportSnapshot/renderCommon";

const INK = "#111827";
const ACCENT = "#1D4ED8";

function BlockView({ b, keepWithNext }: { b: DocBlock; keepWithNext?: boolean }) {
  switch (b.kind) {
    case "text":
      return (
        <p className="my-2 whitespace-pre-line text-[13px] leading-relaxed" style={keepWithNext ? { breakAfter: "avoid" } : undefined}>
          {b.text}
        </p>
      );
    case "note":
      return null;
    case "bullets":
      return (
        <ul className="my-2 list-disc space-y-1 pl-5 text-[13px] leading-relaxed">
          {b.items.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      );
    case "kpi":
      return (
        <div className="my-3 break-inside-avoid">
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(b.items.length, 6)}, minmax(0, 1fr))` }}>
            {b.items.map((k) => (
              <div key={k.label} className="rounded border border-neutral-300 px-2 py-2 text-center">
                <div className="text-[11px] font-semibold text-neutral-600">{k.label}</div>
                <div className="text-xl font-bold tabular-nums">{k.value}</div>
                <div className="text-[11px] tabular-nums" style={{ color: k.dir === "up" ? ACCENT : k.dir === "down" ? "#B91C1C" : INK }}>{k.delta ?? "—"}</div>
              </div>
            ))}
          </div>
          <MetaCaption meta={b.meta} />
        </div>
      );
    case "table":
      return (
        <div className="my-3">
          <table className="w-full table-fixed border-collapse text-[11.5px] leading-snug">
            <thead style={{ display: "table-header-group" }}>
              <tr>
                {b.headers.map((h) => (
                  <th key={h} className="border border-neutral-300 bg-neutral-100 px-2 py-1 text-center font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, i) => (
                <tr key={i} style={{ breakInside: "avoid" }}>
                  {b.headers.map((_, j) => (
                    <td key={j} className={`break-words border border-neutral-300 px-2 py-1 align-top ${isNumericText(r[j] ?? "") ? "text-right tabular-nums" : ""}`}>
                      {r[j] ?? "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <MetaCaption meta={b.meta} />
        </div>
      );
    case "chart":
      return (
        <div className="my-3 break-inside-avoid">
          <ChartBars block={b} accent={ACCENT} />
        </div>
      );
  }
}

function Section({ s }: { s: DocSection }) {
  return (
    <section className="mt-6">
      <h2 className="text-[17px] font-bold" style={{ breakAfter: "avoid" }}>
        {s.title}
      </h2>
      {s.blocks.map((b, i) => (
        <BlockView key={i} b={b} keepWithNext={b.kind === "text" && (s.blocks[i + 1]?.kind === "table" || s.blocks[i + 1]?.kind === "chart" || s.blocks[i + 1]?.kind === "kpi")} />
      ))}
    </section>
  );
}

function Document({ model }: { model: ReportModel }) {
  const stamp = `${model.meta.id} · 분석일 ${model.meta.analysis.to} · 생성 ${kstStamp(model.meta.generatedAt)}`;
  return (
    <div className="mx-auto max-w-[800px] bg-white px-6 py-6 text-neutral-900" style={{ color: INK }}>
      <h1 className="text-[26px] font-bold leading-tight">{model.title}</h1>
      <div className="mt-1 text-sm text-neutral-500">{model.subtitle}</div>
      <table className="mt-3 w-full border-collapse text-[11.5px]">
        <tbody>
          {model.infoLines.map((l) => (
            <tr key={l.label}>
              <th className="w-28 border border-neutral-300 bg-neutral-100 px-2 py-0.5 text-left font-semibold">{l.label}</th>
              <td className="border border-neutral-300 px-2 py-0.5">{l.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {model.body.map((s) => (
        <Section key={s.title} s={s} />
      ))}
      {model.appendix.length > 0 && (
        <div style={{ breakBefore: "page" }}>
          <h2 className="mt-8 text-[20px] font-bold">부록 — 상세 통계와 방법</h2>
          <p className="mt-1 text-xs text-neutral-500">본문의 근거가 되는 상세 표와 방법·한계 주석입니다. 본문과 같은 스냅샷에서 만든 값입니다.</p>
          {model.appendix.map((s) => (
            <Section key={s.title} s={s} />
          ))}
        </div>
      )}
      <div className="mt-10 text-right text-[10px] text-neutral-500">KT ENA 편성 AI Agent · {model.meta.id}</div>
      {/* 인쇄할 때 모든 쪽에 반복되는 머리·바닥 표시 */}
      <div className="print-only-fixed top" aria-hidden>{stamp}</div>
    </div>
  );
}

export default function ReportViewPage() {
  const params = useParams<{ id: string }>();
  const { state, retry } = useReportModel(`/api/audience-report/snapshot/${params.id}`);
  if (state.status === "loading") return <ReportLoading what="문서 보기" hint="저장된 보고서 원본을 불러오는 중입니다." />;
  if (state.status === "error") return <ReportError message={state.message} onRetry={retry} />;
  const { model, snapshot } = state;
  return (
    <main className="bg-neutral-100 pb-16 print:bg-white print:pb-0">
      <style>{`
        @page { size: A4; margin: 16mm 14mm 16mm; }
        .print-only-fixed { display: none; }
        @media print {
          .print-only-fixed { display: block; position: fixed; left: 0; right: 0; font-size: 9px; color: #6b7280; text-align: right; }
          .print-only-fixed.top { top: -10mm; }
          * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          h2 { break-after: avoid; }
        }
      `}</style>
      <div className="mx-auto max-w-[800px] px-4 pt-6 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-neutral-500">문서 보기 · {snapshot.name}</div>
          <button type="button" onClick={() => window.print()} className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700">
            PDF로 저장(인쇄)
          </button>
        </div>
        <p className="mt-1 text-[11px] text-neutral-500">인쇄 창에서 대상을 &quot;PDF로 저장&quot;으로 고르고 &quot;배경 그래픽&quot;을 켜면 이 화면 그대로 A4 PDF가 됩니다. Word·PPT와 같은 스냅샷({snapshot.id})입니다.</p>
        {!snapshot.persisted && <p className="mt-1 text-[11px] text-amber-700">원본 저장 여부를 확인하지 못했습니다.</p>}
      </div>
      <div className="mt-3 print:mt-0">
        <Document model={model} />
      </div>
    </main>
  );
}
