"use client";

// 라인업 상세 패널(오른쪽 400px) — 막대를 누르면 열린다. 풀네임·기간(실제 날짜 + 정밀도 원문)·회차·주연·제작진·
// 같은 시기 맞대결(서버 계산)·출처·변경 이력. 관리자(lineup_edit)만 같은 패널 안에서 고치기·보관.
import { useEffect, useState } from "react";
import type { LineupPayload, RunDto } from "@/lib/lineup/types";
import { episodeText, GENRE_LABEL, GENRE_VAR, KIND_LABEL, periodText, runGenre, runTitle, slotTime, STATUS_LABEL, dowLabel } from "@/lib/lineup/viewModel";

interface Change { id: number; action: string; diff: Record<string, { before: unknown; after: unknown }>; actor: string; at: string }
const FIELD_KO: Record<string, string> = {
  start_date: "시작", end_date: "종료", episodes: "회차", status: "상태", slot_id: "자리", archived_at: "보관", note: "메모", needs_review: "확인 필요", start_precision: "시작 정밀도", end_precision: "종료 정밀도",
};
const PRECISION_KO: Record<string, string> = { day: "하루 단위", week: "주 단위", month: "월 단위", unknown: "모름", open: "계속" };

export default function DetailPanel({ data, run, onClose, onSelect, onSaved }: { data: LineupPayload; run: RunDto; onClose: () => void; onSelect: (id: string) => void; onSaved: () => void }) {
  const works = new Map(data.works.map((w) => [w.id, w]));
  const slots = new Map(data.slots.map((s) => [s.id, s]));
  const outlets = new Map(data.outlets.map((o) => [o.id, o]));
  const work = run.workId ? works.get(run.workId) : undefined;
  const slot = slots.get(run.slotId);
  const outlet = slot ? outlets.get(slot.outletId) : undefined;
  const source = data.sources.find((s) => s.id === run.sourceId);
  const genre = runGenre(run, work, slot);
  const [changes, setChanges] = useState<Change[] | null>(null);
  const [editing, setEditing] = useState(false);

  // 다른 막대를 고르면 부모가 key로 이 패널을 새로 만들어 상태(이력·고치기)가 초기화된다.
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

  const rivals = run.rivals
    .map((id) => data.runs.find((r) => r.id === id))
    .filter((r): r is RunDto => !!r)
    .sort((a, b) => ((a.startDate ?? "") < (b.startDate ?? "") ? -1 : 1));

  return (
    <aside
      aria-label="라인업 상세"
      className="fixed top-0 right-0 bottom-0 z-50 flex w-[400px] max-w-full flex-col border-l border-zinc-200 bg-white shadow-xl print:hidden"
    >
      <header className="flex items-start gap-2 border-b border-zinc-200 px-4 py-3">
        <span aria-hidden className="mt-1 h-10 w-1 shrink-0 rounded-sm" style={{ background: GENRE_VAR[genre] }} />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] text-zinc-600">
            {outlet?.name} · {slot ? `${dowLabel(slot.days)} ${slotTime(slot)}` : ""} · {GENRE_LABEL[genre]}
          </p>
          <h2 className="text-[17px] leading-snug font-bold text-zinc-900">{runTitle(run, work)}</h2>
        </div>
        <button type="button" onClick={onClose} className="rounded px-2 py-1 text-[13px] text-zinc-600 hover:bg-zinc-100" aria-label="상세 닫기">
          닫기
        </button>
      </header>
      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4 text-[13px] text-zinc-800">
        <dl className="grid grid-cols-[72px_1fr] gap-x-3 gap-y-1.5">
          <dt className="text-zinc-600">기간</dt>
          <dd>
            {run.startDate ?? "모름"} ~ {run.endDate ?? (run.endPrecision === "open" ? "계속" : "모름")}
            <span className="ml-1 text-zinc-600">({PRECISION_KO[run.startPrecision]}{run.startPrecision !== "day" ? ` · 원문 ${periodText(run)}` : ""})</span>
            {run.draw?.estimatedFrom && <span className="block text-[12px] text-zinc-600">끝은 회차로 추정했습니다(≈).</span>}
          </dd>
          <dt className="text-zinc-600">형태</dt>
          <dd>
            {KIND_LABEL[run.runKind]} · {STATUS_LABEL[run.status]}
            {run.recurrence && <span className="text-zinc-600"> · {run.recurrence}</span>}
          </dd>
          {(episodeText(run, work) || work?.totalEpisodes) && (
            <>
              <dt className="text-zinc-600">회차</dt>
              <dd>{episodeText(run, work)}</dd>
            </>
          )}
          {run.draw?.dates && run.draw.dates.length > 1 && (
            <>
              <dt className="text-zinc-600">방송일</dt>
              <dd>{run.draw.dates.map((d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`).join(", ")}</dd>
            </>
          )}
          {work && work.cast.length > 0 && (
            <>
              <dt className="text-zinc-600">주연</dt>
              <dd>{work.cast.join(", ")}</dd>
            </>
          )}
          {work && (work.directors.length > 0 || work.writers.length > 0 || work.producers.length > 0) && (
            <>
              <dt className="text-zinc-600">제작진</dt>
              <dd>{[work.producers.join(", "), work.directors.join(", "), work.writers.join(", ")].filter(Boolean).join(" / ")}</dd>
            </>
          )}
          {work?.note && (
            <>
              <dt className="text-zinc-600">메모</dt>
              <dd className="whitespace-pre-wrap">{work.note}</dd>
            </>
          )}
          {work?.logline && (
            <>
              <dt className="text-zinc-600">로그라인</dt>
              <dd className="whitespace-pre-wrap">{work.logline}</dd>
            </>
          )}
          {work?.ottNote && (
            <>
              <dt className="text-zinc-600">OTT</dt>
              <dd>{work.ottNote}</dd>
            </>
          )}
          {run.note && (
            <>
              <dt className="text-zinc-600">비고</dt>
              <dd>{run.note}</dd>
            </>
          )}
        </dl>
        {run.needsReview && <p className="rounded border border-zinc-300 bg-zinc-50 px-3 py-2 text-[12px] text-zinc-700">확인 필요 — 원자료에서 병합되지 않은 칸 등 자동으로 확신하기 어려운 항목입니다.</p>}

        <section>
          <h3 className="mb-1.5 text-[13px] font-bold text-zinc-900">같은 시기 맞대결 {rivals.length > 0 && <span className="font-normal text-zinc-600">{rivals.length}편</span>}</h3>
          {run.runKind !== "series" || !run.workId ? (
            <p className="text-[12px] text-zinc-600">연속 편성 작품만 맞대결을 계산합니다.</p>
          ) : rivals.length === 0 ? (
            <p className="text-[12px] text-zinc-600">같은 요일·±60분·같은 기간에 겹치는 다른 방송사 작품이 없습니다.</p>
          ) : (
            <ul className="space-y-1">
              {rivals.map((r) => {
                const w = r.workId ? works.get(r.workId) : undefined;
                const s = slots.get(r.slotId);
                const o = s ? outlets.get(s.outletId) : undefined;
                return (
                  <li key={r.id}>
                    <button type="button" onClick={() => onSelect(r.id)} className="flex w-full items-baseline gap-2 rounded px-1.5 py-1 text-left hover:bg-zinc-100">
                      <span className="w-14 shrink-0 text-[12px] font-semibold text-zinc-700">{o?.name}</span>
                      <span className="min-w-0 flex-1 truncate font-medium">{runTitle(r, w)}</span>
                      <span className="shrink-0 text-[12px] text-zinc-600 tabular-nums">
                        {s ? `${dowLabel(s.days)} ${slotTime(s)}` : ""} · {periodText(r)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-1 text-[11px] text-zinc-600">기준: 같은 요일이 겹치고 시작 시각 차이 60분 이내, 실제(또는 회차로 추정한) 방송 기간이 겹침.</p>
        </section>

        <section>
          <h3 className="mb-1.5 text-[13px] font-bold text-zinc-900">출처</h3>
          <p className="text-[12px] text-zinc-700">
            {source ? `${source.title} · 기준일 ${source.asOf}` : "자료 정보 없음"}
            {run.sourceCell && <span className="block text-zinc-600">위치 {run.sourceCell}</span>}
          </p>
          {run.sourceText && <pre className="mt-1 max-h-24 overflow-auto rounded bg-zinc-50 px-2 py-1 text-[11px] whitespace-pre-wrap text-zinc-700">{run.sourceText}</pre>}
        </section>

        <section>
          <h3 className="mb-1.5 text-[13px] font-bold text-zinc-900">변경 이력</h3>
          {changes === null ? (
            <p className="text-[12px] text-zinc-600">불러오는 중…</p>
          ) : changes.length === 0 ? (
            <p className="text-[12px] text-zinc-600">기록 없음</p>
          ) : (
            <ul className="space-y-1 text-[12px] text-zinc-700">
              {changes.slice(0, 5).map((c) => (
                <li key={c.id}>
                  <span className="text-zinc-600 tabular-nums">{c.at.slice(0, 16).replace("T", " ")}</span> ·{" "}
                  {c.action === "create" ? "등록" : c.action === "archive" ? "보관" : c.action === "restore" ? "되살림" : "수정"}
                  {c.action === "update" &&
                    Object.keys(c.diff)
                      .filter((k) => FIELD_KO[k])
                      .map((k) => ` · ${FIELD_KO[k]} ${String(c.diff[k].before ?? "없음")} → ${String(c.diff[k].after ?? "없음")}`)
                      .join("")}
                </li>
              ))}
            </ul>
          )}
        </section>

        {data.canEdit && (editing ? <EditForm run={run} title={work?.title ?? ""} shortTitle={work?.shortTitle ?? ""} cast={work?.cast.join(", ") ?? ""} hasWork={!!work} onDone={() => { setEditing(false); onSaved(); }} /> : (
          <div className="flex gap-2 border-t border-zinc-200 pt-3">
            <button type="button" onClick={() => setEditing(true)} className="rounded border border-zinc-300 px-3 py-1.5 text-[13px] font-medium hover:bg-zinc-50">
              고치기
            </button>
            <ArchiveButton run={run} onDone={onSaved} />
          </div>
        ))}
      </div>
    </aside>
  );
}

function ArchiveButton({ run, onDone }: { run: RunDto; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
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
      className="rounded border border-zinc-300 px-3 py-1.5 text-[13px] text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
    >
      보관
    </button>
  );
}

function EditForm({ run, title, shortTitle, cast, hasWork, onDone }: { run: RunDto; title: string; shortTitle: string; cast: string; hasWork: boolean; onDone: () => void }) {
  const [f, setF] = useState({
    title,
    shortTitle,
    cast,
    status: run.status,
    startDate: run.startDate ?? "",
    endDate: run.endDate ?? "",
    episodes: run.episodes ? String(run.episodes) : "",
    note: run.note ?? "",
    needsReview: run.needsReview,
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = "w-full rounded border border-zinc-300 px-2 py-1 text-[13px]";
  return (
    <form
      className="space-y-2 border-t border-zinc-200 pt-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMsg(null);
        const body: Record<string, unknown> = {
          status: f.status, startDate: f.startDate || null, endDate: f.endDate || null, episodes: f.episodes || null, note: f.note, needsReview: f.needsReview,
        };
        if (hasWork) Object.assign(body, { title: f.title, shortTitle: f.shortTitle || null, cast: f.cast });
        const r = await fetch(`/api/lineup/runs/${run.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const j = await r.json().catch(() => ({}));
        setBusy(false);
        if (!r.ok || !j.ok) setMsg(j.message ?? "저장하지 못했습니다.");
        else onDone();
      }}
    >
      <h3 className="text-[13px] font-bold text-zinc-900">고치기</h3>
      {hasWork && (
        <>
          <label className="block text-[12px] text-zinc-700">
            제목(풀네임)
            <input className={input} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required />
          </label>
          <label className="block text-[12px] text-zinc-700">
            줄임말(막대가 좁을 때만)
            <input className={input} value={f.shortTitle} onChange={(e) => setF({ ...f, shortTitle: e.target.value })} />
          </label>
          <label className="block text-[12px] text-zinc-700">
            주연(쉼표로)
            <input className={input} value={f.cast} onChange={(e) => setF({ ...f, cast: e.target.value })} />
          </label>
        </>
      )}
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-[12px] text-zinc-700">
          시작
          <input type="date" className={input} value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} />
        </label>
        <label className="block text-[12px] text-zinc-700">
          종료
          <input type="date" className={input} value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} />
        </label>
        <label className="block text-[12px] text-zinc-700">
          회차
          <input inputMode="numeric" className={input} value={f.episodes} onChange={(e) => setF({ ...f, episodes: e.target.value.replace(/\D/g, "") })} />
        </label>
        <label className="block text-[12px] text-zinc-700">
          상태
          <select className={input} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as RunDto["status"] })}>
            <option value="confirmed">확정</option>
            <option value="planned">예정</option>
            <option value="tentative">가안</option>
          </select>
        </label>
      </div>
      <label className="block text-[12px] text-zinc-700">
        비고
        <input className={input} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      </label>
      <label className="flex items-center gap-2 text-[12px] text-zinc-700">
        <input type="checkbox" checked={f.needsReview} onChange={(e) => setF({ ...f, needsReview: e.target.checked })} /> 확인 필요 표시
      </label>
      <p className="text-[11px] text-zinc-600">날짜를 고치면 하루 단위 날짜로 저장됩니다. 고친 기록은 변경 이력에 남습니다.</p>
      {msg && <p className="text-[12px] text-red-700">{msg}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="rounded bg-zinc-900 px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-50">
          저장
        </button>
        <button type="button" onClick={onDone} className="rounded border border-zinc-300 px-3 py-1.5 text-[13px]">
          취소
        </button>
      </div>
    </form>
  );
}
