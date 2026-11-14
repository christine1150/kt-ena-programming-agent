// 편성 변경 이벤트 주간 적재 크론(고도화 B1) — 월요일 새벽(KST) 출처별로 따로 돈다(vercel.json: own·comp·iptv 각 1회).
// ?source=own|comp|iptv 로 출처를 고르고(필수), ?channel=<채널 키>로 한 채널만 다시 적재할 수 있다(수동 점검).
// 한 채널이 실패해도 다른 채널은 진행하고, 실패가 있으면 500으로 알린다. 화면·판정에는 아직 연결하지 않는다(적재만).
import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cronAuth";
import { EVENT_SOURCES, type EventSource } from "@/lib/changeEvents/channels";
import { runChangeEvents } from "@/lib/changeEvents/run";
import { kstToday } from "@/lib/workspace/dates";

export const maxDuration = 300;

export async function GET(request: Request) {
  const auth = checkCronAuth(request.headers.get("authorization"));
  if (!auth.ok) return NextResponse.json({ ok: false, message: auth.message }, { status: auth.status });

  const url = new URL(request.url);
  const source = url.searchParams.get("source") as EventSource | null;
  if (!source || !EVENT_SOURCES.includes(source)) return NextResponse.json({ ok: false, message: "source는 own·comp·iptv 중 하나여야 합니다." }, { status: 400 });
  const channel = url.searchParams.get("channel");

  const started = Date.now();
  const results = await runChangeEvents({ source, asOf: kstToday(), only: channel });
  const failed = results.filter((r) => r.status === "failed");
  const empty = results.filter((r) => r.status === "empty").map((r) => r.key);
  const events = results.reduce((s, r) => s + r.events, 0);
  return NextResponse.json(
    { ok: failed.length === 0, source, asOf: kstToday(), channels: results.length, events, empty, failed: failed.map((r) => ({ key: r.key, error: r.error })), seconds: Math.round((Date.now() - started) / 1000) },
    { status: failed.length === 0 ? 200 : 500 }
  );
}
