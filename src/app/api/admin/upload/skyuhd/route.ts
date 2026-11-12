// skyUHD 시청률 업로드 API (관리자 전용).
// 이 파일은 그때그때 누적된 전체 기간을 다시 수기로 정리해 올리는 방식이므로
// (CLAUDE.md: "수기 업데이트 파일"), 매번 이번 파일이 다루는 기간만 지우고 새로 채운다.
//
// 실제 파싱·저장 로직은 skyUhdDispatch.ts로 옮겼다(2026-09-23) — 네이버 메일로 오는
// skyUHD 첨부파일을 자동 인식·적재하는 메일 수집 파이프라인(mailIngestionRunner.ts)도
// 정확히 같은 함수를 써야 한다는 원칙(nielsenFileDispatch.ts·olifeEpgDispatch.ts와 동일).
// 이 라우트는 이제 요청을 받아 인증만 확인하고 그 함수를 호출하는 얇은 어댑터다.
//
// 2026-11-13 추가 — IPTV 셋톱 시청률 "화면 캡처 그림"(png/jpg/webp)도 받는다. 그림이면 엑셀 경로로 보내지 않고
//  1) multipart(file[, calendarDate]) → 그림 속 표를 읽어 "미리보기"만 돌려주고(저장 안 함),
//  2) JSON {action:"apply_image", calendarDate, rows} → 사용자가 미리보기를 확인한 뒤 iptv_stb_ratings 에 저장한다.
// 비전 모델이 글자를 잘못 읽을 수 있어 반드시 두 단계로 나눈다(읽기=iptvStbImage.ts, 검증·환산도 거기의 순수 함수).
import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/adminAuth";
import { ingestSkyUhdRatingFile } from "@/lib/skyUhdDispatch";
import { supabase } from "@/lib/supabase";
import {
  buildStbDbRows,
  extractStbRowsFromImage,
  imageMimeOf,
  suggestCalendarDate,
  validateStbRows,
  type StbImageRow,
} from "@/lib/iptvStbImage";

export const maxDuration = 120; // 그림 인식(비전 모델)이 수십 초 걸릴 수 있다

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function kstToday(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
function shiftDate(d: string, days: number): string {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + days);
  return x.toISOString().slice(0, 10);
}

/** 닐슨에 들어 있는 skyUHD 편성의 방송일별 시작 분(02:00 이전은 +1440) — 날짜 추정용. 실패해도 추정만 못 할 뿐이다. */
async function loadSkyUhdSchedule(from: string, to: string): Promise<Map<string, number[]>> {
  const map = new Map<string, number[]>();
  try {
    const { data: ch } = await supabase.from("channels").select("id").eq("code", "SKYUHD").maybeSingle();
    if (!ch) return map;
    const { data } = await supabase
      .from("ratings")
      .select("broadcast_date, start_time")
      .eq("channel_id", ch.id)
      .gte("broadcast_date", from)
      .lte("broadcast_date", to)
      .not("start_time", "is", null);
    for (const r of (data ?? []) as { broadcast_date: string; start_time: string }[]) {
      const m = /^(\d{2}):(\d{2})/.exec(r.start_time);
      if (!m) continue;
      let min = Number(m[1]) * 60 + Number(m[2]);
      if (min < 120) min += 1440;
      const arr = map.get(r.broadcast_date) ?? [];
      arr.push(min);
      map.set(r.broadcast_date, arr);
    }
  } catch {
    // 추정만 포기
  }
  return map;
}

async function handleImagePreview(file: File, fileName: string, mime: string) {
  if (file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ ok: false, message: "그림 파일이 너무 큽니다(4MB 이하로 올려 주세요)." }, { status: 413 });
  }
  let rows: StbImageRow[];
  try {
    rows = await extractStbRowsFromImage(Buffer.from(await file.arrayBuffer()), mime);
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 422 });
  }
  const validation = validateStbRows(rows);
  const today = kstToday();
  const candidates = Array.from({ length: 8 }, (_, i) => shiftDate(today, -i)); // 오늘~7일 전
  const schedule = await loadSkyUhdSchedule(shiftDate(today, -9), today);
  const suggested = suggestCalendarDate(rows, candidates, schedule);
  return NextResponse.json({
    ok: true,
    mode: "image_preview",
    fileName,
    rows,
    errors: validation.errors,
    warnings: validation.warnings,
    suggestedDate: suggested?.date ?? null,
    suggestedMatch: suggested ? `${suggested.matched}/${suggested.total}` : null,
  });
}

async function handleImageApply(body: { calendarDate?: unknown; rows?: unknown; fileName?: unknown }) {
  const calendarDate = typeof body.calendarDate === "string" ? body.calendarDate : "";
  if (!DATE_RE.test(calendarDate) || Number.isNaN(Date.parse(`${calendarDate}T00:00:00Z`))) {
    return NextResponse.json({ ok: false, message: "날짜(YYYY-MM-DD)를 입력해 주세요." }, { status: 400 });
  }
  if (calendarDate > kstToday()) {
    return NextResponse.json({ ok: false, message: "오늘 이후 날짜는 반영할 수 없습니다." }, { status: 400 });
  }
  if (!Array.isArray(body.rows)) {
    return NextResponse.json({ ok: false, message: "반영할 줄이 없습니다." }, { status: 400 });
  }
  // 클라이언트가 보낸 값은 믿지 않고 모양을 다시 다듬은 뒤 서버에서 다시 검증한다.
  const rows: StbImageRow[] = (body.rows as Record<string, unknown>[]).map((r) => ({
    start: String(r.start ?? ""),
    end: String(r.end ?? ""),
    name: String(r.name ?? ""),
    rating: typeof r.rating === "number" ? r.rating : null,
    belowFloor: r.belowFloor === true,
    isRerun: r.isRerun === true,
  }));
  const validation = validateStbRows(rows);
  if (validation.errors.length > 0) {
    return NextResponse.json({ ok: false, message: validation.errors.join(" / ") }, { status: 422 });
  }
  const label = typeof body.fileName === "string" ? body.fileName.slice(0, 80) : "화면 캡처";
  const source = `IPTV 3사 셋톱 시청률 화면 캡처 업로드(${kstToday()} 전달) — ${label}`;
  let dbRows;
  try {
    dbRows = buildStbDbRows(calendarDate, rows, source);
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 422 });
  }
  const { error } = await supabase.from("iptv_stb_ratings").upsert(dbRows, { onConflict: "broadcast_date,channel_code,start_minute" });
  if (error) {
    return NextResponse.json({ ok: false, message: `저장 실패 — ${error.message}` }, { status: 500 });
  }
  const dates = [...new Set(dbRows.map((r) => r.broadcast_date))].sort();
  return NextResponse.json({
    ok: true,
    mode: "image_applied",
    saved: dbRows.length,
    broadcastDates: dates,
    warnings: validation.warnings,
  });
}

export async function POST(request: Request) {
  const admin = await getAdminSession();
  if (!admin) {
    return NextResponse.json({ ok: false, message: "관리자 로그인이 필요합니다." }, { status: 401 });
  }

  // 그림 반영(2단계) — JSON 본문
  if ((request.headers.get("content-type") ?? "").includes("application/json")) {
    const body = await request.json().catch(() => null);
    if (body?.action === "apply_image") return handleImageApply(body);
    return NextResponse.json({ ok: false, message: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ ok: false, message: "업로드된 파일이 없습니다." }, { status: 400 });
  }

  const fileName = file.name;

  // 그림 미리보기(1단계) — 엑셀 경로로 보내지 않는다
  const imageMime = imageMimeOf(fileName, file.type);
  if (imageMime) return handleImagePreview(file, fileName, imageMime);

  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await ingestSkyUhdRatingFile(buffer, fileName);

  if (!result.ok) {
    // 기존 라우트와 동일한 상태 매핑: 채널 없음은 400, 파싱 실패/빈 데이터는 422(파싱 실패만
    // DATA_QUALITY_ALERT 배지), 저장 단계(DB) 오류는 500.
    const status = result.errorStage === "db" ? 500 : result.errorStage === "channel" ? 400 : 422;
    const alert = result.errorStage === "parse" ? "DATA_QUALITY_ALERT" : undefined;
    return NextResponse.json({ ok: false, alert, message: result.message }, { status });
  }

  return NextResponse.json({
    ok: true,
    ratingsInserted: result.ratingsInserted,
    dateRange: result.dateRange,
    sheetName: result.sheetName,
    zeroRatingRows: result.zeroRatingRows,
    warnings: result.message ? result.message.split(" / ") : [],
  });
}
