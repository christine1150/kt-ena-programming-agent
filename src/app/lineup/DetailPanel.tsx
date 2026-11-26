"use client";

// 작품 상세 패널(오른쪽 400px) — 2026-11-26 리디자인(지시문 §6·§9). 타임라인·캘린더·목록이 같은 패널·같은 자료를 쓴다.
// 제목·채널·장르·상태 / 첫 방송·종영·편성·편수·출연진·제작진 / 동시간대 맞대결·같은 장르 기간 중첩·가까운 첫방·OTT 공개·외부 이벤트 /
// 자료 출처·기준일 / 변경 이력 / 고치기(관리자). 점수·예측치를 만들지 않고 서버 자료만 보여 준다. 포스터는 만들지 않는다.
import { useEffect, useMemo, useState } from "react";
import type { Genre, LineupPayload, OutletDto, RunDto, SlotDto, WorkDto } from "@/lib/lineup/types";
import {
  dateFull, episodeText, GENRE_LABEL, kindLabel, periodDot, relatedFor, runGenre, runTitle, slotLabel, STATUS_LABEL, workNote,
} from "@/lib/lineup/viewModel";
import { EVENT_KIND_ICON, EVENT_KIND_LABEL, eventsBetween, laneEvents, type LaneEvent } from "@/lib/lineup/events";
import { GENRE_FILL, GENRE_ON, UI } from "@/lib/lineup/tokens";
import { Btn, cx, Icon, OutletLogo } from "./ui";

interface Change { id: number; action: string; diff: Record<string, { before: unknown; after: unknown }>; actor: string; at: string }
const FIELD_KO: Record<string, string> = {
  start_date: "시작", end_date: "종료", episodes: "편수", status: "상태", slot_id: "자리", archived_at: "보관", note: "메모", needs_review: "확인 필요", start_precision: "시작 정밀도", end_precision: "종료 정밀도",
};
const PRECISION_KO: Record<string, string> = { day: "일자 확정", week: "주 단위", month: "월 단위", unknown: "미정", open: "계속" };
const SOURCE_KIND_KO: Record<string, string> = { own_xlsx: "KT ENA 라인업 엑셀", industry_xlsx: "업계 드라마 종합본", outlet_xlsx: "방송사 라인업", standard_xlsx: "표준 양식", paste: "붙여넣기", manual: "직접 수정" };

export default function DetailPanel({
  data, run, onClose, onSelect, onSaved, onSelectEvent,
}: { data: LineupPayload; run: RunDto; onClose: () => void; onSelect: (id: string) => void; onSaved: () => void; onSelectEvent?: (ev: LaneEvent) => void }) {
  const works = new Map(data.works.map((w) => [w.id, w]));
  const slots = new Map(data.slots.map((s) => [s.id, s]));
  const outlets = new Map(data.outlets.map((o) => [o.id, o]));
  const work = run.workId ? works.get(run.workId) : undefined;
  const slot = slots.get(run.slotId);
  const outlet = slot ? outlets.get(slot.outletId) : undefined;
  const genre = runGenre(run, work, slot);
  const note = workNote(work?.note);
  const own = outlet?.side === "own";
  const [changes, setChanges] = useState<Change[] | null>(null);
  const [editing, setEditing] = useState(false);
  const related = useMemo(() => relatedFor(data, run), [data, run]);
  const events = useMemo(() => {
    if (!run.startDate) return [];
    const to = run.endDate ?? run.draw?.to ?? run.startDate;
    return eventsBetween(laneEvents(data), run.startDate, to).slice(0, 10);
  }, [data, run]);
  const source = run.sourceId ? data.sources.find((s) => s.id === run.sourceId) : undefined;

  useEffect(() => {
    let alive = true;
    fetch(`/api/lineup/runs/${run.id}`)
      .then((r) => r.json())
      .then((j) => alive && setChanges(j.ok ? j.changes : []))
      .catch(() => alive && setChanges([]));
    return () => {
      alive = false;
    };
  }, [run.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const endText = run.endDate ? dateFull(run.endDate) : run.endPrecision === "open" ? "종료 미정(계속)" : run.draw?.estimatedFrom ? "편수로 추정(≈)" : "미정";
  const runRef = (r: RunDto) => {
    const w = r.workId ? works.get(r.workId) : undefined;
    const s = slots.get(r.slotId);
    const o = s ? outlets.get(s.outletId) : undefined;
    return { w, s, o, g: runGenre(r, w, s) };
  };

  return (
    <aside aria-label="작품 상세" className="fixed top-0 right-0 bottom-0 z-[80] flex w-[400px] max-w-full flex-col border-l border-[var(--lu-line)] bg-white shadow-[-12px_0_32px_rgba(23,24,28,0.08)] print:hidden">
      <header className="border-b border-[var(--lu-line)] px-5 pt-4 pb-3.5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <OutletLogo logo={outlet?.logo ?? null} name={outlet?.name ?? ""} height={15} mono={!own} maxWidth={72} className="text-[13px]" />
            <span className="text-[12px] text-[var(--lu-text-2)]">{own ? "" : outlet?.ott ? "OTT" : "경쟁사"}</span>
          </span>
          <button type="button" onClick={onClose} aria-label="상세 닫기" className="flex size-7 items-center justify-center rounded-[6px] text-[var(--lu-text-2)] hover:bg-[var(--lu-hover)]">
            <Icon name="x" />
          </button>
        </div>
        <h2 className="text-[20px] leading-snug font-bold text-[var(--lu-text)]">{runTitle(run, work)}</h2>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px]">
          <span className="inline-flex h-5 items-center rounded-[3px] px-1.5 font-semibold" style={own ? { background: GENRE_FILL[genre], color: GENRE_ON[genre] } : { background: "#fff", color: UI.text, border: `1.5px solid ${GENRE_FILL[genre]}` }}>
            {GENRE_LABEL[genre]}
          </span>
          <span className={cx("inline-flex h-5 items-center rounded-[3px] border px-1.5 font-semibold", run.status === "confirmed" ? "border-[var(--lu-text)] text-[var(--lu-text)]" : "border-dashed border-[var(--lu-text-2)] text-[var(--lu-text-2)]")}>
            {STATUS_LABEL[run.status]}
          </span>
          <span className="text-[var(--lu-text-2)]">{kindLabel(run, !!outlet?.ott)}</span>
          {run.needsReview && <span className="inline-flex h-5 items-center rounded-[3px] bg-[var(--lu-text)] px-1.5 font-semibold text-white">확인 필요</span>}
        </div>
      </header>

      <div className="lu-scroll flex-1 overflow-y-auto px-5 py-4 text-[13px] text-[var(--lu-text)]">
        <dl className="grid grid-cols-[76px_1fr] gap-x-3 gap-y-2">
          <Field label="첫 방송">{run.startDate ? <span className="lu-num">{dateFull(run.startDate)} <Muted>{PRECISION_KO[run.startPrecision]}{run.startPrecision !== "day" && run.startText ? ` · 원문 ${run.startText}` : ""}</Muted></span> : "미정 (발표 전)"}</Field>
          <Field label={outlet?.ott ? "공개 종료" : "종영"}><span className="lu-num">{endText}</span>{run.endDate && run.endPrecision !== "day" && <Muted> {PRECISION_KO[run.endPrecision]}</Muted>}</Field>
          {!outlet?.ott && slot && <Field label="편성">{slotLabel(slot, outlet) || "—"}{slot.startMinute === null && <Muted> · 시각 미확인</Muted>}</Field>}
          <Field label="기간"><span className="lu-num">{periodDot(run)}</span></Field>
          {(episodeText(run, work) || run.recurrence) && <Field label="편수">{episodeText(run, work) || "—"}{run.recurrence && <Muted> · {run.recurrence}</Muted>}</Field>}
          {run.draw?.dates && run.draw.dates.length > 1 && <Field label="방송일"><span className="lu-num">{run.draw.dates.map((d) => d.slice(5).replace("-", ".")).join(", ")}</span></Field>}
          {work && work.cast.length > 0 && <Field label={genre === "drama" ? "주연" : "출연진"}>{work.cast.join(", ")}</Field>}
          {work && (work.directors.length > 0 || work.writers.length > 0 || work.producers.length > 0) && <Field label="제작진">{[work.producers.join(", "), work.directors.join(", "), work.writers.join(", ")].filter(Boolean).join(" / ")}</Field>}
          {note && <Field label={note.label}><span className="whitespace-pre-wrap">{note.text}</span></Field>}
          {work?.logline && <Field label="로그라인"><span className="whitespace-pre-wrap">{work.logline}</span></Field>}
          {work?.ottNote && <Field label="OTT">{work.ottNote}</Field>}
          {run.note && <Field label="메모">{run.note}</Field>}
        </dl>
        {run.draw?.estimatedFrom && <p className="mt-2 text-[12px] text-[var(--lu-text-2)]">종영일이 발표되지 않아 편수로 끝을 추정했습니다(≈). 막대 끝의 흐린 부분이 추정 구간입니다.</p>}

        {!outlet?.ott && run.runKind === "series" && (
          <Section title="동시간대 맞대결" count={related.rivals.length} hint="같은 요일 · 시작 ±60분 · 기간 겹침(시각 확인된 자리만)">
            {related.rivals.length === 0 ? <Empty>{slot?.startMinute === null ? "편성 시각이 확인되지 않아 동시간대 경쟁을 확정하지 않았습니다." : "겹치는 다른 방송사 작품이 없습니다."}</Empty> : related.rivals.map((r) => <RunRow key={r.id} r={r} info={runRef(r)} onSelect={onSelect} />)}
          </Section>
        )}
        {related.overlap.length > 0 && (
          <Section title="같은 장르 · 기간 중첩" count={related.overlap.length} hint="시각과 무관하게 방송 기간이 겹치는 같은 장르">
            {related.overlap.map((r) => <RunRow key={r.id} r={r} info={runRef(r)} onSelect={onSelect} />)}
          </Section>
        )}
        {related.nearby.length > 0 && (
          <Section title="가까운 첫방" count={related.nearby.length} hint="첫방일 ±14일">
            {related.nearby.map((r) => <RunRow key={r.id} r={r} info={runRef(r)} onSelect={onSelect} showStart />)}
          </Section>
        )}
        {related.ott.length > 0 && (
          <Section title="방송 기간 중 OTT 공개" count={related.ott.length}>
            {related.ott.map((r) => <RunRow key={r.id} r={r} info={runRef(r)} onSelect={onSelect} showStart />)}
          </Section>
        )}
        <Section title="관련 외부 이벤트" count={events.length} hint="방송 기간 안의 공휴일·등록 이벤트">
          {events.length === 0 ? (
            <Empty>방송 기간 안에 등록된 공휴일·이벤트가 없습니다.</Empty>
          ) : (
            events.map((ev) => (
              <button key={ev.key} type="button" onClick={() => onSelectEvent?.(ev)} className="flex w-full items-center gap-2.5 rounded-[4px] px-1 py-1.5 text-left hover:bg-[var(--lu-hover)]">
                <span className="lu-num w-[46px] shrink-0 text-[12px] text-[var(--lu-text-2)]">{ev.from.slice(5).replace("-", ".")}</span>
                <Icon name={EVENT_KIND_ICON[ev.kind] ?? "dot"} size={13} className="text-[var(--lu-text-2)]" />
                <span className="min-w-0 flex-1 truncate font-medium">{ev.title}</span>
                <span className="shrink-0 text-[11.5px] text-[var(--lu-text-2)]">{EVENT_KIND_LABEL[ev.kind] ?? "이벤트"}</span>
              </button>
            ))
          )}
        </Section>

        <Section title="자료 출처">
          {source ? (
            <div className="space-y-0.5 px-1 text-[12.5px]">
              <p className="font-medium">{source.title}</p>
              <p className="lu-num text-[var(--lu-text-2)]">{SOURCE_KIND_KO[source.kind] ?? source.kind} · 기준일 {dateFull(source.asOf)} · 반영 {source.appliedAt.slice(0, 10).replaceAll("-", ".")}</p>
              {run.sourceCell && <p className="text-[var(--lu-text-2)]">원자료 위치 {run.sourceCell}</p>}
              {run.sourceText && <p className="text-[var(--lu-text-2)]">원문 “{run.sourceText.slice(0, 120)}”</p>}
            </div>
          ) : (
            <Empty>출처 기록이 없습니다{run.updatedAt ? ` · 마지막 수정 ${run.updatedAt.slice(0, 10).replaceAll("-", ".")}` : ""}.</Empty>
          )}
        </Section>

        <Section title="수정 이력">
          {changes === null ? (
            <Empty>불러오는 중…</Empty>
          ) : changes.length === 0 ? (
            <Empty>기록 없음</Empty>
          ) : (
            <ul className="space-y-1 px-1 text-[12px] text-[var(--lu-text-2)]">
              {changes.slice(0, 6).map((c) => (
                <li key={c.id} className="flex gap-2">
                  <span className="lu-num shrink-0">{c.at.slice(0, 16).replace("T", " ").replaceAll("-", ".")}</span>
                  <span className="min-w-0">
                    <b className="font-semibold text-[var(--lu-text)]">{c.action === "create" ? "등록" : c.action === "archive" ? "보관" : c.action === "restore" ? "되살림" : "수정"}</b>
                    {c.action === "update" &&
                      Object.keys(c.diff)
                        .filter((k) => FIELD_KO[k])
                        .map((k) => ` · ${FIELD_KO[k]} ${String(c.diff[k].before ?? "없음")} → ${String(c.diff[k].after ?? "없음")}`)
                        .join("")}
                    <span className="ml-1">({c.actor})</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {data.canEdit &&
          (editing ? (
            <EditForm run={run} genre={work?.genre ?? genre} title={work?.title ?? ""} shortTitle={work?.shortTitle ?? ""} cast={work?.cast.join(", ") ?? ""} hasWork={!!work} onDone={() => { setEditing(false); onSaved(); }} onCancel={() => setEditing(false)} />
          ) : (
            <div className="mt-4 flex gap-2 border-t border-[var(--lu-line)] pt-3">
              <Btn tone="solid" onClick={() => setEditing(true)}>편집</Btn>
              <ArchiveButton run={run} onDone={onSaved} />
            </div>
          ))}
      </div>
    </aside>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-[12.5px] text-[var(--lu-text-2)]">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}
const Muted = ({ children }: { children: React.ReactNode }) => <span className="text-[12px] text-[var(--lu-text-2)]">{children}</span>;
const Empty = ({ children }: { children: React.ReactNode }) => <p className="px-1 py-1 text-[12px] text-[var(--lu-text-2)]">{children}</p>;

function Section({ title, count, hint, children }: { title: string; count?: number; hint?: string; children: React.ReactNode }) {
  return (
    <section className="mt-4 border-t border-[var(--lu-grid)] pt-3">
      <h3 className="mb-1 flex items-baseline gap-1.5 text-[12.5px] font-semibold text-[var(--lu-text)]">
        <span className="shrink-0 whitespace-nowrap">{title}</span>
        {count !== undefined && count > 0 && <span className="lu-num font-normal text-[var(--lu-text-2)]">{count}</span>}
        {hint && <span className="ml-auto truncate text-[11px] font-normal text-[var(--lu-text-2)]">{hint}</span>}
      </h3>
      {children}
    </section>
  );
}

function RunRow({ r, info, onSelect, showStart = false }: { r: RunDto; info: { w: WorkDto | undefined; s: SlotDto | undefined; o: OutletDto | undefined; g: Genre }; onSelect: (id: string) => void; showStart?: boolean }) {
  const own = info.o?.side === "own";
  return (
    <button type="button" onClick={() => onSelect(r.id)} className="flex w-full items-center gap-2 rounded-[4px] px-1 py-1.5 text-left hover:bg-[var(--lu-hover)]">
      {/* 장르 표식 — 목록과 같은 작은 사각형(자사 채움 · 경쟁사 아웃라인) */}
      <span aria-hidden className="inline-block size-2.5 shrink-0 rounded-[2px]" style={own ? { background: GENRE_FILL[info.g] } : { background: "#fff", border: `1.5px solid ${GENRE_FILL[info.g]}` }} />
      <span className="w-[52px] shrink-0 truncate text-[11.5px] font-semibold text-[var(--lu-text-2)]">{info.o?.name}</span>
      <span className="min-w-0 flex-1 truncate font-semibold">{runTitle(r, info.w)}</span>
      <span className="lu-num shrink-0 text-[11.5px] text-[var(--lu-text-2)]">{showStart ? `${r.startPrecision === "week" ? "≈" : ""}${(r.startDate ?? "").slice(5).replace("-", ".")}` : `${info.s && !info.o?.ott ? `${slotLabel(info.s, info.o)} · ` : ""}${periodDot(r)}`}</span>
      {r.status !== "confirmed" && <span className="shrink-0 text-[10.5px] text-[var(--lu-text-2)]">예정</span>}
    </button>
  );
}

function ArchiveButton({ run, onDone }: { run: RunDto; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Btn
      disabled={busy}
      onClick={async () => {
        if (!confirm("이 구간을 보관할까요? 화면에서 빠지고, 자료 관리의 변경 이력에서 되살릴 수 있습니다.")) return;
        setBusy(true);
        const r = await fetch(`/api/lineup/runs/${run.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ archived: true }) });
        setBusy(false);
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) alert(j.message ?? "보관하지 못했습니다.");
        else onDone();
      }}
    >
      보관
    </Btn>
  );
}

function EditForm({ run, genre, title, shortTitle, cast, hasWork, onDone, onCancel }: { run: RunDto; genre: Genre; title: string; shortTitle: string; cast: string; hasWork: boolean; onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState({
    genre, title, shortTitle, cast, status: run.status, startDate: run.startDate ?? "", endDate: run.endDate ?? "", episodes: run.episodes ? String(run.episodes) : "", note: run.note ?? "", needsReview: run.needsReview,
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = "h-8 w-full rounded-[6px] border border-[var(--lu-line)] px-2 text-[13px] focus:border-[var(--lu-accent)] focus:outline-none";
  const lab = "block space-y-1 text-[12px] text-[var(--lu-text-2)]";
  return (
    <form
      className="mt-4 space-y-2.5 border-t border-[var(--lu-line)] pt-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMsg(null);
        const body: Record<string, unknown> = { status: f.status, startDate: f.startDate || null, endDate: f.endDate || null, episodes: f.episodes || null, note: f.note, needsReview: f.needsReview };
        if (hasWork) Object.assign(body, { title: f.title, shortTitle: f.shortTitle || null, cast: f.cast, genre: f.genre });
        const r = await fetch(`/api/lineup/runs/${run.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const j = await r.json().catch(() => ({}));
        setBusy(false);
        if (!r.ok || !j.ok) setMsg(j.message ?? "저장하지 못했습니다.");
        else onDone();
      }}
    >
      <h3 className="text-[13px] font-semibold text-[var(--lu-text)]">편집</h3>
      {hasWork && (
        <>
          <label className={lab}>제목(풀네임)<input className={input} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className={lab}>
              장르
              <select className={input} value={f.genre} onChange={(e) => setF({ ...f, genre: e.target.value as Genre })}>
                {(["drama", "variety", "business", "other"] as Genre[]).map((g) => <option key={g} value={g}>{GENRE_LABEL[g]}</option>)}
              </select>
            </label>
            <label className={lab}>줄임말(좁을 때만)<input className={input} value={f.shortTitle} onChange={(e) => setF({ ...f, shortTitle: e.target.value })} /></label>
          </div>
          <label className={lab}>출연진(쉼표로)<input className={input} value={f.cast} onChange={(e) => setF({ ...f, cast: e.target.value })} /></label>
        </>
      )}
      <div className="grid grid-cols-2 gap-2">
        <label className={lab}>시작<input type="date" className={input} value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></label>
        <label className={lab}>종료<input type="date" className={input} value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></label>
        <label className={lab}>편수<input inputMode="numeric" className={input} value={f.episodes} onChange={(e) => setF({ ...f, episodes: e.target.value.replace(/\D/g, "") })} /></label>
        <label className={lab}>
          상태
          <select className={input} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as RunDto["status"] })}>
            <option value="confirmed">확정</option>
            <option value="planned">예정</option>
            <option value="tentative">가안</option>
          </select>
        </label>
      </div>
      <label className={lab}>메모<input className={input} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
      <label className="flex items-center gap-2 text-[12px] text-[var(--lu-text)]">
        <input type="checkbox" checked={f.needsReview} onChange={(e) => setF({ ...f, needsReview: e.target.checked })} /> 확인 필요 표시
      </label>
      <p className="text-[11.5px] text-[var(--lu-text-2)]">날짜를 고치면 일자 확정으로 저장됩니다. 고친 기록은 수정 이력에 남습니다.</p>
      {msg && <p className="text-[12px] text-[var(--lu-danger)]">{msg}</p>}
      <div className="flex gap-2">
        <Btn type="submit" tone="solid" disabled={busy}>저장</Btn>
        <Btn onClick={onCancel}>취소</Btn>
      </div>
    </form>
  );
}
