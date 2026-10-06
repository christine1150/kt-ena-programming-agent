"use client";

// Avail(콘텐츠·채널 권리) 관리 카드(단계 06).
// 흐름: 파일 선택 → 열 매핑 미리보기(헤더가 맞지 않으면 거부) → 기존 권리와의 차이 확인 → 확정 반영.
// 확인 대기(계약 해석·메모·승인·중복)와 보충 속성(1st window)도 여기서 처리한다. 확정하기 전에는 아무것도 저장하지 않는다.
import { useCallback, useEffect, useRef, useState } from "react";
import { FileInputTrigger } from "./FileInputTrigger";

interface Validation {
  area: string;
  state: "verified" | "partial" | "unverified";
  text: string;
}
interface Overview {
  ok: boolean;
  message?: string;
  tablesApplied: boolean;
  rightsConfigured: boolean;
  counts: { grants: number; active: number; proposedRevoke: number; contentAvail: number; channelAvail: number; manual: number };
  inventoryVersion: string;
  interpretation: { key: string; label: string; note: string; value: string | boolean; plausible: (string | boolean)[]; confirmed: boolean; confirmedBy: string | null }[];
  pending: { code: string; label: string; count: number }[];
  pendingTexts: { topic: "memo" | "holdback"; text: string; count: number }[];
  duplicates: { a: string; b: string; titleA: string; titleB: string; reasons: string[] }[];
  addenda: { stored: number; seedAvailable: number; seedStored: number; unmatched: string[]; conflicts: { addendumId: string; displayTitle: string; field: string; fileValue: string; statedValue: string; message: string }[]; productionYearMissing: string[] };
  validation: Validation[];
  ledger: { entries: number; activeUsages: number };
}
interface SheetOut {
  sheet: string;
  kind: string;
  importable: boolean;
  rowCount: number;
  message: string;
  headers: { header: string; role: string }[];
  missingRequired: string[];
  grantCount: number;
  issueCount: number;
  issues: { sheet: string | null; row: number | null; column?: string | null; cause: string; example: string | null; severity: string }[];
}
interface Preview {
  ok: boolean;
  message?: string;
  applied?: boolean;
  tablesApplied?: boolean;
  sheets?: SheetOut[];
  refused?: number;
  plan?: { blocked: string | null; summary: { new: number; unchanged: number; revised: number; manualConflicts: number; proposedRevocations: number; duplicateInBatch: number }; revised: { grantId: string; title: string; changedColumns: string[] }[]; manualConflicts: { title: string }[]; proposedRevocations: { title: string }[] };
  duplicates?: { a: string; b: string; titleA: string; titleB: string; reasons: string[] }[];
}

const KIND_LABEL: Record<string, string> = {
  content_avail: "콘텐츠별 Avail(실제 파일 형식)",
  standard: "표준 양식",
  view_of_content_avail: "다른 시트의 보기(가져오지 않음)",
  unverified_view: "소재코드 없음(가져오지 않음)",
  duplicate_sheet: "중복 시트(가져오지 않음)",
  unrecognized: "알 수 없는 양식(거부)",
  empty: "빈 시트",
};
const FIELD_LABEL: Record<string, string> = { start_date: "시작일", end_date: "종료일", episode_count: "편수", runtime: "회차당 분", first_channel: "1st window 채널", count_limit: "방수", term: "기간" };
const STATE_STYLE = { verified: "bg-emerald-50 text-emerald-700", partial: "bg-amber-50 text-amber-800", unverified: "bg-zinc-100 text-zinc-800" } as const;
const STATE_TEXT = { verified: "검증됨", partial: "일부 검증", unverified: "미검증" } as const;

export default function AvailManager() {
  const [ov, setOv] = useState<Overview | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [batchKind, setBatchKind] = useState<"incremental" | "full_snapshot">("incremental");
  const [scope, setScope] = useState({ channels: "", sourceKind: "", from: "", to: "" });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [linkQuery, setLinkQuery] = useState("");
  const [baseline, setBaseline] = useState({ prefix: "", evidence: "" });
  const [links, setLinks] = useState<{ canonicalKey: string; title: string; candidates: { programId: string; programName: string; basis: string; confidence: number; markerConflicts: string[] }[] }[] | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/avail");
    const body = (await res.json().catch(() => null)) as Overview | null;
    if (body?.ok) setOv(body);
  }, []);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/admin/avail");
      const body = (await res.json().catch(() => null)) as Overview | null;
      if (!cancelled && body?.ok) setOv(body);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function send(mode: "preview" | "apply", f: File | null = file) {
    if (!f) return;
    setBusy(true);
    setNotice(null);
    const fd = new FormData();
    fd.append("file", f);
    fd.append("mode", mode);
    fd.append("batchKind", batchKind);
    if (batchKind === "full_snapshot") {
      fd.append("scopeChannels", scope.channels);
      fd.append("scopeSourceKind", scope.sourceKind);
      fd.append("scopeFrom", scope.from);
      fd.append("scopeTo", scope.to);
    }
    const res = await fetch("/api/admin/upload/avail", { method: "POST", body: fd });
    const body = (await res.json().catch(() => ({ ok: false, message: "응답을 읽지 못했습니다." }))) as Preview;
    setPreview(body);
    if (mode === "apply") {
      setNotice(body.message ?? (body.ok ? "반영했습니다." : "반영하지 못했습니다."));
      if (body.ok) void load();
    }
    setBusy(false);
  }

  async function act(payload: Record<string, unknown>, okText: string | ((b: Record<string, unknown>) => string)) {
    setBusy(true);
    const res = await fetch("/api/admin/avail", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const body = (await res.json().catch(() => ({ ok: false, message: "응답을 읽지 못했습니다." }))) as { ok: boolean; message?: string } & Record<string, unknown>;
    setNotice(body.ok ? (typeof okText === "function" ? okText(body) : okText) : body.message ?? "처리하지 못했습니다.");
    setBusy(false);
    if (body.ok) void load();
  }

  async function searchLinks() {
    setBusy(true);
    const res = await fetch(`/api/admin/avail?link=${encodeURIComponent(linkQuery)}`);
    const body = (await res.json().catch(() => null)) as { ok: boolean; message?: string; items?: NonNullable<typeof links> } | null;
    setLinks(body?.ok ? body.items ?? [] : []);
    if (!body?.ok) setNotice(body?.message ?? "검색하지 못했습니다.");
    setBusy(false);
  }

  const canApply = !!preview?.ok && !!preview.plan && !preview.plan.blocked && (preview.sheets ?? []).some((s) => s.importable) && !preview.applied;

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-zinc-100">
      <h2 className="mb-1 text-lg font-semibold text-zinc-900">Avail(콘텐츠·채널 권리) 관리</h2>
      <p className="mb-4 text-sm text-zinc-500">
        콘텐츠별·채널별 Avail를 같은 권리 모델로 받습니다. 권리는 &ldquo;가능 / 불가 / 조건부 / 미확인&rdquo; 네 가지로 판정하고 사유와 원본 행을 함께 보여 줍니다.
        Avail가 없어도 성과 분석과 편성 탐색은 그대로 동작하며, 실행 가능 여부만 &lsquo;보류&rsquo;로 표시됩니다.
      </p>

      {ov && !ov.tablesApplied && (
        <div className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">⚠️ Avail 테이블이 아직 적용되지 않았습니다(마이그레이션 20261013010000). 미리보기와 열 매핑 확인은 할 수 있지만 반영·확인 기록은 적용 후에 가능합니다.</div>
      )}

      {/* 검증 상태 */}
      <div className="mb-4 space-y-1">
        {(ov?.validation ?? []).map((v) => (
          <div key={v.area} className={`rounded-lg px-3 py-2 text-xs ${STATE_STYLE[v.state]}`}>
            <span className="font-semibold">
              {v.area} · {STATE_TEXT[v.state]}
            </span>
            <span className="ml-2">{v.text}</span>
          </div>
        ))}
      </div>

      {ov && (
        <p className="mb-4 text-sm text-zinc-700">
          현재 권리 <b>{ov.counts.grants.toLocaleString()}</b>건(콘텐츠별 {ov.counts.contentAvail.toLocaleString()} · 채널별 {ov.counts.channelAvail.toLocaleString()}
          {ov.counts.proposedRevoke ? ` · 철회 후보 ${ov.counts.proposedRevoke}` : ""}) · 권리 목록 버전 <code>{ov.inventoryVersion}</code>
          {!ov.rightsConfigured && " · 아직 입력된 Avail가 없습니다"}
        </p>
      )}

      {/* 표준 양식 */}
      <details className="mb-4 rounded-lg border border-zinc-200 p-3 text-sm">
        <summary className="cursor-pointer font-medium text-zinc-800">표준 양식 내려받기와 열 설명</summary>
        <p className="mt-2 text-zinc-600">
          열 이름은 아래와 정확히 같아야 합니다(없는 필수 열이 있으면 파일 전체를 거부하고 모르는 열은 &lsquo;해석 안 함&rsquo;으로 표시합니다). 빈칸은 &lsquo;무제한&rsquo;이 아니라 &lsquo;미확인&rsquo;이며, 무제한은 <code>제한없음</code>·<code>무기한</code>이라고 적습니다. 비용은 선택이며 비우면 가격 미확인입니다.
        </p>
        <a href="/api/admin/avail/template" className="mt-2 inline-block rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50">
          표준 양식(CSV) 받기
        </a>
        <p className="mt-2 text-xs text-zinc-500">필수 열: 제목 · 회차 · 채널 · 시작일 · 종료일. 선택 열(제작년도·구분·1st window 채널·승인필요·기소진·방수 등)은 표준 양식 파일의 머리글을 참고하세요.</p>
      </details>

      {/* 업로드 */}
      <div className="mb-3 space-y-3">
        <FileInputTrigger
          inputRef={inputRef}
          accept=".xlsx,.xls,.csv"
          onFiles={(files) => {
            const f = files[0] ?? null;
            setFile(f);
            setPreview(null);
            if (f) void send("preview", f);
          }}
        />
        <div className="flex flex-wrap items-center gap-4 text-sm text-zinc-700">
          <label className="flex items-center gap-1">
            <input type="radio" checked={batchKind === "incremental"} onChange={() => setBatchKind("incremental")} /> 부분 증분(파일에 없는 권리는 그대로 둠)
          </label>
          <label className="flex items-center gap-1">
            <input type="radio" checked={batchKind === "full_snapshot"} onChange={() => setBatchKind("full_snapshot")} /> 전체 스냅샷(범위 안에서 빠진 권리는 철회 후보로 표시)
          </label>
        </div>
        {batchKind === "full_snapshot" && (
          <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
            <input className="rounded border border-zinc-300 px-2 py-1" placeholder="대상 채널(쉼표)" value={scope.channels} onChange={(e) => setScope({ ...scope, channels: e.target.value })} />
            <select className="rounded border border-zinc-300 px-2 py-1" value={scope.sourceKind} onChange={(e) => setScope({ ...scope, sourceKind: e.target.value })}>
              <option value="">자료 종류 전체</option>
              <option value="content_avail">콘텐츠별</option>
              <option value="channel_avail">채널별</option>
            </select>
            <input className="rounded border border-zinc-300 px-2 py-1" placeholder="기간 시작 YYYY-MM-DD" value={scope.from} onChange={(e) => setScope({ ...scope, from: e.target.value })} />
            <input className="rounded border border-zinc-300 px-2 py-1" placeholder="기간 끝 YYYY-MM-DD" value={scope.to} onChange={(e) => setScope({ ...scope, to: e.target.value })} />
          </div>
        )}
        <div className="flex gap-2">
          <button disabled={!file || busy} onClick={() => void send("preview")} className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50">
            미리보기 다시 보기
          </button>
          <button disabled={!canApply || busy} onClick={() => void send("apply")} className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-40">
            확정 반영
          </button>
        </div>
      </div>

      {notice && <p className="mb-3 rounded-lg bg-zinc-50 p-3 text-sm text-zinc-800">{notice}</p>}

      {preview && !preview.ok && !preview.sheets && <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{preview.message}</p>}
      {preview?.sheets && (
        <div className="mb-4 space-y-3">
          {preview.sheets.map((s) => (
            <div key={s.sheet} className={`rounded-lg border p-3 text-sm ${s.importable ? "border-emerald-200" : "border-zinc-200"}`}>
              <p className="font-medium text-zinc-900">
                시트 &ldquo;{s.sheet}&rdquo; · {KIND_LABEL[s.kind] ?? s.kind} · {s.rowCount.toLocaleString()}행{s.importable ? ` → 권리 ${s.grantCount.toLocaleString()}건` : ""}
              </p>
              <p className="text-zinc-600">{s.message}</p>
              {s.missingRequired.length > 0 && <p className="mt-1 text-red-700">없는 필수 열: {s.missingRequired.join(", ")}</p>}
              {s.headers.length > 0 && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs text-zinc-500">열 매핑 미리보기({s.headers.length}열)</summary>
                  <div className="mt-1 flex flex-wrap gap-1 text-xs">
                    {s.headers.map((h) => (
                      <span key={h.header} className={`rounded px-1.5 py-0.5 ${h.role === "필수" ? "bg-emerald-50 text-emerald-700" : h.role.startsWith("선택") ? "bg-zinc-100 text-zinc-800" : "bg-amber-50 text-amber-800"}`}>
                        {h.header} · {h.role}
                      </span>
                    ))}
                  </div>
                </details>
              )}
              {s.issueCount > 0 && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs text-amber-700">읽기 경고 {s.issueCount.toLocaleString()}건(해당 행은 &lsquo;미확인&rsquo;으로 둠)</summary>
                  <ul className="mt-1 max-h-48 space-y-0.5 overflow-auto text-xs text-zinc-700">
                    {s.issues.slice(0, 50).map((i, k) => (
                      <li key={k}>
                        {i.sheet ? `시트 ${i.sheet} · ` : ""}
                        {i.row !== null ? `${i.row}행 · ` : ""}
                        {i.column ? `${i.column} 열 — ` : ""}
                        {i.cause}
                        {i.example ? ` (예: ${i.example})` : ""}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          ))}
          {preview.plan && (
            <div className="rounded-lg bg-zinc-50 p-3 text-sm text-zinc-800">
              {preview.plan.blocked ? (
                <p className="text-red-700">{preview.plan.blocked}</p>
              ) : (
                <p>
                  반영 차이: 신규 <b>{preview.plan.summary.new}</b> · 개정 <b>{preview.plan.summary.revised}</b> · 변화 없음 {preview.plan.summary.unchanged}
                  {preview.plan.summary.proposedRevocations ? ` · 철회 후보 ${preview.plan.summary.proposedRevocations}` : ""}
                  {preview.plan.summary.manualConflicts ? ` · 수동 수정과 충돌 ${preview.plan.summary.manualConflicts}(반영 안 함)` : ""}
                  {preview.plan.summary.duplicateInBatch ? ` · 같은 파일 안 중복 ${preview.plan.summary.duplicateInBatch}(한 번만 반영)` : ""}
                </p>
              )}
              {preview.plan.revised.length > 0 && (
                <ul className="mt-1 text-xs text-zinc-600">
                  {preview.plan.revised.slice(0, 8).map((r) => (
                    <li key={r.grantId}>
                      개정: {r.title} — 바뀐 열 {r.changedColumns.join(", ") || "(되살림)"}
                    </li>
                  ))}
                </ul>
              )}
              {(preview.duplicates?.length ?? 0) > 0 && <p className="mt-1 text-xs text-amber-700">중복 권리 후보 {preview.duplicates!.length}쌍이 반영 후 &lsquo;확인 대기&rsquo;에 나타납니다(횟수를 합산하지 않음).</p>}
            </div>
          )}
        </div>
      )}

      {/* 확인 대기 */}
      {ov && ov.rightsConfigured && (
        <div className="space-y-4 border-t border-zinc-100 pt-4">
          <h3 className="text-sm font-semibold text-zinc-900">확인 대기</h3>
          {ov.pending.length > 0 && (
            <ul className="text-sm text-zinc-700">
              {ov.pending.map((p) => (
                <li key={p.code}>
                  {p.label}: <b>{p.count.toLocaleString()}</b>건 <span className="text-xs text-zinc-400">({p.code})</span>
                </li>
              ))}
            </ul>
          )}

          <div>
            <p className="mb-1 text-sm font-medium text-zinc-800">계약 해석 확인(권리 담당자 확인 후 눌러 주세요)</p>
            <p className="mb-2 text-xs text-zinc-500">확인 전에는 가능한 해석을 모두 적용해 보고, 결과가 갈리면 &lsquo;조건부&rsquo;로 표시합니다.</p>
            {ov.interpretation.map((i) => (
              <div key={i.key} className="mb-2 rounded-lg border border-zinc-200 p-2 text-sm">
                <p className="font-medium text-zinc-800">
                  {i.label} {i.confirmed ? <span className="text-emerald-700">· 확인됨({String(i.value)}, {i.confirmedBy})</span> : <span className="text-amber-700">· 확인 전</span>}
                </p>
                <p className="text-xs text-zinc-500">{i.note}</p>
                <div className="mt-1 flex flex-wrap gap-2">
                  {i.plausible.map((v) => (
                    <button key={String(v)} disabled={busy} onClick={() => void act({ action: "confirm_interpretation", key: i.key, value: v }, `${i.label}: ${String(v)}로 확인했습니다.`)} className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50 disabled:opacity-50">
                      {String(v)}(으)로 확인
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {ov.pendingTexts.length > 0 && (
            <div>
              <p className="mb-1 text-sm font-medium text-zinc-800">메모·홀드백 문구별 확인(같은 문구는 묶어서)</p>
              <p className="mb-2 text-xs text-zinc-500">권리 담당자가 그 문구의 뜻을 확인한 경우에만 누르세요. 확인하면 그 문구가 달린 권리의 조건이 풀립니다(원본 행이 바뀌면 다시 확인 대기가 됩니다).</p>
              {ov.pendingTexts.slice(0, 15).map((t) => (
                <div key={t.topic + t.text} className="mb-1 flex items-center justify-between gap-2 rounded border border-zinc-200 px-2 py-1 text-sm">
                  <span>
                    <span className="text-xs text-zinc-500">{t.topic === "memo" ? "메모" : "홀드백"}</span> {t.text} · <b>{t.count}</b>건
                  </span>
                  <button disabled={busy} onClick={() => void act({ action: "confirm_group", topic: t.topic, text: t.text }, `${t.count}건을 확인했습니다.`)} className="shrink-0 rounded border border-zinc-300 px-2 py-0.5 text-xs hover:bg-zinc-50">
                    이 문구 확인
                  </button>
                </div>
              ))}
            </div>
          )}

          <div>
            <p className="mb-1 text-sm font-medium text-zinc-800">기소진(이미 방영한 횟수) 일괄 확인 — 새로 구매해 아직 방영 전인 묶음</p>
            <p className="mb-1 text-xs text-zinc-500">소재코드 앞부분(예: D260812)으로 묶어 &lsquo;지금까지 방영 없음&rsquo;을 확인합니다. 증빙 내용이 필요합니다. 이미 방영한 적이 있는 작품에는 사용하지 마세요.</p>
            <div className="flex flex-wrap gap-2">
              <input className="w-32 rounded border border-zinc-300 px-2 py-1 text-sm" placeholder="소재코드 접두" value={baseline.prefix} onChange={(e) => setBaseline({ ...baseline, prefix: e.target.value })} />
              <input className="min-w-48 flex-1 rounded border border-zinc-300 px-2 py-1 text-sm" placeholder="증빙(예: 2026-10 신규 구매, 방영 이력 없음 — 확인자)" value={baseline.evidence} onChange={(e) => setBaseline({ ...baseline, evidence: e.target.value })} />
              <button disabled={busy || baseline.prefix.trim().length < 4 || !baseline.evidence.trim()} onClick={() => void act({ action: "confirm_baseline_group", codePrefix: baseline.prefix, evidence: baseline.evidence }, (b) => `${String(b.confirmed ?? 0)}건의 기소진을 0으로 확인했습니다.`)} className="rounded-lg border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50 disabled:opacity-50">
                일괄 확인
              </button>
            </div>
          </div>

          {ov.duplicates.length > 0 && (
            <div>
              <p className="mb-1 text-sm font-medium text-zinc-800">중복 권리 후보 {ov.duplicates.length}쌍</p>
              {ov.duplicates.slice(0, 12).map((d) => (
                <div key={d.a + d.b} className="mb-2 rounded-lg border border-zinc-200 p-2 text-sm">
                  <p>
                    {d.titleA} <span className="text-xs text-zinc-400">({d.a})</span> ↔ {d.titleB} <span className="text-xs text-zinc-400">({d.b})</span>
                  </p>
                  <p className="text-xs text-zinc-500">{d.reasons.join(" · ")}</p>
                  <div className="mt-1 flex gap-2">
                    <button disabled={busy} onClick={() => void act({ action: "confirm_duplicate", grantId: d.b, value: `same:${d.a}` }, "같은 권리로 통합했습니다.")} className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50">
                      같은 권리(뒤쪽을 앞쪽에 통합)
                    </button>
                    <button disabled={busy} onClick={() => void act({ action: "confirm_duplicate", grantId: d.b, value: "distinct" }, "별개 권리로 확인했습니다.")} className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50">
                      별개 권리
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div>
            <p className="mb-1 text-sm font-medium text-zinc-800">보충 속성 — 영미 드라마 1st window 신규 구매 23건</p>
            <p className="text-xs text-zinc-500">1st window 채널이 최초 방송한 뒤에 다른 채널이 방영할 수 있다는 순서 규칙, 영문 제품명 별칭, 제작년도를 원본 Avail 행에 덧붙입니다. 원본 값은 덮어쓰지 않고 다르면 아래에 충돌로 표시합니다.</p>
            <p className="mt-1 text-sm text-zinc-700">
              적용됨 {ov.addenda.seedStored}/{ov.addenda.seedAvailable}
              {ov.addenda.unmatched.length > 0 && ` · 대상 권리를 못 찾은 항목 ${ov.addenda.unmatched.length}`}
            </p>
            <button disabled={busy || ov.addenda.seedStored === ov.addenda.seedAvailable} onClick={() => void act({ action: "seed_addenda", name: "us_drama_1st_window" }, (b) => `보충 속성을 적용했습니다. 전달 내용(신규 구매·전 채널 방영 가능)을 확인 기록 ${String(b.confirmationsAdded ?? 0)}건으로 남겼고, 원본과 충돌한 ${Array.isArray(b.skippedForConflict) ? b.skippedForConflict.length : 0}건은 확인하지 않았습니다.`)} className="mt-1 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50">
              23건 보충 속성 적용
            </button>
            {ov.addenda.conflicts.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-xs text-amber-800">
                {ov.addenda.conflicts.map((c, k) => (
                  <li key={k}>
                    ⚠ {c.displayTitle} · {FIELD_LABEL[c.field] ?? c.field}: 원본 {c.fileValue} / 전달 목록 {c.statedValue} — {c.message}
                  </li>
                ))}
              </ul>
            )}
            {ov.addenda.productionYearMissing.length > 0 && <p className="mt-2 text-xs text-zinc-600">제작년도 미입력 {ov.addenda.productionYearMissing.length}건(제작년도는 같은 제목의 리메이크·다른 판을 가르는 데 중요합니다): {ov.addenda.productionYearMissing.slice(0, 6).join(", ")} 외</p>}
          </div>

          <div>
            <p className="mb-1 text-sm font-medium text-zinc-800">콘텐츠 연결 확인(시스템 프로그램 ↔ Avail 제목)</p>
            <p className="mb-1 text-xs text-zinc-500">이름이 정확히 같고 시즌·편집판 표지가 같을 때만 자동 연결합니다. 별칭·시즌 다름·부분 일치는 후보로만 보여 드리며, 확인하기 전에는 권리가 &lsquo;미확인&rsquo;입니다.</p>
            <div className="flex gap-2">
              <input className="flex-1 rounded border border-zinc-300 px-2 py-1 text-sm" placeholder="Avail 제목 일부(예: 이래셔널)" value={linkQuery} onChange={(e) => setLinkQuery(e.target.value)} />
              <button disabled={busy || linkQuery.trim().length < 2} onClick={() => void searchLinks()} className="rounded-lg border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50 disabled:opacity-50">
                후보 찾기
              </button>
            </div>
            {links?.map((it) => (
              <div key={it.canonicalKey} className="mt-2 rounded-lg border border-zinc-200 p-2 text-sm">
                <p className="font-medium">{it.title}</p>
                {it.candidates.length === 0 && <p className="text-xs text-zinc-500">시스템에서 비슷한 프로그램을 찾지 못했습니다.</p>}
                {it.candidates.map((c) => (
                  <div key={c.programId} className="mt-1 flex items-center justify-between gap-2 text-xs">
                    <span>
                      {c.programName} · {c.basis === "exact" ? "이름 일치" : c.basis === "alias" ? "별칭 일치" : c.basis === "season_differs" ? "시즌만 다름" : "부분 일치"} {Math.round(c.confidence * 100)}%{c.markerConflicts.length ? ` · ⚠ ${c.markerConflicts.join("; ")}` : ""}
                    </span>
                    <button disabled={busy} onClick={() => void act({ action: "link_content", programId: c.programId, canonicalKey: it.canonicalKey }, "연결을 확인했습니다.")} className="shrink-0 rounded border border-zinc-300 px-2 py-0.5 hover:bg-zinc-50">
                      같은 콘텐츠로 확인
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
