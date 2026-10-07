// 단계 14 — 스냅샷 기반 보고서 API(portfolio · pptx). 웹·Word·PPT·PDF가 같은 스냅샷에서 나온다(snapshot=<ID>가 있으면 저장된 그 원본, 없으면 만들거나 방금 만든 것 재사용).
import { NextResponse } from "next/server";
import { requireSession, resolveSnapshot } from "@/lib/reportSnapshot/http";
import { pptxResponse, failResponse } from "@/lib/reportSnapshot/responses";

export const maxDuration = 120;

export async function GET(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;
  try {
    const r = await resolveSnapshot(request, "portfolio", undefined);
    if (r instanceof NextResponse) return r;
    return await pptxResponse(r.result);
  } catch (err) {
    return failResponse(err, "문서를 생성하지 못했습니다.");
  }
}
