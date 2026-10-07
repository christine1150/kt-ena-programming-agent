"use client";

// 제외 편성 입력 — 종영·방영권 만료·사용 비권장·임시 중단으로 편성표에 넣지 않을 프로그램(사용자 지시 2026-10-06/07).
// 필수 편성 바로 아래에 같은 틀로 둔다. 프로그램명은 검색해서 고르거나 직접 입력해 칩으로 모아 한 번에 추가하고, 사유(선택 목록 + 메모)·적용 범위(이 채널/전 채널)·기간(선택)을 정한다.
// 제외된 제목은 AI 스마트 편성·홈의 AI 제안·"무엇을 편성할까요?" 후보에서 빠지고, 실제 편성표 화면에는 영향이 없다.
import { useCallback, useEffect, useState } from "react";

type Exclusion = { id: string; channel_id: string | null; program_name: string; reason: string | null; active_from: string | null; active_to: string | null; created_by: string | null };

const REASONS = ["종영", "방영권 만료", "임시 중단", "사용 비권장", "기타"] as const;

export function ExclusionEditor({ channelCode, onChanged }: { channelCode: string; onChanged: () => void }) {
  const [items, setItems] = useState<Exclusion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [names, setNames] = useState<string[]>([]);
  const [typed, setTyped] = useState("");
  const [suggest, setSuggest] = useState<string[]>([]);
  const [form, setForm] = useState({ scope: "ALL" as "ALL" | "THIS", reason: "종영" as (typeof REASONS)[number], memo: "", activeFrom: "", activeTo: "" });

  const load = useCallback(() => {
    fetch(`/api/scheduling/ideal-schedule/exclusions?channel=${encodeURIComponent(channelCode)}`)
      .then((r) => r.json())
      .then((b) => setItems(b.ok ? b.exclusions : []));
  }, [channelCode]);
  useEffect(() => {
    load();
  }, [load]);

  // 프로그램명 검색(자동완성) — 입력이 멈춘 뒤 조회
  useEffect(() => {
    const q = typed.trim();
    if (!q) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/scheduling/ideal-schedule/exclusions/programs?channel=${encodeURIComponent(channelCode)}&q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((b) => setSuggest(b.ok ? b.programs : []))
        .catch(() => undefined);
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [typed, channelCode]);

  // 입력이 비면 이전 검색 결과는 보이지 않게(상태를 효과 안에서 바로 바꾸지 않는다)
  const visibleSuggest = typed.trim() ? suggest : [];
  const addName = (n: string) => {
    const v = n.trim();
    if (v && !names.includes(v)) setNames([...names, v]);
    setTyped("");
    setSuggest([]);
  };

  async function add() {
    setError(null);
    const programNames = [...names, ...typed.split(/[,\n]/).map((s) => s.trim()).filter(Boolean)].filter((v, i, a) => a.indexOf(v) === i);
    if (programNames.length === 0) return setError("제외할 프로그램을 입력하거나 골라 주세요.");
    const reason = form.memo.trim() ? `${form.reason} · ${form.memo.trim()}` : form.reason;
    const r = await fetch("/api/scheduling/ideal-schedule/exclusions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ programNames, channelCode: form.scope === "THIS" ? channelCode : null, reason, activeFrom: form.activeFrom || null, activeTo: form.activeTo || null }),
    });
    const j = await r.json().catch(() => ({ ok: false, message: "응답을 읽지 못했습니다." }));
    if (!j.ok) return setError(j.message ?? "저장하지 못했습니다.");
    setNames([]);
    setTyped("");
    setForm((f) => ({ ...f, memo: "" }));
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
      <p className="text-[11px] text-zinc-500">종영·방영권 만료·사용 비권장 등으로 편성표에 넣지 않을 프로그램입니다. AI가 새로 편성·추천하지 않으며 실제 편성표에는 영향이 없습니다.</p>
      {items.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="제외 중인 프로그램">
          {items.map((x) => (
            <li
              key={x.id}
              className="flex items-center gap-1.5 rounded-full bg-zinc-100 py-1 pl-3 pr-1.5 text-xs text-zinc-800"
              title={`${x.channel_id ? "이 채널" : "전 채널"} · ${x.active_from || x.active_to ? `${x.active_from ?? "시작일 없음"} ~ ${x.active_to ?? "종료일 없음"}` : "기간 제한 없음"}${x.reason ? ` · ${x.reason}` : ""}`}
            >
              <span className="font-semibold">{x.program_name}</span>
              <span className="text-zinc-500">
                {x.reason ? x.reason.split(" · ")[0] : ""}
                {x.channel_id ? " · 이 채널" : ""}
                {x.active_to ? ` · ~${x.active_to.slice(5)}` : ""}
              </span>
              <button type="button" onClick={() => remove(x.id)} aria-label={`${x.program_name} 제외 해제`} className="flex h-5 w-5 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-200 hover:text-rose-600">
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-zinc-400">제외한 프로그램이 없습니다.</p>
      )}
      {formOpen ? (
        <div className="space-y-2 rounded-xl bg-zinc-50 p-2">
          <div className="relative">
            <div className="flex flex-wrap gap-1.5">
              {names.map((n) => (
                <span key={n} className="flex items-center gap-1 rounded-full bg-white px-2.5 py-0.5 text-xs font-medium text-zinc-800 ring-1 ring-zinc-200">
                  {n}
                  <button type="button" aria-label={`${n} 빼기`} onClick={() => setNames(names.filter((x) => x !== n))} className="text-zinc-400 hover:text-rose-600">
                    ×
                  </button>
                </span>
              ))}
            </div>
            <input
              className={`${input} mt-1.5 w-full`}
              placeholder="프로그램명 검색 후 선택(또는 직접 입력 후 Enter)"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addName(typed);
                }
              }}
              aria-label="제외할 프로그램명"
              role="combobox"
              aria-controls="exclusion-suggest"
              aria-autocomplete="list"
              aria-expanded={visibleSuggest.length > 0}
            />
            {visibleSuggest.length > 0 && (
              <ul id="exclusion-suggest" role="listbox" className="absolute left-0 right-0 z-10 mt-1 max-h-48 overflow-auto rounded-lg border border-zinc-200 bg-white py-1 text-sm shadow-md">
                {visibleSuggest.map((s) => (
                  <li key={s} role="option" aria-selected={false}>
                    <button type="button" onClick={() => addName(s)} className="block w-full px-3 py-1.5 text-left hover:bg-zinc-50">
                      {s}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <select className={input} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value as (typeof REASONS)[number] })} aria-label="제외 사유">
              {REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <select className={input} value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value as "ALL" | "THIS" })} aria-label="적용 범위">
              <option value="ALL">전 채널 적용</option>
              <option value="THIS">이 채널만</option>
            </select>
            <input className={`${input} col-span-2`} placeholder="메모(선택)" value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} />
            <input className={input} type="date" value={form.activeFrom} onChange={(e) => setForm({ ...form, activeFrom: e.target.value })} title="제외 시작일(선택)" />
            <input className={input} type="date" value={form.activeTo} onChange={(e) => setForm({ ...form, activeTo: e.target.value })} title="제외 종료일(선택, 비우면 계속 — 임시 중단은 기간을 정하세요)" />
          </div>
          <div className="flex items-center gap-2">
            <button type="button" disabled={names.length === 0 && !typed.trim()} onClick={add} className="rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-40">
              {names.length + (typed.trim() ? 1 : 0) > 1 ? `${names.length + (typed.trim() ? 1 : 0)}개 제외 추가` : "제외 추가"}
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
