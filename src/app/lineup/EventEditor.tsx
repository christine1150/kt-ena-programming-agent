"use client";

// 외부 이벤트 보기·등록·수정(2026-11-26 리디자인, 지시문 §8) — 관리자(lineup_edit)만 저장. 공휴일은 읽기 전용(public_holidays).
// DB 확장 마이그레이션(20261126120000) 승인 전에는 기본 항목(유형 6종·이름·기간·관련 방송사·메모)만 저장되고, 나머지 칸은 잠가 안내한다.
// 검증된 출처가 있는 일정만 등록하도록 출처 URL·확인일 칸을 둔다. 미정 일정을 정확한 날짜로 바꾸지 않도록 날짜 정밀도를 함께 받는다.
import { useEffect, useRef, useState } from "react";
import type { LineupPayload } from "@/lib/lineup/types";
import { EVENT_KIND_ICON, EVENT_KIND_LABEL, EVENT_KINDS, PRECISION_LABEL, type LaneEvent } from "@/lib/lineup/events";
import { dateFull } from "@/lib/lineup/viewModel";
import { Btn, Icon } from "./ui";

export default function EventEditor({ data, event, onClose, onSaved }: { data: LineupPayload; event: LaneEvent | null; onClose: () => void; onSaved: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const holiday = event?.kind === "holiday";
  const src = event?.source ?? null;
  const extended = !!data.eventsExtended;
  const editable = data.canEdit && !holiday;
  const [f, setF] = useState({
    kind: (src?.kind as string) ?? "other",
    name: src?.name ?? "",
    startDate: src?.startDate ?? data.today,
    endDate: src?.endDate ?? data.today,
    allDay: src?.allDay ?? true,
    startTime: src?.startTime ?? "",
    endTime: src?.endTime ?? "",
    precision: src?.precision ?? "day",
    status: src?.status ?? "confirmed",
    importance: String(src?.importance ?? 2),
    outletIds: src?.outletIds ?? [],
    sourceUrl: src?.sourceUrl ?? "",
    verifiedAt: src?.verifiedAt ?? "",
    note: src?.note ?? "",
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = async (archived?: boolean) => {
    setBusy(true);
    setMsg(null);
    const body = archived ? { archived: true } : { ...f, importance: Number(f.importance), startTime: f.allDay ? null : f.startTime || null, endTime: f.allDay ? null : f.endTime || null, verifiedAt: f.verifiedAt || null };
    const r = await fetch(src ? `/api/lineup/events/${src.id}` : "/api/lineup/events", { method: src ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok || !j.ok) return setMsg(j.message ?? "저장하지 못했습니다.");
    if (j.dropped?.length) alert(`저장했습니다. DB 확장 승인 전이라 다음 항목은 저장되지 않았습니다: ${j.dropped.join(", ")}`);
    onSaved();
  };

  const input = "h-9 w-full rounded-[6px] border border-[var(--lu-line)] bg-white px-2.5 text-[13px] text-[var(--lu-text)] focus:border-[var(--lu-accent)] focus:outline-none disabled:bg-[var(--lu-page)] disabled:text-[var(--lu-text-2)]";
  const lab = "block space-y-1 text-[12px] font-medium text-[var(--lu-text-2)]";
  const lockHint = !extended ? " (DB 확장 승인 후)" : "";
  const title = holiday ? "공휴일" : src ? (editable ? "외부 이벤트 수정" : "외부 이벤트") : "외부 이벤트 등록";

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center bg-black/25 p-4 pt-14 print:hidden" onClick={onClose}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="lu-event-title" tabIndex={-1} onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[640px] rounded-[10px] border border-[var(--lu-line)] bg-white p-5 shadow-[0_16px_48px_rgba(23,24,28,0.16)] outline-none">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 id="lu-event-title" className="text-[17px] font-bold text-[var(--lu-text)]">{title}</h2>
            <p className="mt-0.5 text-[12px] text-[var(--lu-text-2)]">라인업 타임라인 위 이벤트 띠와 캘린더 종일 영역에 표시됩니다.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="닫기" className="flex size-7 items-center justify-center rounded-[6px] text-[var(--lu-text-2)] hover:bg-[var(--lu-hover)]"><Icon name="x" /></button>
        </div>

        {holiday || !editable ? (
          <dl className="grid grid-cols-[84px_1fr] gap-x-3 gap-y-2 text-[13px]">
            <dt className="text-[var(--lu-text-2)]">이름</dt>
            <dd className="flex items-center gap-1.5 font-semibold"><Icon name={EVENT_KIND_ICON[event?.kind ?? "other"] ?? "dot"} size={13} />{event?.title}</dd>
            <dt className="text-[var(--lu-text-2)]">유형</dt>
            <dd>{EVENT_KIND_LABEL[event?.kind ?? "other"] ?? "이벤트"}</dd>
            <dt className="text-[var(--lu-text-2)]">기간</dt>
            <dd className="lu-num">{dateFull(event?.from)}{event && event.to !== event.from ? ` ~ ${dateFull(event.to)}` : ""}{event?.time ? ` ${event.time}` : " · 종일"}</dd>
            {event && event.names.length > 1 && (<><dt className="text-[var(--lu-text-2)]">포함</dt><dd>{event.names.join(", ")}</dd></>)}
            {src?.note && (<><dt className="text-[var(--lu-text-2)]">메모</dt><dd className="whitespace-pre-wrap">{src.note}</dd></>)}
            {src?.sourceUrl && (<><dt className="text-[var(--lu-text-2)]">출처</dt><dd><a href={src.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2">원문 열기 <Icon name="external" size={12} /></a>{src.verifiedAt && <span className="ml-2 text-[var(--lu-text-2)]">확인 {dateFull(src.verifiedAt)}</span>}</dd></>)}
            {holiday && (<><dt className="text-[var(--lu-text-2)]">출처</dt><dd className="text-[var(--lu-text-2)]">공휴일 표(public_holidays) — 라인업에서는 고치지 않습니다.</dd></>)}
          </dl>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="space-y-3">
            {!extended && (
              <p className="rounded-[6px] border border-[var(--lu-line)] bg-[var(--lu-page)] px-3 py-2 text-[12px] leading-relaxed text-[var(--lu-text-2)]">
                DB 확장(마이그레이션 승인 대기) 전이라 <b className="font-semibold text-[var(--lu-text)]">유형 6종·이벤트명·기간·관련 방송사·메모</b>만 저장됩니다. 시각·날짜 정밀도·상태·중요도·출처 URL·확인일과 영화 개봉·국가 행사·공연·방송 특집·사내 이벤트 유형은 승인 후 저장됩니다.
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <label className={lab}>
                이벤트 유형
                <select className={input} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
                  {EVENT_KINDS.map((k) => (
                    <option key={k.key} value={k.key} disabled={!extended && !k.base}>{k.label}{!extended && !k.base ? lockHint : ""}</option>
                  ))}
                </select>
              </label>
              <label className={lab}>
                날짜 정밀도{lockHint}
                <select className={input} value={f.precision} disabled={!extended} onChange={(e) => setF({ ...f, precision: e.target.value as typeof f.precision })}>
                  {Object.entries(PRECISION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <label className={`${lab} col-span-2`}>
                이벤트명
                <input className={input} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={120} placeholder="예: 공식 발표된 이름 그대로" />
              </label>
              <label className={lab}>시작일<input type="date" className={input} value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value, endDate: e.target.value > f.endDate ? e.target.value : f.endDate })} required /></label>
              <label className={lab}>종료일<input type="date" className={input} value={f.endDate} min={f.startDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} required /></label>
              <div className={lab}>
                시간{lockHint}
                <div className="flex h-9 items-center gap-2">
                  <label className="flex items-center gap-1.5 text-[13px] text-[var(--lu-text)]">
                    <input type="checkbox" checked={f.allDay} disabled={!extended} onChange={(e) => setF({ ...f, allDay: e.target.checked })} /> 종일
                  </label>
                  {!f.allDay && (
                    <>
                      <input type="time" aria-label="시작 시각" className={`${input} w-[110px]`} value={f.startTime} onChange={(e) => setF({ ...f, startTime: e.target.value })} required />
                      <span className="text-[var(--lu-text-2)]">~</span>
                      <input type="time" aria-label="끝 시각(모르면 비움)" className={`${input} w-[110px]`} value={f.endTime} onChange={(e) => setF({ ...f, endTime: e.target.value })} />
                    </>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className={lab}>
                  상태{lockHint}
                  <select className={input} value={f.status} disabled={!extended} onChange={(e) => setF({ ...f, status: e.target.value as typeof f.status })}>
                    <option value="confirmed">확정</option>
                    <option value="planned">예정</option>
                    <option value="tentative">가안</option>
                  </select>
                </label>
                <label className={lab}>
                  중요도{lockHint}
                  <select className={input} value={f.importance} disabled={!extended} onChange={(e) => setF({ ...f, importance: e.target.value })}>
                    <option value="3">높음</option>
                    <option value="2">보통</option>
                    <option value="1">낮음</option>
                  </select>
                </label>
              </div>
              <label className={lab}>출처 URL{lockHint}<input className={input} type="url" value={f.sourceUrl} disabled={!extended} onChange={(e) => setF({ ...f, sourceUrl: e.target.value })} placeholder="https://" /></label>
              <label className={lab}>출처 확인일{lockHint}<input className={input} type="date" value={f.verifiedAt} disabled={!extended} onChange={(e) => setF({ ...f, verifiedAt: e.target.value })} /></label>
              <fieldset className="col-span-2">
                <legend className="mb-1 text-[12px] font-medium text-[var(--lu-text-2)]">영향받는 방송사(결방·중계 등, 비우면 전체)</legend>
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {data.outlets.filter((o) => !o.ott).map((o) => (
                    <label key={o.id} className="flex items-center gap-1.5 text-[12.5px] text-[var(--lu-text)]">
                      <input type="checkbox" checked={f.outletIds.includes(o.id)} onChange={(e) => setF({ ...f, outletIds: e.target.checked ? [...f.outletIds, o.id] : f.outletIds.filter((x) => x !== o.id) })} />
                      {o.name}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className={`${lab} col-span-2`}>메모<textarea className={`${input} h-16 py-1.5`} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={1000} /></label>
            </div>
            {msg && <p className="text-[12.5px] text-[var(--lu-danger)]">{msg}</p>}
            <div className="flex items-center gap-2 border-t border-[var(--lu-grid)] pt-3">
              {src && <Btn onClick={() => confirm("이 이벤트를 보관할까요? 화면에서 빠지고 변경 이력에 남습니다.") && void save(true)} disabled={busy}>보관</Btn>}
              <span className="ml-auto" />
              <Btn onClick={onClose}>취소</Btn>
              <Btn type="submit" tone="solid" disabled={busy}>저장</Btn>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
