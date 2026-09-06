"use client";

// 개발 단위 20번(Nielsen 메일 자동 수집) 상태 확인 + 수동 실행 위젯.
// 실제 자동 수집은 Vercel Cron(매일 08:00 KST)이 /api/cron/fetch-nielsen-mail을 호출하지만,
// 여기 "지금 확인" 버튼으로 같은 로직을 즉시 실행해서 Gmail 연동 설정이 맞는지 바로 확인할 수 있다.
import { useEffect, useState } from "react";

interface FileSummary {
  fileName: string;
  ok: boolean;
  message?: string;
  reportDate?: string;
  ratingsInserted?: number;
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
  status: "processed" | "error" | "skipped";
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
      <h2 className="mb-1 text-lg font-semibold text-zinc-900">Nielsen 메일 자동 수집</h2>
      <p className="mb-4 text-sm text-zinc-500">
        제목에 <code>닐슨</code>과 <code>보고서</code>가 모두 들어간 메일(대부분{" "}
        <code>[닐슨] KTENA 일일 보고서</code>)에서 <code>닐슨_채널시청률(YYMMDD)</code> 형태의
        엑셀 첨부파일을 매일 08:00(KST)에 자동으로 확인해 위 &ldquo;Nielsen 시청률
        업로드&rdquo;와 같은 방식으로 반영합니다. 아래 두 경로 중 설정된 것만 동작하며, 둘 다
        설정하면 둘 다 확인합니다.
      </p>

      <div className="mb-4 space-y-2">
        <div
          className={`rounded-lg p-3 text-sm ${naverConfigured ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}
        >
          <p className="font-medium">
            {naverConfigured ? "✅ 네이버 메일 연동이 설정되어 있습니다." : "⚠️ 네이버 메일 연동이 아직 설정되지 않았습니다."}
          </p>
          {!naverConfigured && (
            <ol className="mt-1.5 list-decimal space-y-1 pl-4 text-xs">
              <li>네이버 메일 접속 → 환경설정 → POP3/IMAP 설정에서 &ldquo;IMAP 사용&rdquo;을 켭니다.</li>
              <li>
                2단계 인증을 쓰고 있다면 네이버 계정 → 보안설정 → 2단계 인증에서 이 서비스 전용{" "}
                <b>앱 비밀번호</b>를 새로 발급합니다(2단계 인증을 안 쓴다면 평소 로그인 비밀번호를
                그대로 씁니다).
              </li>
              <li>
                <code>.env</code>에 <code>NAVER_MAIL_USER</code>(네이버 메일 주소)와{" "}
                <code>NAVER_MAIL_PASSWORD</code>(위에서 만든 비밀번호)를 직접 추가합니다 — 이
                값은 채팅으로 알려주지 마시고 파일에 바로 넣어주세요.
              </li>
            </ol>
          )}
        </div>
        <div
          className={`rounded-lg p-3 text-sm ${gmailConfigured ? "bg-emerald-50 text-emerald-700" : "bg-zinc-50 text-zinc-700"}`}
        >
          <p className="font-medium">
            {gmailConfigured ? "✅ Gmail 연동이 설정되어 있습니다." : "Gmail 연동(선택, 미설정)"}
          </p>
          {!gmailConfigured && (
            <p className="mt-1 text-xs">
              그룹웨어 2FA 때문에 Bizbox 메일을 직접 자동화하기 어려운 경우, Gmail로 전달(forward)받아
              대신 쓰는 경로입니다 — 지금은 네이버 메일 직접 연동을 쓰므로 필수는 아닙니다.{" "}
              <code>.env</code>에 <code>GMAIL_USER_EMAIL</code>/<code>GMAIL_CLIENT_ID</code>/
              <code>GMAIL_CLIENT_SECRET</code>/<code>GMAIL_REFRESH_TOKEN</code>을 채우면 활성화됩니다.
            </p>
          )}
        </div>
      </div>

      <button
        onClick={handleRunNow}
        disabled={running}
        className="mb-4 shrink-0 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
      >
        {running ? "확인 중..." : "지금 메일 확인"}
      </button>

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
                          {f.fileName} — {f.ok ? `${f.ratingsInserted}건 저장` : <span className="text-red-600">{f.message}</span>}
                        </p>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="text-red-600">{runResult.message}</p>
          )}
        </div>
      )}

      {logs.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium text-zinc-400">최근 처리 이력</p>
          <div className="max-h-60 overflow-y-auto">
            <table className="w-full text-left text-sm">
              <thead>
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
                    <td className="py-1.5 text-zinc-600">{new Date(log.processed_at).toLocaleString("ko-KR")}</td>
                    <td className="py-1.5 text-zinc-500">{log.source === "naver" ? "네이버" : "Gmail"}</td>
                    <td className="py-1.5 text-zinc-800">{log.subject ?? "—"}</td>
                    <td className="py-1.5">
                      {log.status === "processed" && <span className="text-emerald-600">처리됨 ({log.file_names?.length ?? 0}개 파일)</span>}
                      {log.status === "skipped" && <span className="text-zinc-500">건너뜀 — {log.error_message}</span>}
                      {log.status === "error" && <span className="text-red-600">오류 — {log.error_message}</span>}
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
