// 단계 14 — 스냅샷 기반 보고서 API(channel · json). 웹·Word·PPT·PDF가 같은 스냅샷에서 나온다(snapshot=<ID>가 있으면 저장된 그 원본, 없으면 만들거나 방금 만든 것 재사용).
import { NextResponse } from "next/server";
import { requireSession, resolveSnapshot, publicSnapshot } from "@/lib/reportSnapshot/http";
import { failResponse } from "@/lib/reportSnapshot/responses";

export const maxDuration = 120;

export async function GET(request: Request, { params }: { params: Promise<{ channel: string }> }) {
  const denied = await requireSession();
  if (denied) return denied;
  const { channel } = await params;
  try {
    const r = await resolveSnapshot(request, "channel", channel);
    if (r instanceof NextResponse) return r;
    return NextResponse.json({ ok: true, report: r.result.snapshot.document, snapshot: publicSnapshot(r.result) });
  } catch (err) {
    return failResponse(err, "리포트를 생성하지 못했습니다.");
  }
}
