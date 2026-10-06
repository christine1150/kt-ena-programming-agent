"use client";

// 액션 문맥 띠(단계 07) — 홈 결정 카드에서 "근거 보기 → 해당 슬롯 → 대안 비교 → 검토안 저장"으로 이동하는 동안
// 어느 액션을 검토 중인지(`from`)와 그 제목(`ft`)·슬롯(`hour`·`date`)을 모든 화면 위에 유지한다.
// 여기서 검토 상태(검토 중/보류/채택/기각)와 이유를 기록하면 다음 브리핑의 후속 액션에 반영된다.
// 편성안 화면에서 검토안을 저장하면 URL의 `run`이 연결된 편성안으로 함께 기록된다.
import Link from "next/link";
import { useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { REASON_REQUIRED, REVIEW_STATUS_LABEL, type ReviewStatus } from "@/lib/workspace/actionReview";
import { ACTION_QUERY_KEYS, hrefFor, isIsoDate, parseFocusHour, parseViewContext } from "@/lib/workspace/viewContext";

const STATUSES: ReviewStatus[] = ["reviewing", "hold", "adopted", "dismissed"];

// 액션(from)이 바뀌면 입력·결과 상태를 처음부터 다시 시작하도록 key로 분리한다.
export default function ActionRibbon() {
  const sp = useSearchParams();
  return <RibbonBody key={sp.get("from") ?? "none"} />;
}

function RibbonBody() {
  const sp = useSearchParams();
  const pathname = usePathname() ?? "/";
  const actionId = sp.get("from");
  const title = sp.get("ft");
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<ReviewStatus>("reviewing");
  const [reason, setReason] = useState("");
  const [reviewBy, setReviewBy] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  if (!actionId || !title) return null;
  const channelMatch = pathname.match(/^\/(?:channel|audience-report)\/([^/?#]+)/);
  const { ctx } = parseViewContext((k) => sp.get(k), { channelFromPath: channelMatch && channelMatch[1] !== "portfolio" ? channelMatch[1] : null });
  const runId = sp.get("run");
  const needsReason = REASON_REQUIRED.includes(status);
  const homeHref = hrefFor("home", { ...ctx, view: "daily", date: sp.get("date") ?? ctx.date });
  // 띠 닫기: 현재 화면에서 액션 문맥 쿼리만 지운다(기간·run 등 나머지는 유지). 날짜(date)는 기간 문맥이기도 해서 홈·보고서에서는 남긴다.
  const closeQs = new URLSearchParams(sp.toString());
  for (const k of ACTION_QUERY_KEYS) if (k !== "date") closeQs.delete(k);
  const closeHref = closeQs.toString() ? `${pathname}?${closeQs.toString()}` : pathname;

  async function save() {
    if (needsReason && !reason.trim()) {
      setResult({ ok: false, text: `'${REVIEW_STATUS_LABEL[status]}'에는 이유를 적어 주세요.` });
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/actions/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionId,
          title,
          status,
          reason: reason.trim() || null,
          reviewBy: reviewBy || null,
          // 편성안 연결은 '채택'일 때만 한다. 편성안 화면이 자동으로 고른 run은 이 액션을 위해 만든 안이 아닐 수 있고,
          // 저장(검토안 저장)하지 않은 run은 서버가 연결을 거부하므로, 보류·기각·검토 중 기록이 막히지 않게 분리한다.
          linkedRunId: status === "adopted" && runId && /^[0-9a-f-]{36}$/i.test(runId) ? runId : null,
          channelCode: ctx.channel,
          context: { subject: sp.get("sj"), channel: ctx.channel, date: isIsoDate(sp.get("date")) ? sp.get("date") : null, view: ctx.view },
        }),
      });
      const body = await res.json().catch(() => ({ ok: false, message: "응답을 읽지 못했습니다." }));
      setResult(res.ok && body.ok ? { ok: true, text: `'${REVIEW_STATUS_LABEL[status]}'로 기록했습니다${status === "adopted" && runId ? "(저장한 편성안과 연결)" : ""}.` } : { ok: false, text: body.message ?? "기록하지 못했습니다." });
    } catch {
      setResult({ ok: false, text: "네트워크 오류로 기록하지 못했습니다." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div role="region" aria-label="검토 중인 액션" className="sticky top-0 z-30 border-b border-indigo-100 bg-indigo-50 print:hidden" data-action-ribbon>
      <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[13px] text-indigo-900 sm:px-6">
        <span className="font-semibold">검토 중인 액션</span>
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {parseFocusHour(sp.get("hour")) !== null && <span className="text-indigo-700">슬롯 {parseFocusHour(sp.get("hour"))}시</span>}
        {runId && <span className="text-indigo-700">보고 있는 편성안 {runId.slice(0, 8)} (채택 기록 시 저장한 안이면 연결)</span>}
        <Link href={homeHref} className="rounded-full bg-white px-3 py-1 text-[12px] font-medium text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-100">
          결정 카드로 돌아가기
        </Link>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="rounded-full bg-indigo-700 px-3 py-1 text-[12px] font-medium text-white hover:bg-indigo-800">
          검토 상태 기록
        </button>
        <Link href={closeHref} aria-label="검토 띠 닫기" title="검토 띠 닫기(기록은 하지 않음)" className="rounded-full px-2 py-1 text-[13px] text-indigo-600 hover:bg-indigo-100">
          ✕
        </Link>
      </div>
      {open && (
        <div className="mx-auto max-w-screen-2xl px-3 pb-3 sm:px-6">
          <div className="flex flex-wrap items-end gap-3 rounded-lg bg-white p-3 ring-1 ring-indigo-100">
            <label className="text-[12px] text-zinc-500">
              상태
              <select value={status} onChange={(e) => setStatus(e.target.value as ReviewStatus)} className="mt-1 block rounded-md border border-zinc-200 px-2 py-1.5 text-[13px] text-zinc-800">
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {REVIEW_STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="min-w-[14rem] flex-1 text-[12px] text-zinc-500">
              이유{needsReason ? " (필수)" : " (선택)"}
              <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder={status === "hold" ? "예: 다음 2회 방영을 보고 판단" : status === "adopted" ? "예: 수요일 22시로 이동안 채택" : "이유를 적어 주세요"} className="mt-1 block w-full rounded-md border border-zinc-200 px-2 py-1.5 text-[13px] text-zinc-800" />
            </label>
            {(status === "hold" || status === "adopted") && (
              <label className="text-[12px] text-zinc-500">
                {status === "hold" ? "재검토일" : "성과 확인일"}
                <input type="date" value={reviewBy} onChange={(e) => setReviewBy(e.target.value)} className="mt-1 block rounded-md border border-zinc-200 px-2 py-1.5 text-[13px] text-zinc-800" />
              </label>
            )}
            <button type="button" onClick={save} disabled={busy || result?.ok === true} className="rounded-md bg-zinc-900 px-4 py-1.5 text-[13px] font-medium text-white disabled:opacity-50">
              {busy ? "기록 중…" : result?.ok ? "기록됨" : "기록"}
            </button>
          </div>
          {result && (
            <p role="status" className={`mt-2 text-[12.5px] ${result.ok ? "text-emerald-700" : "text-red-700"}`}>
              {result.text}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
