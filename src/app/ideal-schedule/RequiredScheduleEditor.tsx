"use client";

// 금주 필수 편성·고정 편성 입력(PD 포함). 주요 콘텐츠 관리의 편성 정보는 여기 입력하지 않아도 자동 반영된다.
import { useCallback, useEffect, useState } from "react";
import { DOW_LABELS, minToLabel } from "@/lib/scheduleGridLayout";

type Constraint = {
  id: string;
  program_name: string;
  weekday: number;
  start_min: number;
  duration_min: number;
  active_from: string;
  active_to: string | null;
  constraint_type: string;
  priority: number;
  created_by: string | null;
};

const TYPE_LABEL: Record<string, string> = { WEEKLY_PREMIERE: "금주 필수(신규·특집)", MANUAL_REQUIRED: "수동 필수", FIXED_SLOT: "고정 편성" };

export function RequiredScheduleEditor({ channelCode, weekStart, onChanged }: { channelCode: string; weekStart: string; onChanged: () => void }) {
  const [items, setItems] = useState<Constraint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ programName: "", weekday: 5, startTime: "21:20", durationMin: 70, activeFrom: weekStart, activeTo: "", constraintType: "WEEKLY_PREMIERE", priority: 1 });

  const load = useCallback(() => {
    fetch(`/api/scheduling/ideal-schedule/constraints?channel=${encodeURIComponent(channelCode)}`)
      .then((r) => r.json())
      .then((b) => setItems(b.ok ? b.constraints : []));
  }, [channelCode]);
  useEffect(() => {
    load();
  }, [load]);

  async function add() {
    setError(null);
    const r = await fetch("/api/scheduling/ideal-schedule/constraints", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channelCode, ...form, activeTo: form.activeTo || null }),
    });
    const j = await r.json();
    if (!j.ok) return setError(j.message ?? "저장하지 못했습니다.");
    setForm((f) => ({ ...f, programName: "" }));
    load();
    onChanged();
  }
  async function remove(id: string) {
    await fetch(`/api/scheduling/ideal-schedule/constraints/${id}`, { method: "DELETE" });
    load();
    onChanged();
  }

  const input = "rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm";
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-800">필수 편성</h3>
        <p className="text-xs text-zinc-500">주요 콘텐츠 관리에 등록된 본방 요일·시각은 자동으로 반영됩니다. 여기에는 금주 신규·특집·고정 편성만 입력하세요.</p>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-8">
        <input className={`${input} md:col-span-2`} placeholder="프로그램명" value={form.programName} onChange={(e) => setForm({ ...form, programName: e.target.value })} />
        <select className={input} value={form.weekday} onChange={(e) => setForm({ ...form, weekday: Number(e.target.value) })}>
          {DOW_LABELS.map((d, i) => (
            <option key={d} value={i + 1}>
              {d}요일
            </option>
          ))}
        </select>
        <input className={input} type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} title="00:00~01:59는 전날 방송일(24~25시)로 저장됩니다" />
        <input className={input} type="number" min={1} max={600} value={form.durationMin} onChange={(e) => setForm({ ...form, durationMin: Number(e.target.value) })} title="방영 길이(분)" />
        <input className={input} type="date" value={form.activeFrom} onChange={(e) => setForm({ ...form, activeFrom: e.target.value })} title="시작일" />
        <input className={input} type="date" value={form.activeTo} onChange={(e) => setForm({ ...form, activeTo: e.target.value })} title="종료일(선택)" />
        <select className={input} value={form.constraintType} onChange={(e) => setForm({ ...form, constraintType: e.target.value })}>
          {Object.entries(TYPE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <button type="button" disabled={!form.programName.trim()} onClick={add} className="rounded-full bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40">
          필수 편성 추가
        </button>
        <span className="text-xs text-zinc-400">시작 시각 · 길이(분) · 시작일 · 종료일(선택)</span>
        {error && <span className="text-xs text-rose-600">{error}</span>}
      </div>
      {items.length > 0 && (
        <table className="mt-3 w-full text-sm">
          <tbody>
            {items.map((c) => (
              <tr key={c.id} className="border-t border-zinc-100">
                <td className="py-1.5 pr-2 font-medium text-zinc-800">{c.program_name}</td>
                <td className="py-1.5 pr-2 text-zinc-600">
                  {DOW_LABELS[c.weekday - 1]} {minToLabel(Number(c.start_min))} · {c.duration_min}분
                </td>
                <td className="py-1.5 pr-2 text-zinc-500">
                  {c.active_from} ~ {c.active_to ?? "종료일 없음"}
                </td>
                <td className="py-1.5 pr-2 text-xs text-zinc-500">{TYPE_LABEL[c.constraint_type] ?? c.constraint_type}</td>
                <td className="py-1.5 text-right">
                  <button type="button" onClick={() => remove(c.id)} className="text-xs text-rose-600 hover:underline">
                    삭제
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
