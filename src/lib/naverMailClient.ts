// Nielsen 메일 자동 수집 — 네이버 메일(IMAP) 클라이언트(2026-09-06 신설).
//
// 사용자가 실제로 Nielsen 일일 보고서를 직접 받는 계정이 네이버 메일이라, Gmail
// 전달(forward) 우회(gmailClient.ts, 그룹웨어 2FA 때문에 도입) 없이 네이버 메일함을
// IMAP으로 곧바로 읽는다. 네이버는 Gmail 같은 OAuth2 메일 읽기 API를 공개하지 않아
// (fetch만으로 REST 호출하는 gmailClient.ts와 달리) 표준 IMAP 프로토콜을 쓸 수밖에
// 없어 imapflow(연결) + mailparser(MIME 첨부파일 추출) 두 라이브러리를 쓴다.
//
// 전제: 네이버 메일 설정 > POP3/IMAP 설정에서 "IMAP 사용"을 켜야 하고, 2단계 인증을
// 쓰는 계정이면 일반 비밀번호 대신 "앱 비밀번호"(네이버 계정 보안설정에서 발급)를
// 써야 한다 — 어느 쪽이든 실제 값은 관리자가 직접 .env에 넣는다(Claude가 로그인
// 화면에 비밀번호를 입력하거나 채팅에 값을 적지 않는다). .env에 아래 값이 필요하다.
//   NAVER_MAIL_USER      - 네이버 메일 주소(예: xxx@naver.com)
//   NAVER_MAIL_PASSWORD  - 로그인 비밀번호 또는 2단계 인증 앱 비밀번호
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { NIELSEN_CHANNEL_RATING_ATTACHMENT_PATTERN, type NielsenMailAttachment, type NielsenMailItem } from "@/lib/gmailClient";
import { DAILY_EPG_ATTACHMENT_PATTERN } from "@/lib/olifeEpgDispatch";

export interface NaverMailEnvConfig {
  userEmail: string;
  password: string;
}

export function loadNaverMailEnvConfig(): NaverMailEnvConfig | { error: string } {
  const userEmail = process.env.NAVER_MAIL_USER;
  const password = process.env.NAVER_MAIL_PASSWORD;
  if (!userEmail || !password) {
    return { error: ".env에 NAVER_MAIL_USER/NAVER_MAIL_PASSWORD가 아직 설정되지 않았습니다." };
  }
  return { userEmail, password };
}

// 사용자 지시(2026-09-06): 제목에 "닐슨"과 "보고서"가 모두 들어간 메일(대부분
// "[닐슨] KTENA 일일 보고서") 또는 제목에 "EPG"가 들어간 메일(OLIFE 일일운행표)을
// 대상으로 한다. IMAP SEARCH는 "제목에 A와 B가 모두 포함"을 한 번에 표현하기
// 까다로워(서버마다 부분일치 AND 처리가 다름), 서버에는 두 키워드를 OR로 넓게
// 물어보고(아래 search 호출) 정확한 포함 여부는 이쪽에서 다시 확인한다.
function subjectMatches(subject: string): boolean {
  return (subject.includes("닐슨") && subject.includes("보고서")) || subject.toUpperCase().includes("EPG");
}

/** 아직 처리하지 않은(processedMessageIds에 없는) Nielsen 일일 보고서 메일을 네이버
 *  메일함(IMAP)에서 찾아, 조건에 맞는 엑셀 첨부파일까지 전부 내려받아 반환한다. */
export async function fetchUnprocessedNielsenMailFromNaver(
  config: NaverMailEnvConfig,
  processedMessageIds: Set<string>
): Promise<NielsenMailItem[]> {
  const client = new ImapFlow({
    host: "imap.naver.com",
    port: 993,
    secure: true,
    auth: { user: config.userEmail, pass: config.password },
    logger: false,
  });

  const items: NielsenMailItem[] = [];
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      // 최근 30일만 본다 — 과거 전체를 매번 훑을 필요가 없고(크론이 매일 도는 구조),
      // 네이버 서버 쪽 SEARCH 응답도 가벼워진다.
      const since = new Date();
      since.setDate(since.getDate() - 30);
      const seqs = await client.search({ or: [{ subject: "닐슨" }, { subject: "EPG" }], since }, { uid: true });
      if (!seqs || seqs.length === 0) return items;

      for (const uid of seqs) {
        const message = await client.fetchOne(uid, { envelope: true, source: true }, { uid: true });
        if (!message || !message.envelope) continue;

        const subject = message.envelope.subject ?? "";
        if (!subjectMatches(subject)) continue;

        // 메일 하나를 여러 채널(Gmail 전달본 등)에서 동시에 처리해 중복 적재하는
        // 사고를 막기 위해, IMAP UID(메일함 안에서만 유효)가 아니라 전역적으로
        // 안정적인 Message-ID 헤더를 식별자로 쓴다 — Gmail 쪽과 값 공간이 겹치지
        // 않도록 접두사를 붙인다(mail_ingestion_log.message_id는 두 소스가 공유).
        const rawMessageId = message.envelope.messageId ?? `uid-${uid}`;
        const messageId = `naver:${rawMessageId.replace(/[<>]/g, "")}`;
        if (processedMessageIds.has(messageId)) continue;

        if (!message.source) continue;
        const parsed = await simpleParser(message.source);
        const attachments: NielsenMailAttachment[] = [];
        for (const att of parsed.attachments) {
          if (
            !att.filename ||
            !(NIELSEN_CHANNEL_RATING_ATTACHMENT_PATTERN.test(att.filename) || DAILY_EPG_ATTACHMENT_PATTERN.test(att.filename))
          )
            continue;
          attachments.push({ fileName: att.filename, buffer: att.content });
        }

        items.push({
          messageId,
          subject,
          receivedAt: message.envelope.date ? message.envelope.date.toISOString() : null,
          attachments,
        });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => undefined);
  }
  return items;
}
