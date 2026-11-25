"use client";

// 라인업 자료 관리 — 파일 고르기 → 미리보기(새로 생김·바뀜·건너뜀·확인 필요·사라짐 후보) → 반영 → 필요하면 업로드 단위 되돌리기.
// 원본 파일은 서버에 저장하지 않는다(파일 이름·해시·셀 원문만). 확인 필요 항목은 기본으로 반영하지 않는다.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface PreviewAction {
  kind: "create" | "update" | "skip" | "review";
  outlet: string;
  slot: string;
  title: string;
  runKind: string;
  start: string | null;
  end: string | null;
  precision: string;
  episodes: number | null;
  cast: string[];
  changes: { field: string; label: string; before: unknown; after: unknown }[];
  note: string | null;
  cell: string;
}
interface Preview {
  fileName: string;
  title: string;
  asOf: string | null;
  period: { from: string; to: string } | null;
  warnings: string[];
  counts: Record<"create" | "update" | "same" | "skip" | "review" | "missing", number>;
  actions: PreviewAction[];
  missing: { runId: string; outletCode: string; slotName: string; title: string; start: string | null; end: string | null }[];
}
interface Source { id: string; kind: string; title: string; asOf: string; fileName: string | null; status: string; appliedAt: string; appliedBy: string; summary: Record<string, number> }
interface Change { id: number; entity: string; entityId: string; action: string; diff: Record<string, { before: unknown; after: unknown }>; actor: string; at: string }

const KIND_KO: Record<string, string> = { create: "새로 생김", update: "바뀜", skip: "건너뜀", review: "확인 필요" };
const SOURCE_KO: Record<string, string> = { own_xlsx: "자사 라인업", industry_xlsx: "업계 종합본", manual: "직접 수정" };
const fmt = (v: unknown) => (v === null || v === undefined || v === "" ? "없음" : Array.isArray(v) ? v.join(", ") : String(v));

export default function ManageView({ ownChannels }: { ownChannels: { code: string; name: string }[] }) {
  const [kind, setKind] = useState<"own" | "industry">("own");
  const [outletCode, setOutletCode] = useState("ENA");
  const [asOf, setAsOf] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [includeReview, setIncludeReview] = useState(false);
  const [archiveMissing, setArchiveMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [changes, setChanges] = useState<Change[]>([]);

  const [sourcesKey, setSourcesKey] = useState(0);
  const loadSources = useCallback(() => setSourcesKey((k) => k + 1), []);
  useEffect(() => {
    let alive = true;
    fetch("/api/lineup/sources", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!alive || !j.ok) return;
        setSources(j.sources);
        setChanges(j.changes);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [sourcesKey]);

  const send = async (mode: "preview" | "commit") => {
    if (!file) return;
    setBusy(true);
    setMsg(null);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("kind", kind);
    fd.set("mode", mode);
    fd.set("outletCode", outletCode);
    if (asOf) fd.set("asOf", asOf);
    fd.set("includeReview", String(includeReview));
    fd.set("archiveMissing", String(archiveMissing));
    const r = await fetch("/api/lineup/upload", { method: "POST", body: fd });
    const j = await r.json().catch(() => ({ ok: false, message: "응답을 읽지 못했습니다." }));
    setBusy(false);
    if (!r.ok || !j.ok) {
      setMsg({ ok: false, text: j.message ?? "처리하지 못했습니다." });
      return;
    }
    if (mode === "preview") {
      setPreview(j as Preview);
      if (!asOf && j.asOf) setAsOf(j.asOf);
    } else {
      const c = j.counts as Record<string, number>;
      setMsg({ ok: true, text: `반영했습니다 — 새로 ${c.created}건, 바뀜 ${c.updated}건, 그대로 ${c.same}건, 건너뜀 ${c.skipped}건${c.reviewApplied ? `, 확인 필요 반영 ${c.reviewApplied}건` : ""}${c.archived ? `, 보관 ${c.archived}건` : ""}.` });
      setPreview(null);
      setFile(null);
      void loadSources();
    }
  };

  const rollback = async (s: Source) => {
    if (!confirm(`'${s.title}'(${s.asOf}) 업로드를 되돌릴까요? 이 자료로 생긴 구간은 보관되고, 바뀐 구간은 바뀌기 전 값으로 돌아갑니다.`)) return;
    const r = await fetch(`/api/lineup/sources/${s.id}/rollback`, { method: "POST" });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok && j.ok ? { ok: true, text: `되돌렸습니다 — 보관 ${j.archived}건, 원래 값으로 ${j.restored}건.` } : { ok: false, text: j.message ?? "되돌리지 못했습니다." });
    void loadSources();
  };

  const restore = async (runId: string) => {
    const r = await fetch(`/api/lineup/runs/${runId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ archived: false }) });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok && j.ok ? { ok: true, text: "되살렸습니다." } : { ok: false, text: j.message ?? "되살리지 못했습니다." });
    void loadSources();
  };

  const input = "rounded border border-zinc-300 px-2 py-1 text-[13px]";
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-5 text-[13px] text-zinc-800">
      <div className="mb-4 flex items-baseline gap-3">
        <h1 className="text-[18px] font-bold text-zinc-900">라인업 자료 관리</h1>
        <Link href="/lineup" className="text-[13px] text-zinc-600 underline-offset-2 hover:underline">
          ← 라인업으로
        </Link>
      </div>
      <p className="mb-4 rounded border border-zinc-200 bg-zinc-50 px-3 py-2 text-[12px] text-zinc-700">
        대외비 자료입니다. 원본 파일은 서버에 저장하지 않고 해석한 값과 셀 원문만 남깁니다. 문서보안(DRM)이 걸린 파일은 해제한 뒤 올려 주세요.
      </p>

      <section className="mb-6 rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="mb-3 text-[15px] font-bold text-zinc-900">엑셀 올리기</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-[12px] text-zinc-600">양식</span>
            <select className={input} value={kind} onChange={(e) => { setKind(e.target.value as "own" | "industry"); setPreview(null); }}>
              <option value="own">자사 라인업 양식(편성센터)</option>
              <option value="industry">업계 드라마 라인업 종합본</option>
            </select>
          </label>
          {kind === "own" && (
            <label className="block">
              <span className="mb-1 block text-[12px] text-zinc-600">채널</span>
              <select className={input} value={outletCode} onChange={(e) => { setOutletCode(e.target.value); setPreview(null); }}>
                {ownChannels.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="block">
            <span className="mb-1 block text-[12px] text-zinc-600">자료 기준일</span>
            <input type="date" className={input} value={asOf} onChange={(e) => setAsOf(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] text-zinc-600">파일(.xlsx)</span>
            <input type="file" accept=".xlsx" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); }} className="text-[13px]" />
          </label>
          <button type="button" disabled={!file || busy} onClick={() => send("preview")} className="rounded bg-zinc-900 px-3 py-1.5 font-medium text-white disabled:opacity-40">
            {busy && !preview ? "읽는 중…" : "미리보기"}
          </button>
        </div>
        {kind === "industry" && <p className="mt-2 text-[12px] text-zinc-600">업계 종합본은 2026 하반기 시트부터 읽습니다. 자사(ENA) 줄은 자사 라인업 자료에 없는 작품만 넣습니다.</p>}
        {msg && <p className={`mt-3 rounded px-3 py-2 ${msg.ok ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-800"}`}>{msg.text}</p>}

        {preview && (
          <div className="mt-4 border-t border-zinc-200 pt-4">
            <p className="mb-2">
              <b>{preview.title}</b> · {preview.fileName}
              {preview.period && <span className="text-zinc-600"> · 기간 {preview.period.from} ~ {preview.period.to}</span>}
            </p>
            <ul className="mb-3 flex flex-wrap gap-2">
              {(["create", "update", "same", "skip", "review", "missing"] as const).map((k) => (
                <li key={k} className="rounded border border-zinc-200 px-2.5 py-1">
                  {k === "same" ? "그대로" : k === "missing" ? "사라짐 후보" : KIND_KO[k]} <b className="tabular-nums">{preview.counts[k]}</b>
                </li>
              ))}
            </ul>
            {preview.warnings.length > 0 && (
              <ul className="mb-3 list-disc space-y-0.5 pl-5 text-[12px] text-zinc-700">
                {preview.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
            <div className="max-h-[420px] overflow-auto rounded border border-zinc-200">
              <table className="w-full text-[12px]">
                <thead className="sticky top-0 bg-zinc-50 text-left text-zinc-600">
                  <tr>
                    <th className="px-2 py-1.5">구분</th>
                    <th className="px-2 py-1.5">방송사</th>
                    <th className="px-2 py-1.5">자리</th>
                    <th className="px-2 py-1.5">제목</th>
                    <th className="px-2 py-1.5">기간</th>
                    <th className="px-2 py-1.5">회차</th>
                    <th className="px-2 py-1.5">바뀐 점·메모</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.actions.map((a, i) => (
                    <tr key={i} className="border-t border-zinc-100 align-top">
                      <td className="px-2 py-1 whitespace-nowrap font-medium">{KIND_KO[a.kind]}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{a.outlet}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{a.slot}</td>
                      <td className="px-2 py-1">{a.title}</td>
                      <td className="px-2 py-1 whitespace-nowrap tabular-nums">
                        {a.start} ~ {a.end ?? "?"} {a.precision !== "day" && <span className="text-zinc-600">({a.precision === "week" ? "주" : a.precision === "month" ? "월" : "?"})</span>}
                      </td>
                      <td className="px-2 py-1">{a.episodes ?? ""}</td>
                      <td className="px-2 py-1 text-zinc-700">
                        {a.changes.map((c) => `${c.label} ${fmt(c.before)} → ${fmt(c.after)}`).join(" · ")}
                        {a.note && <span className="block text-zinc-600">{a.note}</span>}
                        <span className="block text-[11px] text-zinc-500">{a.cell}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.missing.length > 0 && (
              <div className="mt-3">
                <p className="mb-1 font-semibold">사라짐 후보 {preview.missing.length}건 — 같은 종류 자료로 들어왔던 구간 중 이번 파일 기간 안인데 파일에 없는 것</p>
                <ul className="list-disc pl-5 text-[12px] text-zinc-700">
                  {preview.missing.slice(0, 30).map((m) => (
                    <li key={m.runId}>
                      {m.outletCode} · {m.slotName} · {m.title} ({m.start} ~ {m.end ?? "?"})
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={includeReview} onChange={(e) => setIncludeReview(e.target.checked)} /> 확인 필요 {preview.counts.review}건도 반영(‘확인’ 표시를 달고 넣음)
              </label>
              {preview.missing.length > 0 && (
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={archiveMissing} onChange={(e) => setArchiveMissing(e.target.checked)} /> 사라짐 후보 {preview.missing.length}건 보관
                </label>
              )}
              <button type="button" disabled={busy || !asOf} onClick={() => send("commit")} className="rounded bg-zinc-900 px-3 py-1.5 font-medium text-white disabled:opacity-40">
                {busy ? "반영 중…" : "반영"}
              </button>
              {!asOf && <span className="text-[12px] text-zinc-600">자료 기준일을 넣어야 반영할 수 있습니다.</span>}
            </div>
          </div>
        )}
      </section>

      <section className="mb-6 rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="mb-3 text-[15px] font-bold text-zinc-900">올린 자료</h2>
        {sources.length === 0 ? (
          <p className="text-zinc-600">아직 올린 자료가 없습니다.</p>
        ) : (
          <table className="w-full text-[12px]">
            <thead className="text-left text-zinc-600">
              <tr>
                <th className="py-1 pr-2">반영 시각</th>
                <th className="py-1 pr-2">종류</th>
                <th className="py-1 pr-2">자료</th>
                <th className="py-1 pr-2">기준일</th>
                <th className="py-1 pr-2">결과</th>
                <th className="py-1 pr-2">반영한 사람</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.id} className="border-t border-zinc-100">
                  <td className="py-1 pr-2 tabular-nums">{s.appliedAt.slice(0, 16).replace("T", " ")}</td>
                  <td className="py-1 pr-2">{SOURCE_KO[s.kind] ?? s.kind}</td>
                  <td className="py-1 pr-2">{s.fileName ?? s.title}</td>
                  <td className="py-1 pr-2 tabular-nums">{s.asOf}</td>
                  <td className="py-1 pr-2">
                    {s.status === "rolled_back"
                      ? "되돌림"
                      : s.kind === "manual"
                        ? "—"
                        : `새로 ${s.summary.created ?? 0} · 바뀜 ${s.summary.updated ?? 0}${s.summary.archived ? ` · 보관 ${s.summary.archived}` : ""}`}
                  </td>
                  <td className="py-1 pr-2">{s.appliedBy}</td>
                  <td className="py-1 text-right">
                    {s.status === "applied" && s.kind !== "manual" && (
                      <button type="button" onClick={() => rollback(s)} className="rounded border border-zinc-300 px-2 py-0.5 hover:bg-zinc-50">
                        되돌리기
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="mb-3 text-[15px] font-bold text-zinc-900">최근 변경 이력</h2>
        {changes.length === 0 ? (
          <p className="text-zinc-600">기록 없음</p>
        ) : (
          <ul className="space-y-1 text-[12px]">
            {changes.map((c) => (
              <li key={c.id} className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-zinc-600 tabular-nums">{c.at.slice(0, 16).replace("T", " ")}</span>
                <span className="font-medium">{{ create: "등록", update: "수정", archive: "보관", restore: "되살림", delete: "삭제" }[c.action] ?? c.action}</span>
                <span className="text-zinc-600">{{ run: "구간", work: "작품", slot: "자리", outlet: "방송사", event: "행사" }[c.entity] ?? c.entity}</span>
                <span className="min-w-0 truncate text-zinc-700">
                  {String((c.diff.title?.after ?? c.diff.name?.after ?? c.diff.label?.after ?? "") || "")}
                  {c.action === "update" &&
                    Object.entries(c.diff)
                      .filter(([k]) => !["source_id", "source_cell", "source_text", "updated_by"].includes(k))
                      .slice(0, 3)
                      .map(([k, v]) => ` ${k}: ${fmt(v.before)} → ${fmt(v.after)}`)
                      .join(" ·")}
                </span>
                <span className="text-zinc-500">{c.actor}</span>
                {c.entity === "run" && c.action === "archive" && (
                  <button type="button" onClick={() => restore(c.entityId)} className="rounded border border-zinc-300 px-1.5 hover:bg-zinc-50">
                    되살리기
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
