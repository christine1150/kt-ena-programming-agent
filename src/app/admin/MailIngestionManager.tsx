"use client";

// 개발 단위 20번(Nielsen 메일 자동 수집) 상태 확인 + 수동 실행 위젯.
// 실제 자동 수집은 Vercel Cron(매일 08:00 KST)이 /api/cron/fetch-nielsen-mail을 호출하지만,
// 여기 "지금 확인" 버튼으로 같은 로직을 즉시 실행해서 연동 설정이 맞는지 바로 확인할 수 있다.
// (참고: "7시 50분쯤 늦게 오는 날도 즉시 반영"을 위한 더 잦은 확인 주기는 이 프로젝트의
// Vercel 요금제(Hobby, 하루 1회 크론만 지원)로는 불가해 보류 중 — 사용자 확인 대기.)
import { useEffect, useState } from "react";
import HelpTip from "./HelpTip";

// 2026-09-06: 일간(kind: "daily") 외에 주간·월간(기간, kind: "period") 파일, OLIFE
// 일일운행표/주간 편성표(kind: "olife_epg")도 메일 자동 수집이 함께 적재하게 되어
// (nielsenFileDispatch.ts/olifeEpgDispatch.ts 공유), 세 종류를 모두 표시한다.
interface FileSummary {
  fileName: string;
  ok: boolean;
  message?: string;
  kind?: "daily" | "period" | "olife_epg";
  reportDate?: string;
  ratingsInserted?: number;
  periodType?: string;
  dateFrom?: string;
  dateTo?: string;
  inserted?: number;
  datesProcessed?: string[];
  matchedCount?: number;
  unmatchedCount?: number;
}
interface ProcessedItem {
  messageId: string;
  subject: string;
  files: FileSummary[];
}
interface RunResult {
  ok: boolean;
  message?: string;
  checkedCount: number;
  processed: ProcessedItem[];
}
interface LogRow {
  message_id: string;
  subject: string | null;
  received_at: string | null;
  processed_at: string;
  // "processing"은 선점(claim) 직후~적재 완료 사이의 순간적인 중간 상태라 화면에서
  // 볼 일은 거의 없지만(2026-09-06 동시성 수정), 실행이 중간에 죽으면 그 상태로 남을
  // 수 있어 표시는 해준다.
  status: "processing" | "processed" | "error" | "skipped";
  file_names: string[] | null;
  error_message: string | null;
  source: "gmail" | "naver" | null;
}
interface StatusBody {
  gmailConfigured: boolean;
  naverConfigured: boolean;
  logs: LogRow[];
}

export default function MailIngestionManager() {
  const [gmailConfigured, setGmailConfigured] = useState<boolean | null>(null);
  const [naverConfigured, setNaverConfigured] = useState<boolean | null>(null);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<RunResult | null>(null);

  async function fetchStatus(): Promise<StatusBody | null> {
    const res = await fetch("/api/admin/mail-ingestion/status");
    const body = await res.json().catch(() => null);
    return body?.ok ? { gmailConfigured: body.gmailConfigured, naverConfigured: body.naverConfigured, logs: body.logs } : null;
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const status = await fetchStatus();
      if (cancelled || !status) return;
      setGmailConfigured(status.gmailConfigured);
      setNaverConfigured(status.naverConfigured);
      setLogs(status.logs);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleRunNow() {
    setRunning(true);
    setRunResult(null);
    const res = await fetch("/api/admin/mail-ingestion/run", { method: "POST" });
    const body = (await res.json().catch(() => ({ ok: false, message: "응답을 읽지 못했습니다.", checkedCount: 0, processed: [] }))) as RunResult;
    setRunResult(body);
    setRunning(false);
    const status = await fetchStatus();
    if (status) {
      setGmailConfigured(status.gmailConfigured);
      setNaverConfigured(status.naverConfigured);
      setLogs(status.logs);
    }
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-zinc-100">
      {/* 사용자 지시(2026-10-22): 긴 설명은 ⓘ 말풍선으로, 연동 상태와 "지금 메일 확인"은 한 줄에 둔다. */}
      <h2 className="mb-3 text-lg font-semibold text-zinc-900">
        Nielsen 메일 자동 수집
        <HelpTip>
          제목에 <b>닐슨</b>과 <b>보고서</b>가 모두 들어간 메일(대부분 [닐슨] KTENA 일일 보고서)의{" "}
          <code>닐슨_채널시청률(YYMMDD)</code>(일간) 또는 <code>닐슨_채널시청률(YYMMDD-YYMMDD)</code>(주간·월간·연간) 엑셀을 매일 08:00(KST)에 자동 확인해
          &ldquo;Nielsen 시청률 업로드&rdquo;와 같은 방식으로 반영합니다. 일간/기간 구분은 파일명이 아니라 시트 안의 분석기간으로 판정합니다.
          제목에 <b>EPG</b>가 들어간 메일의 <code>일일운행표_YYYYMMDD</code> 첨부는 OLIFE 일일 EPG로도 반영합니다.
        </HelpTip>
      </h2>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div
          className={`flex-1 rounded-lg px-3 py-2.5 text-sm font-medium ${naverConfigured ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}
        >
          {naverConfigured ? "✅ 네이버 메일 연동이 설정되어 있습니다." : "⚠️ 네이버 메일 연동이 아직 설정되지 않았습니다."}
          {/* Gmail은 선택 경로라 미설정 안내는 숨기고, 실제로 연결된 경우에만 덧붙인다. */}
          {gmailConfigured && <span className="ml-3">✅ Gmail 연동</span>}
        </div>
        <button
          onClick={handleRunNow}
          disabled={running}
          className="shrink-0 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
        >
          {running ? "확인 중..." : "지금 메일 확인"}
        </button>
      </div>
      {!naverConfigured && (
        <ol className="mb-4 list-decimal space-y-1 rounded-lg bg-amber-50 p-3 pl-7 text-xs text-amber-800">
          <li>네이버 메일 접속 → 환경설정 → POP3/IMAP 설정에서 &ldquo;IMAP 사용&rdquo;을 켭니다.</li>
          <li>
            2단계 인증을 쓰고 있다면 네이버 계정 → 보안설정 → 2단계 인증에서 이 서비스 전용 <b>앱 비밀번호</b>를 새로 발급합니다(안 쓴다면 지금 쓰는 네이버 비밀번호).
          </li>
          <li>
            <code>.env</code>에 <code>NAVER_MAIL_USER</code>(네이버 메일 주소)와 <code>NAVER_MAIL_PASSWORD</code>(위 비밀번호)를 직접 추가합니다 — 이 값은 채팅으로 알려주지 마시고 파일에 바로 넣어주세요.
          </li>
        </ol>
      )}

      {runResult && (
        <div className="mb-4 rounded-lg bg-zinc-50 p-3 text-sm">
          {runResult.ok ? (
            <>
              {runResult.message && <p className="mb-2 text-amber-700">{runResult.message}</p>}
              {runResult.checkedCount === 0 ? (
                <p className="text-zinc-600">새로 처리할 메일이 없습니다.</p>
              ) : (
                <div className="space-y-2">
                  {runResult.processed.map((p) => (
                    <div key={p.messageId}>
                      <p className="font-medium text-zinc-800">{p.subject}</p>
                      {p.files.map((f) => (
                        <p key={f.fileName} className="text-xs text-zinc-500">
                          {f.fileName} —{" "}
                          {f.ok
                            ? f.kind === "period"
                              ? `${f.periodType === "weekly" ? "주간" : f.periodType === "monthly" ? "월간" : "기간"}(${f.dateFrom}~${f.dateTo}) ${f.inserted}건 저장`
                              : f.kind === "olife_epg"
                                ? `OLIFE EPG ${(f.datesProcessed ?? []).join(", ")} — 매칭 ${f.matchedCount ?? 0}건${f.message ? ` (${f.message})` : ""}`
                                : `${f.ratingsInserted}건 저장`
                            : <span className="text-red-600" role="alert">{f.message}</span>}
                        </p>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="text-red-600" role="alert">{runResult.message}</p>
          )}
        </div>
      )}

      {logs.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium text-zinc-400">최근 처리 이력</p>
          {/* 최근 5건이 보이는 높이 — 나머지는 안에서 스크롤(사용자 요청 2026-10-22) */}
          <div className="max-h-[10.5rem] overflow-y-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="text-zinc-400">
                  <th className="pb-1 font-medium">처리 시각</th>
                  <th className="pb-1 font-medium">소스</th>
                  <th className="pb-1 font-medium">제목</th>
                  <th className="pb-1 font-medium">결과</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.message_id} className="border-t border-zinc-100">
                    <td className="whitespace-nowrap py-1 pr-3 text-zinc-600">{new Date(log.processed_at).toLocaleString("ko-KR")}</td>
                    <td className="whitespace-nowrap py-1 pr-3 text-zinc-500">{log.source === "naver" ? "네이버" : "Gmail"}</td>
                    <td className="whitespace-nowrap py-1 pr-3 text-zinc-800">{log.subject ?? "—"}</td>
                    <td className="py-1.5">
                      {log.status === "processed" && <span className="text-emerald-600">처리됨 ({log.file_names?.length ?? 0}개 파일)</span>}
                      {log.status === "skipped" && <span className="text-zinc-500">건너뜀 — {log.error_message}</span>}
                      {log.status === "error" && <span className="text-red-600">오류 — {log.error_message}</span>}
                      {log.status === "processing" && <span className="text-amber-600">처리 중… (오래 남아있다면 이전 실행이 중단됐을 수 있음)</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
