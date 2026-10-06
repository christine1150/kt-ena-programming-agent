// 관리자 첫 화면의 "자료 수신·반영 현황" 조회 API(관리자 전용, 읽기 전용).
// 채널 × 자료 종류별로 수집됨/분석 반영 완료를 분리해 계산한다(src/lib/admin/ingestStatus.ts). 운영 데이터를 바꾸지 않는다.
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getAdminSession } from "@/lib/adminAuth";
import { APPLICABLE, computeReceiptMatrix, summarizeReceipts, type FactState, type ReceiptFact } from "@/lib/admin/ingestStatus";

const WINDOW_DAYS = 10;
const CHANNELS = Object.keys(APPLICABLE);
const DAY = 86400000;

const kstToday = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** 1000행 단위로 끝까지 읽는다(상한 20쪽). */
async function readAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<{ rows: T[]; error: string | null }> {
  const rows: T[] = [];
  for (let page = 0; page < 20; page++) {
    const { data, error } = await build(page * 1000, page * 1000 + 999);
    if (error) return { rows, error: error.message };
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return { rows, error: null };
}

export async function GET() {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ ok: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });

  const today = kstToday();
  const from = addDays(today, -WINDOW_DAYS);
  const notes: string[] = [];

  const { data: chRows } = await supabase.from("channels").select("id, code").in("code", CHANNELS);
  const codeById = new Map((chRows ?? []).map((c) => [c.id as string, c.code as string]));
  const facts: ReceiptFact[] = [];

  // 마트 계산 시각(채널·날짜별) — 닐슨 일간의 "분석 반영 완료" 판정에 쓴다.
  const mart = await readAll<{ as_of_date: string; channel_code: string; computed_at: string }>((a, b) =>
    supabase.from("mart_daily_dashboard_cache").select("as_of_date, channel_code, computed_at").eq("cache_slot", "narrative_28").gte("as_of_date", from).range(a, b)
  );
  if (mart.error) notes.push(`마트 계산 시각을 읽지 못했습니다: ${mart.error}`);
  const martAt = new Map(mart.rows.map((m) => [`${m.channel_code}|${m.as_of_date}`, m.computed_at]));

  // 닐슨 일간·skyUHD: ratings에 들어온 (채널, 방송일).
  for (const [id, code] of codeById) {
    const types = code === "SKYUHD" ? ["skyuhd"] : ["nielsen_daily"];
    const r = await readAll<{ broadcast_date: string }>((a, b) => supabase.from("ratings").select("broadcast_date").eq("channel_id", id).in("source_type", types).gte("broadcast_date", from).order("broadcast_date", { ascending: false }).range(a, b));
    if (r.error) notes.push(`${code} 시청률 수신일을 읽지 못했습니다: ${r.error}`);
    for (const d of new Set(r.rows.map((x) => x.broadcast_date))) {
      const kind = code === "SKYUHD" ? "skyuhd" : "nielsen_daily";
      facts.push({ channel: code, kind, date: d, state: "applied", martComputedAt: martAt.get(`${code}|${d}`) ?? null, martRequired: kind === "nielsen_daily" });
    }
  }

  // 원장(있을 때): 일간 배치 중 반영되지 않은 날짜(실패·수집만 됨)를 채널 전체에 표시한다.
  const ledger = await supabase.from("nielsen_ingest_batches").select("kind, period_to, status, received_at").eq("kind", "daily").gte("period_to", from).order("received_at", { ascending: false }).limit(200);
  const ledgerAvailable = !ledger.error;
  if (ledger.error) notes.push("수집 원장(nielsen_ingest_batches)이 아직 적용되지 않아 수집 실패·수집만 된 건은 표시되지 않습니다.");
  else {
    const appliedDates = new Set(facts.filter((f) => f.kind === "nielsen_daily").map((f) => f.date));
    const seen = new Set<string>();
    for (const b of ledger.data ?? []) {
      const date = b.period_to as string;
      if (!date || seen.has(date)) continue; // 최신 배치만
      seen.add(date);
      const state = b.status as FactState | "skipped_duplicate";
      if (state === "skipped_duplicate" || (state === "applied" && appliedDates.has(date))) continue;
      for (const code of CHANNELS.filter((c) => c !== "SKYUHD")) {
        if (!appliedDates.has(date) || state === "failed") facts.push({ channel: code, kind: "nielsen_daily", date, state: state === "failed" ? "failed" : state === "partial" ? "partial" : "received", martRequired: true });
      }
    }
  }

  // 주간·월간 기간 순위.
  const periods = await readAll<{ channel_id: string; period_type: string; date_to: string }>((a, b) => supabase.from("nielsen_period_rank").select("channel_id, period_type, date_to").gte("date_to", addDays(today, -60)).range(a, b));
  if (periods.error) notes.push(`기간 순위 수신일을 읽지 못했습니다: ${periods.error}`);
  for (const p of periods.rows) {
    const code = codeById.get(p.channel_id);
    const kind = p.period_type === "weekly" ? "nielsen_weekly" : p.period_type === "monthly" ? "nielsen_monthly" : null;
    if (code && kind) facts.push({ channel: code, kind, date: p.date_to, state: "applied", martRequired: false });
  }

  // EPG 원본 수신.
  const epg = await readAll<{ channel_id: string; broadcast_date: string }>((a, b) => supabase.from("olife_epg_staging").select("channel_id, broadcast_date").gte("broadcast_date", from).range(a, b));
  if (epg.error) notes.push(`EPG 수신일을 읽지 못했습니다: ${epg.error}`);
  for (const key of new Set(epg.rows.map((e) => `${e.channel_id}|${e.broadcast_date}`))) {
    const [cid, date] = key.split("|");
    const code = codeById.get(cid);
    if (code) facts.push({ channel: code, kind: "olife_epg", date, state: "applied", martRequired: false });
  }

  // 메일 수집 상태(연결 상태·마지막 성공·오류만).
  const mail = await supabase.from("mail_ingestion_log").select("processed_at, status").order("processed_at", { ascending: false }).limit(50);
  const mailRows = mail.data ?? [];
  const lastOk = mailRows.find((m) => m.status !== "error")?.processed_at ?? null;
  const lastErr = mailRows.find((m) => m.status === "error")?.processed_at ?? null;
  const errorCount = mailRows.filter((m) => m.status === "error").length;

  const failedUploads = await supabase.from("file_uploads").select("file_name, file_type, error_message, created_at").eq("status", "error").order("created_at", { ascending: false }).limit(5);

  const rows = computeReceiptMatrix({ channels: CHANNELS, window: { from, to: today }, facts, today });
  return NextResponse.json({
    ok: true,
    today,
    window: { from, to: today },
    rows,
    summary: summarizeReceipts(rows),
    ledgerAvailable,
    mail: { lastSuccessAt: lastOk, lastErrorAt: lastErr, recentErrorCount: errorCount },
    recentFailedUploads: (failedUploads.data ?? []).map((u) => ({ fileName: u.file_name, fileType: u.file_type, message: u.error_message, at: u.created_at })),
    // 권리(Avail) 정보는 아직 도입되지 않았다 — 영향 평가를 하지 못한다는 사실 자체를 보여 준다.
    rightsImpact: { status: "not_configured", message: "권리(Avail) 정보가 아직 입력되지 않아 권리 갱신 영향은 평가하지 않습니다." },
    unmatched: { status: "see_upload_result", message: "OLIFE EPG 미매칭·모호 후보는 EPG 업로드 결과에서 확인합니다." },
    notes,
  });
}
