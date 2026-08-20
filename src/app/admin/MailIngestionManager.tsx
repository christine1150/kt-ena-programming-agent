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
}

export default function MailIngestionManager() {
  const [gmailConfigured, setGmailConfigured] = useState<boolean | null>(null);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<RunResult | null>(null);

  async function fetchStatus(): Promise<{ gmailConfigured: boolean; logs: LogRow[] } | null> {
    const res = await fetch("/api/admin/mail-ingestion/status");
    const body = await res.json().catch(() => null);
    return body?.ok ? { gmailConfigured: body.gmailConfigured, logs: body.logs } : null;
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const status = await fetchStatus();
      if (cancelled || !status) return;
      setGmailConfigured(status.gmailConfigured);
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
      setLogs(status.logs);
    }
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-zinc-100">
      <h2 className="mb-1 text-lg font-semibold text-zinc-900">Nielsen 메일 자동 수집</h2>
      <p className="mb-4 text-sm text-zinc-500">
        Gmail로 전달(forward)받은 <code>[닐슨] KTENA 일일 보고서</code> 메일의 엑셀 첨부파일을
        매일 08:00(KST)에 자동으로 확인해 위 &ldquo;Nielsen 시청률 업로드&rdquo;와 같은 방식으로
        반영합니다. christine@ktena.co.kr의 그룹웨어는 2FA가 걸려있어 직접 자동 로그인할 수 없어,
        Gmail 계정으로 메일을 전달받는 방식을 씁니다 — 전달 규칙은 관리자가 직접 Bizbox
        웹메일에서 설정해야 합니다.
      </p>

      {gmailConfigured === false && (
        <div className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
          아직 Gmail 연동이 설정되지 않았습니다. <code>.env</code>에 <code>GMAIL_USER_EMAIL</code>/
          <code>GMAIL_CLIENT_ID</code>/<code>GMAIL_CLIENT_SECRET</code>/<code>GMAIL_REFRESH_TOKEN</code>을
          채워주세요. 그 전까지는 아래 &ldquo;지금 확인&rdquo;을 눌러도 안내 메시지만 표시됩니다.
        </div>
      )}
      {gmailConfigured === true && (
        <div className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">Gmail 연동이 설정되어 있습니다.</div>
      )}

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
            runResult.checkedCount === 0 ? (
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
            )
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
                  <th className="pb-1 font-medium">제목</th>
                  <th className="pb-1 font-medium">결과</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.message_id} className="border-t border-zinc-100">
                    <td className="py-1.5 text-zinc-600">{new Date(log.processed_at).toLocaleString("ko-KR")}</td>
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
