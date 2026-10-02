// 콘텐츠 구매 시뮬레이터 — 프로그램 후보 검색(오타·띄어쓰기·부제 변형 허용). 결정론적 DB 검색이며 LLM 은 영문 질의 확장에만 쓴다.
import { NextResponse } from "next/server";
import { bad, fail, requireActor } from "@/lib/idealSchedule/apiUtil";
import { supabase } from "@/lib/supabase";
import { resolveProgramIdentity } from "@/lib/purchaseSim/identity";
import { expandQueryWithLlm } from "@/lib/purchaseSim/llmExpand";
import { parsePredictionQuery } from "@/lib/purchaseSim/queryParse";

export async function GET(request: Request) {
  const auth = await requireActor();
  if (auth instanceof NextResponse) return auth;
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim();
  if (q.length < 1 || q.length > 80) return bad("검색어는 1~80자로 입력해 주세요.");
  try {
    const parsed = parsePredictionQuery(q);
    const identity = await resolveProgramIdentity(supabase, parsed.programQuery || q, { fallbackText: parsed.rawProgramText, llmExpand: expandQueryWithLlm });
    return NextResponse.json({ ok: true, parsed, identity });
  } catch (e) {
    return fail(e);
  }
}
