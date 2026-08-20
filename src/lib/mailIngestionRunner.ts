// 개발 단위 20번(Nielsen 메일 자동 수집)의 실행 본체. Vercel Cron 라우트와 관리자 화면의
// "지금 확인" 버튼 라우트가 이 함수 하나를 그대로 공유한다 — 같은 처리 과정을 태운다는
// DESIGN.md 원칙을 여기서도 지킨다.
import { supabase } from "@/lib/supabase";
import { loadGmailEnvConfig, fetchUnprocessedNielsenMail } from "@/lib/gmailClient";
import { ingestNielsenFile, loadNielsenIngestContext, type FileSummary } from "@/lib/nielsenIngest";

export interface MailIngestionRunResult {
  ok: boolean;
  message?: string;
  checkedCount: number;
  processed: { messageId: string; subject: string; files: FileSummary[] }[];
}

export async function runNielsenMailIngestion(): Promise<MailIngestionRunResult> {
  const config = loadGmailEnvConfig();
  if ("error" in config) {
    return { ok: false, message: config.error, checkedCount: 0, processed: [] };
  }

  // 이미 처리한 메일은 건너뛴다(mail_ingestion_log에 message_id로 기록).
  const { data: existingLogs } = await supabase.from("mail_ingestion_log").select("message_id");
  const processedMessageIds = new Set((existingLogs ?? []).map((r) => r.message_id as string));

  let mailItems;
  try {
    mailItems = await fetchUnprocessedNielsenMail(config, processedMessageIds);
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err), checkedCount: 0, processed: [] };
  }

  if (mailItems.length === 0) {
    return { ok: true, checkedCount: 0, processed: [] };
  }

  const ctx = await loadNielsenIngestContext();
  if ("error" in ctx) {
    return { ok: false, message: ctx.error, checkedCount: mailItems.length, processed: [] };
  }

  const processed: { messageId: string; subject: string; files: FileSummary[] }[] = [];
  for (const item of mailItems) {
    if (item.attachments.length === 0) {
      await supabase.from("mail_ingestion_log").insert({
        message_id: item.messageId,
        subject: item.subject,
        received_at: item.receivedAt,
        status: "skipped",
        error_message: "엑셀 첨부파일을 찾지 못했습니다.",
      });
      continue;
    }

    // 같은 처리 과정(nielsenIngest.ts) — 관리자 수동 업로드와 동일한 파싱·검증·적재 로직.
    const fileSummaries: FileSummary[] = [];
    for (const attachment of item.attachments) {
      fileSummaries.push(await ingestNielsenFile(attachment.buffer, attachment.fileName, ctx));
    }
    const anyFailed = fileSummaries.some((f) => !f.ok);

    await supabase.from("mail_ingestion_log").insert({
      message_id: item.messageId,
      subject: item.subject,
      received_at: item.receivedAt,
      status: anyFailed ? "error" : "processed",
      file_names: fileSummaries.map((f) => f.fileName),
      error_message: anyFailed
        ? fileSummaries
            .filter((f) => !f.ok)
            .map((f) => `${f.fileName}: ${f.message}`)
            .join(" / ")
        : null,
    });

    processed.push({ messageId: item.messageId, subject: item.subject, files: fileSummaries });
  }

  return { ok: true, checkedCount: mailItems.length, processed };
}
