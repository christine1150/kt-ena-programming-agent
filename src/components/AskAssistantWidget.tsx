"use client";

// 사용자 지시(2026-08-26): "1페이지의 [4개 채널이 동시에 큰 폭으로 움직였습니다] 알림 자리를
// 'AI 편성 비서 - 자연어 검색' 항목으로 교체하자". 이 위젯은 원래 채널 상세 페이지
// (ChannelDeepDive.tsx "질문하기 · AI 편성 비서" 섹션)에만 있었다 — /api/ask는 채널 파라미터를
// 페이지에서 미리 넘기지 않고 질문 문장 자체에서 채널명을 인식하므로(intent/parameterExtractor.ts),
// 특정 채널에 종속되지 않고 그대로 재사용할 수 있다. 4900줄이 넘는 ChannelDeepDive.tsx를 건드려
// 로직을 옮기는 대신(Delta-Only — 이미 잘 동작하는 코드는 최소로 건드린다), 여기 새 공용
// 컴포넌트로 뽑아 Page 1(Dashboard.tsx)과 Page 2(ChannelDeepDive.tsx) 양쪽에서 재사용한다.
// 색상 헬퍼(hexToRgb/cellTextColor/accentForegroundColor)는 ChannelDeepDive.tsx에도 같은 이름의
// 로컬 함수가 있는데, 그 파일을 리팩터링하는 위험을 피하려 여기 별도로 작게 복제해 둔다.
import { useState } from "react";
import type { EvidenceAnswer as AskAnswer } from "@/lib/intent/types";

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function cellTextColor(accentColor: string, alpha: number): string {
  const ratio = alpha / 255;
  const [r, g, b] = hexToRgb(accentColor);
  const blendedR = 255 * (1 - ratio) + r * ratio;
  const blendedG = 255 * (1 - ratio) + g * ratio;
  const blendedB = 255 * (1 - ratio) + b * ratio;
  const luminance = 0.299 * blendedR + 0.587 * blendedG + 0.114 * blendedB;
  return luminance < 150 ? "#ffffff" : "#27272a";
}
function accentShade(accentColor: string, factor: number): string {
  const [r, g, b] = hexToRgb(accentColor);
  const mix = (c: number) => Math.round(c * (1 - factor));
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}
function accentForegroundColor(accentColor: string): string {
  const [r, g, b] = hexToRgb(accentColor);
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  if (luminance < 130) return accentColor;
  const factor = Math.min(0.7, 0.35 + (luminance - 130) / 250);
  return accentShade(accentColor, factor);
}

export interface AskAssistantWidgetProps {
  // 버튼·강조 텍스트·시각화에 쓸 메인 컬러. 채널 페이지는 그 채널 로고 색, Page 1처럼 특정
  // 채널에 종속되지 않는 화면은 브랜드 기본색(예: ENA 블루)을 넘기면 된다.
  accentColor: string;
  title?: string;
  description?: string;
  placeholder?: string;
  className?: string;
}

export function AskAssistantWidget({
  accentColor,
  title = "질문하기 · AI 편성 비서",
  description = "OpenAI를 활용해 자연어 질문을 이해하고, DB의 검증된 데이터로 답합니다. 채널 성과·프로그램 TOP·시간대·Target Affinity·경쟁채널 비교·포트폴리오 랭킹/KPI/알림 질문을 지원합니다.",
  placeholder = "예: 어제 ENA DRAMA는 어땠어? / 전일 대비 가장 많이 상승한 채널은?",
  className = "rounded-3xl bg-white p-6 shadow-sm ring-1 ring-zinc-100",
}: AskAssistantWidgetProps) {
  const [askQuestion, setAskQuestion] = useState("");
  const [askAnswer, setAskAnswer] = useState<AskAnswer | null>(null);
  const [askLoading, setAskLoading] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  // ChannelDeepDive.tsx와 동일 — "그럼 지난주는?"류 후속 질문 맥락(최근 3턴, 답변 본문 제외).
  const [askHistory, setAskHistory] = useState<
    { question: string; intentId: string | null; channelCode: string | null; targetLabel: string | null; competitorName: string | null }[]
  >([]);

  async function submitAskQuestion(overrideQuestion?: string) {
    const q = (overrideQuestion ?? askQuestion).trim();
    if (!q || askLoading) return;
    setAskLoading(true);
    setAskError(null);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, history: askHistory }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setAskError(json.message ?? "질문을 처리하지 못했습니다.");
        setAskAnswer(null);
      } else {
        setAskAnswer(json.answer);
        setAskHistory((prev) => [
          ...prev.slice(-2),
          {
            question: q,
            intentId: json.intent_id ?? null,
            channelCode: json.parameters?.channelCode ?? null,
            targetLabel: json.parameters?.targetLabel ?? null,
            competitorName: json.parameters?.competitorName ?? null,
          },
        ]);
      }
    } catch {
      setAskError("질문을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      setAskAnswer(null);
    } finally {
      setAskLoading(false);
    }
  }

  return (
    <div className={className}>
      <h2 className="font-heading mb-1 text-xl font-bold tracking-tight text-zinc-900">{title}</h2>
      <p className="mb-3 text-sm text-zinc-400">{description}</p>
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          value={askQuestion}
          onChange={(e) => setAskQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitAskQuestion();
          }}
          placeholder={placeholder}
          className="min-w-0 flex-1 rounded-xl border border-zinc-200 px-3 py-2 text-sm focus:border-[var(--accent)] focus:outline-none"
        />
        <button
          onClick={() => submitAskQuestion()}
          disabled={askLoading || !askQuestion.trim()}
          className="rounded-xl px-4 py-2 text-sm font-medium disabled:opacity-40"
          style={{ backgroundColor: accentColor, color: cellTextColor(accentColor, 255) }}
        >
          {askLoading ? "확인 중..." : "질문하기"}
        </button>
      </div>
      {askError && <p className="mt-3 text-sm text-rose-600">{askError}</p>}
      {askAnswer && (
        <div className="mt-4 space-y-2 rounded-2xl bg-zinc-50 p-4 text-sm">
          <p className="font-semibold text-zinc-800">{askAnswer.conclusion}</p>
          {askAnswer.keyNumbers !== "—" && <p className="text-zinc-700">핵심 수치: {askAnswer.keyNumbers}</p>}
          {askAnswer.comparisonBasis !== "—" && <p className="text-zinc-500">비교 기준: {askAnswer.comparisonBasis}</p>}
          {askAnswer.evidence !== "—" && <p className="whitespace-pre-line text-zinc-600">근거: {askAnswer.evidence}</p>}
          {askAnswer.interpretation && <p className="text-zinc-700">해석: {askAnswer.interpretation}</p>}
          {askAnswer.programmingAction !== "—" && (
            <p style={{ color: accentForegroundColor(accentColor) }}>편성 조치: {askAnswer.programmingAction}</p>
          )}
          <p className="text-sm text-zinc-400">신뢰도: {askAnswer.confidenceNote}</p>
          {askAnswer.visualization?.type === "bar" && askAnswer.visualization.series.length > 0 && (
            <div className="mt-1 rounded-xl bg-white p-3 ring-1 ring-zinc-100">
              <p className="mb-2 text-xs font-medium text-zinc-500">{askAnswer.visualization.title}</p>
              <div className="space-y-1.5">
                {(() => {
                  const viz = askAnswer.visualization!;
                  const max = Math.max(...viz.series.map((s) => s.value ?? 0), 0.0001);
                  return viz.series.map((s, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <span className="w-28 shrink-0 truncate text-zinc-600" title={s.label}>
                        {s.label}
                      </span>
                      <div className="h-2.5 flex-1 rounded-full bg-zinc-100">
                        {s.value !== null && (
                          <div
                            className="h-2.5 rounded-full"
                            style={{ width: `${Math.max(3, (Math.abs(s.value) / max) * 100)}%`, backgroundColor: accentColor }}
                          />
                        )}
                      </div>
                      <span className="w-14 shrink-0 text-right text-zinc-500">{s.value === null ? "데이터 없음" : s.value.toFixed(2)}</span>
                    </div>
                  ));
                })()}
              </div>
            </div>
          )}
          {askAnswer.visualization?.type === "table" && (askAnswer.visualization.rows?.length ?? 0) > 0 && (
            <div className="mt-1 overflow-x-auto rounded-xl bg-white p-3 ring-1 ring-zinc-100">
              <p className="mb-2 text-xs font-medium text-zinc-500">{askAnswer.visualization.title}</p>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-zinc-100 text-zinc-400">
                    {askAnswer.visualization.columns!.map((c, i) => (
                      <th key={i} className="whitespace-nowrap py-1 pr-3 font-medium">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {askAnswer.visualization.rows!.map((row, i) => (
                    <tr key={i} className="border-b border-zinc-50 last:border-0">
                      {row.map((cell, j) => (
                        <td key={j} className="whitespace-nowrap py-1 pr-3 text-zinc-700">
                          {cell ?? "데이터 없음"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {askAnswer.visualization?.type === "line" && (askAnswer.visualization.points?.length ?? 0) > 0 && (
            <div className="mt-1 rounded-xl bg-white p-3 ring-1 ring-zinc-100">
              <p className="mb-2 text-xs font-medium text-zinc-500">{askAnswer.visualization.title}</p>
              {(() => {
                const points = askAnswer.visualization!.points!;
                const W = Math.max(320, points.length * 48);
                const H = 120;
                const padL = 36;
                const padB = 18;
                const values = points.map((p) => p.value).filter((v): v is number => v !== null);
                const max = Math.max(...values, 0.0001);
                const min = Math.min(...values, 0);
                const range = max - min || 1;
                const xOf = (i: number) => padL + (i / Math.max(1, points.length - 1)) * (W - padL - 12);
                const yOf = (v: number) => H - padB - ((v - min) / range) * (H - padB - 12);
                const pathD = points
                  .map((p, i) => (p.value === null ? null : `${i === 0 || points[i - 1]?.value === null ? "M" : "L"} ${xOf(i)} ${yOf(p.value)}`))
                  .filter((s): s is string => s !== null)
                  .join(" ");
                return (
                  <div className="overflow-x-auto">
                    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: W, height: H }}>
                      <text x={2} y={12} fontSize={9} fill="#a1a1aa">
                        {max.toFixed(2)}
                      </text>
                      <text x={2} y={H - padB} fontSize={9} fill="#a1a1aa">
                        {min.toFixed(2)}
                      </text>
                      {pathD && <path d={pathD} fill="none" stroke={accentColor} strokeWidth={2} />}
                      {points.map((p, i) => (p.value === null ? null : <circle key={i} cx={xOf(i)} cy={yOf(p.value)} r={2.5} fill={accentColor} />))}
                      {points.map((p, i) => (
                        <text key={i} x={xOf(i)} y={H - 4} fontSize={9} textAnchor="middle" fill="#a1a1aa">
                          {p.label}
                        </text>
                      ))}
                    </svg>
                  </div>
                );
              })()}
            </div>
          )}
          {askAnswer.visualization?.type === "heatmap" && (askAnswer.visualization.heatmapRowLabels?.length ?? 0) > 0 && (
            <div className="mt-1 overflow-x-auto rounded-xl bg-white p-3 ring-1 ring-zinc-100">
              <p className="mb-2 text-xs font-medium text-zinc-500">{askAnswer.visualization.title}</p>
              {(() => {
                const viz = askAnswer.visualization!;
                const rowLabels = viz.heatmapRowLabels!;
                const colLabels = viz.heatmapColLabels!;
                const cells = viz.heatmapCells!;
                const flat = cells.flat().filter((v): v is number => v !== null);
                const max = Math.max(...flat, 0.0001);
                const min = Math.min(...flat, 0);
                const range = max - min || 1;
                return (
                  <table className="w-full text-center text-[11px]">
                    <thead>
                      <tr>
                        <th className="w-10" />
                        {colLabels.map((c, j) => (
                          <th key={j} className="whitespace-nowrap px-1 pb-1 font-medium text-zinc-400">
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rowLabels.map((r, i) => (
                        <tr key={i}>
                          <td className="pr-1 text-right font-medium text-zinc-400">{r}</td>
                          {colLabels.map((_, j) => {
                            const v = cells[i]?.[j] ?? null;
                            const intensity = v === null ? 0 : (v - min) / range;
                            const alpha = v === null ? 0 : Math.round(40 + intensity * 200);
                            const bg = v === null ? "#f4f4f5" : `${accentColor}${alpha.toString(16).padStart(2, "0")}`;
                            const fg = v === null ? "#a1a1aa" : cellTextColor(accentColor, alpha);
                            return (
                              <td key={j} className="p-0.5">
                                <div className="rounded-md py-1.5" style={{ backgroundColor: bg, color: fg }}>
                                  {v === null ? "—" : v.toFixed(2)}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                );
              })()}
            </div>
          )}
          {askAnswer.followups && askAnswer.followups.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {askAnswer.followups.map((f, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    setAskQuestion(f);
                    submitAskQuestion(f);
                  }}
                  className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs text-zinc-600 hover:border-[var(--accent)] hover:text-zinc-900"
                >
                  {f}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
