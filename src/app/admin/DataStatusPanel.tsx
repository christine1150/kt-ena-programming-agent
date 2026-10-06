"use client";

// 관리자 첫 화면 — 자료 수신·반영 현황(단계 05). 채널 × 자료 종류별로 "수집됨"과 "분석 반영 완료"를 분리해 보여 준다.
import { useEffect, useState } from "react";
import { KIND_LABEL, type Health, type ReceiptRow, type ReceiptSummary } from "@/lib/admin/ingestStatus";

interface StatusResponse {
  ok: boolean;
  message?: string;
  today: string;
  window: { from: string; to: string };
  rows: ReceiptRow[];
  summary: ReceiptSummary;
  ledgerAvailable: boolean;
  mail: { lastSuccessAt: string | null; lastErrorAt: string | null; recentErrorCount: number };
  recentFailedUploads: { fileName: string; fileType: string; message: string | null; at: string }[];
  rightsImpact: { status: string; message: string };
  unmatched: { status: string; message: string };
  notes: string[];
}

const HEALTH_LABEL: Record<Health, { text: string; cls: string }> = {
  ok: { text: "정상", cls: "bg-emerald-50 text-emerald-700" },
  delayed: { text: "지연", cls: "bg-amber-50 text-amber-700" },
  missing: { text: "미수신", cls: "bg-rose-50 text-rose-700" },
  failed: { text: "실패", cls: "bg-rose-100 text-rose-800" },
  unknown: { text: "확인 불가", cls: "bg-zinc-100 text-zinc-600" },
};

const short = (d: string | null) => (d ? d.slice(5) : "—");
const list = (ds: string[]) => (ds.length === 0 ? "—" : ds.length <= 3 ? ds.map(short).join(", ") : `${ds.slice(0, 3).map(short).join(", ")} 외 ${ds.length - 3}일`);
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "없음");

export default function DataStatusPanel() {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch("/api/admin/data-status")
      .then((r) => r.json())
      .then((j: StatusResponse) => {
        if (!alive) return;
        if (!j.ok) setError(j.message ?? "현황을 불러오지 못했습니다.");
        else setData(j);
      })
      .catch(() => alive && setError("현황을 불러오지 못했습니다."))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-zinc-100">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900">자료 수신·반영 현황</h2>
          <p className="text-sm text-zinc-500">
            <b>수집됨</b>은 파일이 들어온 것이고, <b>분석 반영 완료</b>는 시청률이 반영되고 화면용 사전 계산(마트)까지 끝난 것입니다. 둘은 다를 수 있습니다.
          </p>
        </div>
        {data && <p className="text-xs text-zinc-400">기준일 {data.today} · 최근 {data.window.from} ~ 어제</p>}
      </div>

      {loading && <p className="text-sm text-zinc-500">불러오는 중…</p>}
      {error && <p className="text-sm text-rose-600">{error}</p>}

      {data && (
        <>
          <div className="mb-3 flex flex-wrap gap-2 text-xs">
            <span className="rounded-md bg-zinc-100 px-2 py-1">미수신 일수 <b>{data.summary.missingDays}</b></span>
            <span className="rounded-md bg-zinc-100 px-2 py-1">실패 <b>{data.summary.failedDays}</b></span>
            <span className="rounded-md bg-zinc-100 px-2 py-1">수집됨·미반영 <b>{data.summary.collectedNotApplied}</b></span>
            <span className="rounded-md bg-zinc-100 px-2 py-1">재계산 대기 <b>{data.summary.recomputePending}</b></span>
            <span className="rounded-md bg-zinc-100 px-2 py-1">정상 {data.summary.ok} / 전체 {data.summary.total}</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-xs">
              <thead>
                <tr className="text-left text-zinc-500">
                  <th className="py-1">채널</th>
                  <th className="py-1">자료</th>
                  <th className="py-1">최신 수집일</th>
                  <th className="py-1">최신 분석 반영일</th>
                  <th className="py-1">미수신</th>
                  <th className="py-1">실패</th>
                  <th className="py-1">수집됨·미반영</th>
                  <th className="py-1">재계산 대기</th>
                  <th className="py-1">상태</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={`${r.channel}|${r.kind}`} className="border-t border-zinc-100 align-top">
                    <td className="py-1 font-medium">{r.channel}</td>
                    <td className="py-1">{KIND_LABEL[r.kind]}</td>
                    <td className="py-1 tabular-nums">{short(r.latestCollectedDate)}</td>
                    <td className="py-1 tabular-nums">{short(r.latestAnalysisReadyDate ?? r.latestAppliedDate)}{r.latestAppliedDate && !r.latestAnalysisReadyDate && r.kind === "nielsen_daily" ? " (반영만)" : ""}</td>
                    <td className="py-1 tabular-nums">{list(r.missingDates)}</td>
                    <td className="py-1 tabular-nums">{list(r.failedDates)}</td>
                    <td className="py-1 tabular-nums">{list(r.collectedNotApplied)}</td>
                    <td className="py-1 tabular-nums">{list(r.recomputePending)}</td>
                    <td className="py-1"><span className={`rounded px-1.5 py-0.5 ${HEALTH_LABEL[r.health].cls}`}>{HEALTH_LABEL[r.health].text}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="mt-3 space-y-1 text-xs text-zinc-600">
            <li>메일 수집: 마지막 성공 {when(data.mail.lastSuccessAt)} · 마지막 오류 {when(data.mail.lastErrorAt)} · 최근 오류 {data.mail.recentErrorCount}건</li>
            <li>미매칭: {data.unmatched.message}</li>
            <li>권리 갱신 영향: {data.rightsImpact.message}</li>
            {data.recentFailedUploads.length > 0 && <li>최근 실패한 업로드: {data.recentFailedUploads.map((u) => `${u.fileName}(${u.fileType})`).join(", ")}</li>}
            {data.notes.map((n) => (
              <li key={n} className="text-amber-700">※ {n}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
