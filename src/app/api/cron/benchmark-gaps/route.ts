// 비교군 격차 자리 주간 적재 크론(고도화 B2) — 일요일 밤(UTC, 월요일 새벽 KST) 한 번에 자사 6채널을 돈다.
// ?channel=<자사 채널 코드>로 한 채널만 다시 적재할 수 있다(수동 점검). 실패한 채널이 있으면 500으로 알린다(건너뜀은 실패가 아님).
import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cronAuth";
import { runBenchmarkGaps } from "@/lib/benchmark/run";
import { kstToday } from "@/lib/workspace/dates";

export const maxDuration = 300;

export async function GET(request: Request) {
  const auth = checkCronAuth(request.headers.get("authorization"));
  if (!auth.ok) return NextResponse.json({ ok: false, message: auth.message }, { status: auth.status });
  const channel = new URL(request.url).searchParams.get("channel");
  const started = Date.now();
  const results = await runBenchmarkGaps({ asOf: kstToday(), only: channel });
  const failed = results.filter((r) => r.status === "failed");
  return NextResponse.json(
    { ok: failed.length === 0, asOf: kstToday(), channels: results.length, results, seconds: Math.round((Date.now() - started) / 1000) },
    { status: failed.length === 0 ? 200 : 500 }
  );
}
