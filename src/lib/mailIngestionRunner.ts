// 개발 단위 20번(Nielsen 메일 자동 수집)의 실행 본체. Vercel Cron 라우트와 관리자 화면의
// "지금 확인" 버튼 라우트가 이 함수 하나를 그대로 공유한다 — 같은 처리 과정을 태운다는
// DESIGN.md 원칙을 여기서도 지킨다.
import { supabase } from "@/lib/supabase";
import { loadGmailEnvConfig, fetchUnprocessedNielsenMail, type NielsenMailItem } from "@/lib/gmailClient";
import { loadNaverMailEnvConfig, fetchUnprocessedNielsenMailFromNaver } from "@/lib/naverMailClient";
import { ingestNielsenFile, loadNielsenIngestContext, type FileSummary } from "@/lib/nielsenIngest";

export interface MailIngestionRunResult {
  ok: boolean;
  message?: string;
  checkedCount: number;
  processed: { messageId: string; subject: string; files: FileSummary[] }[];
}

type SourcedMailItem = NielsenMailItem & { source: "gmail" | "naver" };

export async function runNielsenMailIngestion(): Promise<MailIngestionRunResult> {
  // 사용자 지시(2026-09-06): Gmail(전달 우회)과 네이버 메일(직접 IMAP) 두 소스를 각각
  // 독립적으로 지원한다 — 둘 다 .env에 설정돼 있으면 둘 다 확인하고, 하나만 설정돼
  // 있으면 그것만 돈다(서로의 존재를 몰라도 됨). 둘 다 설정이 없을 때만 오류로 멈춘다.
  const gmailConfig = loadGmailEnvConfig();
  const naverConfig = loadNaverMailEnvConfig();
  if ("error" in gmailConfig && "error" in naverConfig) {
    return {
      ok: false,
      message: `${gmailConfig.error} / ${naverConfig.error}`,
      checkedCount: 0,
      processed: [],
    };
  }

  // 이미 처리한 메일은 건너뛴다(mail_ingestion_log에 message_id로 기록).
  const { data: existingLogs } = await supabase.from("mail_ingestion_log").select("message_id");
  const processedMessageIds = new Set((existingLogs ?? []).map((r) => r.message_id as string));

  const mailItems: SourcedMailItem[] = [];
  const fetchErrors: string[] = [];

  if (!("error" in gmailConfig)) {
    try {
      const gmailItems = await fetchUnprocessedNielsenMail(gmailConfig, processedMessageIds);
      mailItems.push(...gmailItems.map((item) => ({ ...item, source: "gmail" as const })));
    } catch (err) {
      fetchErrors.push(`Gmail: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (!("error" in naverConfig)) {
    try {
      const naverItems = await fetchUnprocessedNielsenMailFromNaver(naverConfig, processedMessageIds);
      mailItems.push(...naverItems.map((item) => ({ ...item, source: "naver" as const })));
    } catch (err) {
      fetchErrors.push(`네이버 메일: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 한쪽 소스만 실패해도(예: 네이버 비밀번호 만료) 다른 쪽은 계속 처리한다 — 단, 결과
  // 메시지에 어느 소스가 실패했는지는 남긴다. 양쪽 다 시도했는데 둘 다 실패하고
  // 확인할 메일도 없으면 오류로 보고한다.
  if (mailItems.length === 0) {
    if (fetchErrors.length > 0) {
      return { ok: false, message: fetchErrors.join(" / "), checkedCount: 0, processed: [] };
    }
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
        source: item.source,
        status: "skipped",
        error_message: "조건에 맞는 닐슨 채널시청률 엑셀 첨부파일을 찾지 못했습니다.",
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
      source: item.source,
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

  return {
    ok: true,
    message: fetchErrors.length > 0 ? `일부 소스 확인 실패: ${fetchErrors.join(" / ")}` : undefined,
    checkedCount: mailItems.length,
    processed,
  };
}
