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

// 사용자 지시(2026-10-06): "필수 편성을 한꺼번에 여러 요일 선택할 수도 있게" — 요일 칩 + 평일/주말/매일 빠른 선택.
// 저장은 서버의 기존 규칙(요일별 한 행)을 그대로 따라 선택한 요일마다 한 건씩 넣는다.
function DayPicker({ value, onChange, className = "" }: { value: number[]; onChange: (v: number[]) => void; className?: string }) {
  const toggle = (d: number) => onChange(value.includes(d) ? value.filter((x) => x !== d) : [...value, d].sort((a, b) => a - b));
  return (
    <div className={`space-y-1 ${className}`}>
      <div className="flex flex-wrap items-center gap-1">
        {DOW_LABELS.map((d, i) => (
          <button
            key={d}
            type="button"
            aria-pressed={value.includes(i + 1)}
            onClick={() => toggle(i + 1)}
            className={`h-7 w-7 rounded-full border text-xs font-medium transition ${
              value.includes(i + 1) ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-600 hover:bg-zinc-50"
            }`}
          >
            {d}
          </button>
        ))}
      </div>
      <div className="flex gap-2 text-[11px] text-zinc-500">
        <button type="button" className="hover:underline" onClick={() => onChange([1, 2, 3, 4, 5])}>
          평일
        </button>
        <button type="button" className="hover:underline" onClick={() => onChange([6, 7])}>
          주말
        </button>
        <button type="button" className="hover:underline" onClick={() => onChange([1, 2, 3, 4, 5, 6, 7])}>
          매일
        </button>
        <button type="button" className="hover:underline" onClick={() => onChange([])}>
          해제
        </button>
      </div>
    </div>
  );
}

const TYPE_LABEL: Record<string, string> = { WEEKLY_PREMIERE: "금주 필수(신규·특집)", MANUAL_REQUIRED: "수동 필수", FIXED_SLOT: "고정 편성" };

// compact: 좌측 패널용(360px) — 목록을 먼저 보이고 입력 폼은 [추가]를 눌렀을 때만 2열로 펼친다.
export function RequiredScheduleEditor({ channelCode, weekStart, onChanged, compact = false }: { channelCode: string; weekStart: string; onChanged: () => void; compact?: boolean }) {
  const [items, setItems] = useState<Constraint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(!compact);
  const [form, setForm] = useState({ programName: "", weekdays: [5] as number[], startTime: "21:20", durationMin: 70, activeFrom: weekStart, activeTo: "", constraintType: "WEEKLY_PREMIERE", priority: 1 });

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
    if (form.weekdays.length === 0) return setError("요일을 하나 이상 선택해주세요.");
    const { weekdays, ...rest } = form;
    const failed: string[] = [];
    for (const weekday of weekdays) {
      const r = await fetch("/api/scheduling/ideal-schedule/constraints", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ channelCode, ...rest, weekday, activeTo: form.activeTo || null }),
      });
      const j = await r.json().catch(() => ({ ok: false, message: "응답을 읽지 못했습니다." }));
      if (!j.ok) failed.push(`${DOW_LABELS[weekday - 1]}: ${j.message ?? "저장하지 못했습니다."}`);
    }
    if (failed.length > 0) setError(failed.join(" / "));
    else setForm((f) => ({ ...f, programName: "" }));
    load();
    onChanged();
  }
  const addLabel = form.weekdays.length > 1 ? `${form.weekdays.length}개 요일 추가` : "추가";
  async function remove(id: string) {
    await fetch(`/api/scheduling/ideal-schedule/constraints/${id}`, { method: "DELETE" });
    load();
    onChanged();
  }

  const input = "rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm";
  if (compact) {
    return (
      <div className="space-y-2">
        <p className="text-[11px] text-zinc-500">주요 콘텐츠 관리의 본방 요일·시각은 자동 반영됩니다. 금주 신규·특집·고정 편성만 추가하세요.</p>
        {items.length > 0 ? (
          <ul className="divide-y divide-zinc-100 text-xs">
            {items.map((c) => (
              <li key={c.id} className="flex items-start justify-between gap-2 py-1.5">
                <div className="min-w-0">
                  <p className="truncate font-medium text-zinc-800">{c.program_name}</p>
                  <p className="text-zinc-500">
                    {DOW_LABELS[c.weekday - 1]} {minToLabel(Number(c.start_min))} · {c.duration_min}분 · {TYPE_LABEL[c.constraint_type] ?? c.constraint_type}
                  </p>
                  <p className="text-zinc-400">
                    {c.active_from} ~ {c.active_to ?? "종료일 없음"}
                  </p>
                </div>
                <button type="button" onClick={() => remove(c.id)} className="shrink-0 text-rose-600 hover:underline">
                  삭제
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-zinc-400">직접 입력한 필수 편성이 없습니다.</p>
        )}
        {formOpen ? (
          <div className="space-y-2 rounded-xl bg-zinc-50 p-2">
            <div className="grid grid-cols-2 gap-1.5">
              <input className={`${input} col-span-2`} placeholder="프로그램명" value={form.programName} onChange={(e) => setForm({ ...form, programName: e.target.value })} />
              <DayPicker className="col-span-2" value={form.weekdays} onChange={(weekdays) => setForm({ ...form, weekdays })} />
              <input className={input} type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} title="00:00~01:59는 전날 방송일(24~25시)로 저장됩니다" />
              <label className="flex items-center gap-1 text-xs text-zinc-500">
                <input className={`${input} w-full`} type="number" min={1} max={600} value={form.durationMin} onChange={(e) => setForm({ ...form, durationMin: Number(e.target.value) })} title="방영 길이(분)" />분
              </label>
              <select className={input} value={form.constraintType} onChange={(e) => setForm({ ...form, constraintType: e.target.value })}>
                {Object.entries(TYPE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <input className={input} type="date" value={form.activeFrom} onChange={(e) => setForm({ ...form, activeFrom: e.target.value })} title="시작일" />
              <input className={input} type="date" value={form.activeTo} onChange={(e) => setForm({ ...form, activeTo: e.target.value })} title="종료일(선택)" />
            </div>
            <div className="flex items-center gap-2">
              <button type="button" disabled={!form.programName.trim() || form.weekdays.length === 0} onClick={add} className="rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-40">
                {addLabel}
              </button>
              <button type="button" onClick={() => setFormOpen(false)} className="text-xs text-zinc-500 hover:underline">
                닫기
              </button>
              {error && <span className="text-xs text-rose-600" role="alert">{error}</span>}
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setFormOpen(true)} className="rounded-full border border-zinc-300 px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-50">
            + 필수 편성 추가
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-800">필수 편성</h3>
        <p className="text-xs text-zinc-500">주요 콘텐츠 관리에 등록된 본방 요일·시각은 자동으로 반영됩니다. 여기에는 금주 신규·특집·고정 편성만 입력하세요.</p>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-10">
        <input className={`${input} md:col-span-2`} placeholder="프로그램명" value={form.programName} onChange={(e) => setForm({ ...form, programName: e.target.value })} />
        <DayPicker className="col-span-2 md:col-span-3" value={form.weekdays} onChange={(weekdays) => setForm({ ...form, weekdays })} />
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
        <button type="button" disabled={!form.programName.trim() || form.weekdays.length === 0} onClick={add} className="rounded-full bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40">
          {form.weekdays.length > 1 ? `필수 편성 ${form.weekdays.length}개 요일 추가` : "필수 편성 추가"}
        </button>
        <span className="text-xs text-zinc-400">시작 시각 · 길이(분) · 시작일 · 종료일(선택)</span>
        {error && <span className="text-xs text-rose-600" role="alert">{error}</span>}
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
