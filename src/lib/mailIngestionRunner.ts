// 개발 단위 20번(Nielsen 메일 자동 수집)의 실행 본체. Vercel Cron 라우트와 관리자 화면의
// "지금 확인" 버튼 라우트가 이 함수 하나를 그대로 공유한다 — 같은 처리 과정을 태운다는
// DESIGN.md 원칙을 여기서도 지킨다.
import { supabase } from "@/lib/supabase";
import {
  loadGmailEnvConfig,
  fetchUnprocessedNielsenMail,
  NIELSEN_CHANNEL_RATING_ATTACHMENT_PATTERN,
  type NielsenMailItem,
} from "@/lib/gmailClient";
import { loadNaverMailEnvConfig, fetchUnprocessedNielsenMailFromNaver } from "@/lib/naverMailClient";
import { ingestAnyNielsenFile, loadNielsenFileDispatchContext, type NielsenFileSummary } from "@/lib/nielsenFileDispatch";
import { ingestOlifeEpgFile, detectEpgChannelCode, DAILY_EPG_ATTACHMENT_PATTERN, type OlifeEpgFileSummary } from "@/lib/olifeEpgDispatch";

type AnyIngestFileSummary = NielsenFileSummary | OlifeEpgFileSummary;

export interface MailIngestionRunResult {
  ok: boolean;
  message?: string;
  checkedCount: number;
  processed: { messageId: string; subject: string; files: AnyIngestFileSummary[] }[];
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

  // 2026-09-06: 일간뿐 아니라 주간·월간(기간) 엑셀, 그리고 일일운행표(EPG) 엑셀도 메일에
  // 들어있으면 같이 적재한다 — 관리자 수동 업로드가 쓰는 것과 정확히 같은 판정·적재 함수를
  // 공유해(nielsenFileDispatch.ts/olifeEpgDispatch.ts) 로직이 두 곳에서 갈라지지 않는다.
  // 사용자 지시(2026-09-07): EPG 자동 인식을 OLIFE 전용에서 ENA/ENA Play/ENA Drama/ENA Story/
  // OLIFE/ONCE 전체로 확장 — 메일 제목에서 detectEpgChannelCode로 채널을 찾으므로, OLIFE
  // 하나만 미리 조회하지 않고 전체 채널의 code→id 맵을 만들어둔다.
  const [nielsenCtx, channelRowsRes] = await Promise.all([loadNielsenFileDispatchContext(), supabase.from("channels").select("id, code")]);
  if ("error" in nielsenCtx) {
    return { ok: false, message: nielsenCtx.error, checkedCount: mailItems.length, processed: [] };
  }
  const channelIdByCode = new Map((channelRowsRes.data ?? []).map((c) => [c.code as string, c.id as string]));

  const processed: { messageId: string; subject: string; files: AnyIngestFileSummary[] }[] = [];
  for (const item of mailItems) {
    // 동시성 버그 수정(2026-09-06, 자체 발견): 예전엔 "먼저 적재하고 나중에 처리 기록을
    // 남기는" 순서라, 두 실행이 겹치면(수동 테스트와 스케줄 트리거가 겹치거나 두
    // 스케줄러가 비슷한 시각에 겹치는 경우) 같은 메일을 동시에 두 번 적재할 수 있었다
    // (실측: 겹친 두 호출이 이번엔 우연히 다른 날짜를 나눠 처리해 충돌은 없었지만,
    // 같은 메일을 집었다면 시청률이 중복 적재됐을 것). 이제 실제 적재 전에 이 메일을
    // status="processing"으로 먼저 선점(claim)한다 — message_id 유니크 제약 위반이면
    // 다른 실행이 이미 선점한 것이므로 조용히 건너뛰고, 선점에 성공했을 때만 적재를
    // 진행한 뒤 같은 행을 최종 상태로 갱신한다.
    const { error: claimError } = await supabase.from("mail_ingestion_log").insert({
      message_id: item.messageId,
      subject: item.subject,
      received_at: item.receivedAt,
      source: item.source,
      status: "processing",
    });
    if (claimError) {
      // 23505 = unique_violation(다른 실행이 이미 선점) — 그 외 오류도 이번 실행에서는
      // 이 메일을 건너뛴다(선점 자체가 안 됐으니 적재를 시작하지 않는 것이 안전).
      continue;
    }

    if (item.attachments.length === 0) {
      await supabase
        .from("mail_ingestion_log")
        .update({
          status: "skipped",
          error_message: "조건에 맞는 닐슨 채널시청률·일일운행표(EPG) 엑셀 첨부파일을 찾지 못했습니다.",
          processed_at: new Date().toISOString(),
        })
        .eq("message_id", item.messageId);
      continue;
    }

    // 첨부파일마다 파일명 패턴으로 어느 처리 경로(닐슨 시청률/일일운행표 EPG)로 보낼지 정한다.
    // EPG는 "어느 채널의 편성인지"를 메일 제목에서 한 번만 찾아 이 메일의 모든 EPG 첨부에
    // 공통으로 쓴다(사용자 지시: 제목의 채널명+EPG 문구로 자동 매치, 대소문자·띄어쓰기 무관).
    const epgChannelCode = detectEpgChannelCode(item.subject);
    const fileSummaries: AnyIngestFileSummary[] = [];
    for (const attachment of item.attachments) {
      if (DAILY_EPG_ATTACHMENT_PATTERN.test(attachment.fileName)) {
        if (!epgChannelCode) {
          fileSummaries.push({
            kind: "olife_epg",
            fileName: attachment.fileName,
            ok: false,
            message: "메일 제목에서 채널명을 인식하지 못했습니다(ENA/ENA Play/ENA Drama/ENA Story/OLIFE/ONCE 중 하나가 제목에 있어야 합니다).",
          });
          continue;
        }
        const epgChannelId = channelIdByCode.get(epgChannelCode);
        if (!epgChannelId) {
          fileSummaries.push({ kind: "olife_epg", fileName: attachment.fileName, ok: false, message: `${epgChannelCode} 채널 정보를 찾을 수 없습니다.` });
          continue;
        }
        fileSummaries.push(await ingestOlifeEpgFile(attachment.buffer, attachment.fileName, epgChannelId));
      } else if (NIELSEN_CHANNEL_RATING_ATTACHMENT_PATTERN.test(attachment.fileName)) {
        fileSummaries.push(await ingestAnyNielsenFile(attachment.buffer, attachment.fileName, nielsenCtx));
      }
      // 둘 다 아니면(이론상 도달 불가 — 두 클라이언트가 이미 이 두 패턴으로만 첨부를
      // 걸러서 넘긴다) 조용히 건너뛴다.
    }
    const anyFailed = fileSummaries.some((f) => !f.ok);

    await supabase
      .from("mail_ingestion_log")
      .update({
        status: anyFailed ? "error" : "processed",
        file_names: fileSummaries.map((f) => f.fileName),
        error_message: anyFailed
          ? fileSummaries
              .filter((f) => !f.ok)
              .map((f) => `${f.fileName}: ${f.message}`)
              .join(" / ")
          : null,
        processed_at: new Date().toISOString(),
      })
      .eq("message_id", item.messageId);

    processed.push({ messageId: item.messageId, subject: item.subject, files: fileSummaries });
  }

  return {
    ok: true,
    message: fetchErrors.length > 0 ? `일부 소스 확인 실패: ${fetchErrors.join(" / ")}` : undefined,
    checkedCount: mailItems.length,
    processed,
  };
}
