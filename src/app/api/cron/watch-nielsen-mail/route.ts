// 닐슨 일일보고서 메일 감시 크론(2026-10-18, 사용자 지시: 메일은 매일 07:35~08:15 KST에 몰려 오니 그 시간대에 문제 없이 반영되게).
// Vercel Hobby 크론은 하루 한 번·시각 정확도가 시간 단위(vercel.json "0 22 * * *" = KST 07시대 한 번)라 07:35~08:15를 훑을 수 없다.
// 그래서 07시 크론이 이 라우트를 켜면 "오늘 일일보고서가 반영될 때까지" 1분 간격으로 메일을 확인하고(07:30 전에는 접속 없이 기다리기만)(mailWatch.ts의 감시 창 07:00~08:55 KST 안에서만),
// 한 번의 호출(최대 300초)로 끝나지 않으면 다음 호출을 스스로 이어 붙인다(hop 상한 있음). 반영되면 즉시 멈춰 그날 비용은 거기서 끝난다.
// 확인·반영 본체는 관리자 "지금 확인"·fetch-nielsen-mail과 같은 runNielsenMailIngestion(메일별 선점 기록으로 겹쳐 돌아도 같은 메일을 두 번 처리하지 않음).
import { NextResponse, after } from "next/server";
import { checkCronAuth } from "@/lib/cronAuth";
import { runNielsenMailIngestion } from "@/lib/mailIngestionRunner";
import { supabase } from "@/lib/supabase";
import { WATCH_POLL_MS, expectedSubjectFragment, shouldChain, shouldCheckMailNow, shouldPollAgain, kstParts } from "@/lib/mailWatch";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 오늘 아침 와야 하는 일일보고서 메일이 이미 반영(processed)됐는가 */
async function todaysReportDone(nowMs: number): Promise<boolean> {
  const { data, error } = await supabase
    .from("mail_ingestion_log")
    .select("status")
    .like("subject", `%${expectedSubjectFragment(nowMs)}%`)
    .eq("status", "processed")
    .limit(1);
  return !error && (data?.length ?? 0) > 0;
}

export async function GET(request: Request) {
  const auth = checkCronAuth(request.headers.get("authorization"));
  if (!auth.ok) return NextResponse.json({ ok: false, message: auth.message }, { status: auth.status });

  const url = new URL(request.url);
  const hop = Math.max(0, Math.floor(Number(url.searchParams.get("hop") ?? 0)) || 0);
  const startedMs = Date.now();

  let done = await todaysReportDone(startedMs);
  let checks = 0;
  let lastMessage: string | undefined;
  let processedCount = 0;
  // 이미 반영됐으면 IMAP을 건드리지 않는다. 아니면 반영될 때까지(또는 이 호출의 시간 상한까지) 1분 간격으로 확인(07:30 전에는 대기만).
  while (!done) {
    if (!shouldCheckMailNow(Date.now())) {
      if (!shouldPollAgain({ done, nowMs: Date.now(), startedMs })) break;
      await sleep(WATCH_POLL_MS);
      continue;
    }
    const result = await runNielsenMailIngestion().catch((e) => ({ ok: false, message: e instanceof Error ? e.message : String(e), checkedCount: 0, processed: [] as unknown[] }));
    checks++;
    lastMessage = result.message;
    processedCount += result.processed.length;
    done = await todaysReportDone(Date.now());
    if (!shouldPollAgain({ done, nowMs: Date.now(), startedMs })) break;
    await sleep(WATCH_POLL_MS);
  }

  const chain = shouldChain({ done, nowMs: Date.now(), hop });
  if (chain) {
    // 응답을 돌려준 뒤 다음 호출을 시작한다(응답은 기다리지 않는다 — 다음 호출은 자기 시간 한도 안에서 따로 돈다).
    const next = new URL(url.origin + url.pathname);
    next.searchParams.set("hop", String(hop + 1));
    const authorization = request.headers.get("authorization");
    after(async () => {
      await fetch(next, { headers: authorization ? { authorization } : {}, signal: AbortSignal.timeout(8_000) }).catch(() => undefined);
    });
  }

  const nowKst = kstParts(Date.now());
  return NextResponse.json({ ok: true, done, hop, checks, processedCount, chained: chain, kstMinutes: nowKst.minutes, message: lastMessage });
}
