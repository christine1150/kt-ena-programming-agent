"use client";

// 제외 편성 입력 — 종영·방영권 만료·사용 비권장·임시 중단으로 편성표에 넣지 않을 프로그램(사용자 지시 2026-10-06/07).
// 필수 편성 바로 아래에 같은 틀로 둔다. 제목은 쉼표·줄바꿈으로 여러 개를 한 번에 넣을 수 있고, 적용 범위는 이 채널 또는 전 채널, 기간은 선택.
// 제외된 제목은 AI 스마트 편성·홈의 AI 제안에서 새로 배치·추천되지 않고, 실제 편성표 화면에는 영향이 없다.
import { useCallback, useEffect, useState } from "react";

type Exclusion = { id: string; channel_id: string | null; program_name: string; reason: string | null; active_from: string | null; active_to: string | null; created_by: string | null };

export function ExclusionEditor({ channelCode, onChanged }: { channelCode: string; onChanged: () => void }) {
  const [items, setItems] = useState<Exclusion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ names: "", scope: "ALL" as "ALL" | "THIS", reason: "", activeFrom: "", activeTo: "" });

  const load = useCallback(() => {
    fetch(`/api/scheduling/ideal-schedule/exclusions?channel=${encodeURIComponent(channelCode)}`)
      .then((r) => r.json())
      .then((b) => setItems(b.ok ? b.exclusions : []));
  }, [channelCode]);
  useEffect(() => {
    load();
  }, [load]);

  async function add() {
    setError(null);
    const programNames = form.names.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    if (programNames.length === 0) return setError("제외할 프로그램명을 입력해 주세요.");
    const r = await fetch("/api/scheduling/ideal-schedule/exclusions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ programNames, channelCode: form.scope === "THIS" ? channelCode : null, reason: form.reason, activeFrom: form.activeFrom || null, activeTo: form.activeTo || null }),
    });
    const j = await r.json().catch(() => ({ ok: false, message: "응답을 읽지 못했습니다." }));
    if (!j.ok) return setError(j.message ?? "저장하지 못했습니다.");
    setForm((f) => ({ ...f, names: "", reason: "" }));
    load();
    onChanged();
  }
  async function remove(id: string) {
    await fetch(`/api/scheduling/ideal-schedule/exclusions/${id}`, { method: "DELETE" });
    load();
    onChanged();
  }

  const input = "rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm";
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-zinc-500">종영·방영권 만료·사용 비권장 등으로 편성표에 넣지 않을 프로그램입니다. 제외한 제목은 AI가 새로 편성·추천하지 않습니다.</p>
      {items.length > 0 ? (
        <ul className="divide-y divide-zinc-100 text-xs">
          {items.map((x) => (
            <li key={x.id} className="flex items-start justify-between gap-2 py-1.5">
              <div className="min-w-0">
                <p className="truncate font-medium text-zinc-800">{x.program_name}</p>
                <p className="text-zinc-500">
                  {x.channel_id ? "이 채널" : "전 채널"} · {x.active_from || x.active_to ? `${x.active_from ?? "시작일 없음"} ~ ${x.active_to ?? "종료일 없음"}` : "기간 제한 없음"}
                  {x.reason ? ` · ${x.reason}` : ""}
                </p>
              </div>
              <button type="button" onClick={() => remove(x.id)} className="shrink-0 text-rose-600 hover:underline">
                해제
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-zinc-400">제외한 프로그램이 없습니다.</p>
      )}
      {formOpen ? (
        <div className="space-y-2 rounded-xl bg-zinc-50 p-2">
          <textarea className={`${input} w-full`} rows={2} placeholder="제외할 프로그램명(쉼표·줄바꿈으로 여러 개)" value={form.names} onChange={(e) => setForm({ ...form, names: e.target.value })} />
          <div className="grid grid-cols-2 gap-1.5">
            <select className={input} value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value as "ALL" | "THIS" })}>
              <option value="ALL">전 채널 적용</option>
              <option value="THIS">이 채널만</option>
            </select>
            <input className={input} placeholder="사유(선택)" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
            <input className={input} type="date" value={form.activeFrom} onChange={(e) => setForm({ ...form, activeFrom: e.target.value })} title="제외 시작일(선택)" />
            <input className={input} type="date" value={form.activeTo} onChange={(e) => setForm({ ...form, activeTo: e.target.value })} title="제외 종료일(선택, 비우면 계속)" />
          </div>
          <div className="flex items-center gap-2">
            <button type="button" disabled={!form.names.trim()} onClick={add} className="rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-40">
              제외 추가
            </button>
            <button type="button" onClick={() => setFormOpen(false)} className="text-xs text-zinc-500 hover:underline">
              닫기
            </button>
            {error && <span className="text-xs text-rose-600">{error}</span>}
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setFormOpen(true)} className="rounded-full border border-zinc-300 px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-50">
          + 제외 편성 추가
        </button>
      )}
    </div>
  );
}
