// 질문하기 답변 엑셀 내려받기 — 화면에 표시된 답변(질문·데이터 기준일·answer)을 받아 xlsx 로 만든다. DB 는 읽지 않는다.
// 권한은 권한표의 export(편성자 이상). 요청 본문 크기와 형식을 검사한다.
import { NextResponse } from "next/server";
import { bad, requireActorFor } from "@/lib/idealSchedule/apiUtil";
import { buildAnswerWorkbook } from "@/lib/intent/answerExcel";
import type { EvidenceAnswer } from "@/lib/intent/types";

const MAX_BODY = 1_500_000;

export async function POST(request: Request) {
  const auth = await requireActorFor("export");
  if (auth instanceof NextResponse) return auth;
  const raw = await request.text();
  if (raw.length > MAX_BODY) return bad("내려받을 내용이 너무 큽니다.", 413);
  let body: { question?: unknown; dataAsOf?: unknown; answer?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return bad("요청 형식이 올바르지 않습니다.");
  }
  const a = body.answer as Partial<EvidenceAnswer> | undefined;
  if (!a || typeof a !== "object" || typeof a.conclusion !== "string" || typeof a.intent_id !== "string") return bad("내려받을 답변이 없습니다.");
  const dataAsOf = typeof body.dataAsOf === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.dataAsOf) ? body.dataAsOf : null;
  const buf = buildAnswerWorkbook({ question: typeof body.question === "string" ? body.question : "", dataAsOf, answer: a as EvidenceAnswer });
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="ask-answer-${dataAsOf ?? "export"}.xlsx"`,
    },
  });
}
