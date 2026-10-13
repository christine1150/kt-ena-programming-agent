// 경쟁 채널 편성 자료 표준 양식(.xlsx) 내려받기 — 로그인한 관리자·PD. 예시 줄은 합성 값이며 올려도 무시된다.
import { NextResponse } from "next/server";
import { requireActorFor, bad } from "@/lib/idealSchedule/apiUtil";
import { isCompetitorAiringChannel } from "@/lib/competitorAirings/scope";
import { standardTemplateBuffer } from "@/lib/competitorAirings/parse";
import { loadChannelContext } from "@/lib/competitorAirings/store";

export async function GET(request: Request) {
  const auth = await requireActorFor("view");
  if (auth instanceof NextResponse) return auth;
  const channelCode = (new URL(request.url).searchParams.get("channel") ?? "").toUpperCase();
  if (!isCompetitorAiringChannel(channelCode)) return bad("이 채널은 아직 경쟁 채널 편성 자료를 지원하지 않습니다.");
  const ctx = await loadChannelContext(channelCode);
  const target = ctx.ok ? ctx.data.primaryTarget : "수도권 개인2049";
  return new NextResponse(new Uint8Array(standardTemplateBuffer(target)), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="competitor-airings-template.xlsx"`,
    },
  });
}
