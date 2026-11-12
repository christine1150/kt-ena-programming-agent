// IPTV 셋톱 시청률 그림 변환(src/lib/iptvStbImage.ts) 점검 — 기본은 DB·네트워크 없이: npx tsx scripts/test-iptv-stb-image.ts
// 실제 그림을 비전 모델로 읽어 사람이 옮긴 JSON 과 대조하려면(OpenAI 호출 발생):
//   npx tsx --env-file=.env scripts/test-iptv-stb-image.ts --live <그림 경로> <사람이 옮긴 json 경로>
import fs from "node:fs";
import { buildStbDbRows, extractStbRowsFromImage, hhmmToMinute, imageMimeOf, stripBroadcastTag, suggestCalendarDate, validateStbRows, type StbImageRow } from "../src/lib/iptvStbImage";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "✅" : "❌"} ${name}${!ok && detail ? ` — ${detail}` : ""}`);
}
const row = (start: string, end: string, name: string, rating: number | null, isRerun = true, belowFloor = false): StbImageRow => ({ start, end, name, rating, isRerun, belowFloor });

// 기본 변환
check("시각 파싱", hhmmToMinute("23:40") === 1420 && hhmmToMinute("1:06") === 66 && hhmmToMinute("aa") === null);
check("배지 태그 제거", stripBroadcastTag("금의야행 <재>") === "금의야행" && stripBroadcastTag("금의야행 [재]") === "금의야행" && stripBroadcastTag("재즈") === "재즈");
check("그림 형식 판별", imageMimeOf("a.PNG", "") === "image/png" && imageMimeOf("a.xlsx", "") === null && imageMimeOf("x", "image/webp") === "image/webp");

// 11/12 캡처와 같은 모양: 새벽 구간은 전날 방송일로, 자정 넘김 구간은 끝에 +1440
const rows: StbImageRow[] = [
  row("01:06", "01:50", "엘리전스 시즌2", 0.0032, false),
  row("02:35", "03:22", "더 캡처 시즌2", 0.0003, false),
  row("03:22", "04:13", "금의야행", null, true, true),
  row("23:40", "01:04", "내 아이의 사생활", 0.0026, true),
];
const db = buildStbDbRows("2026-11-12", rows, "test");
check("01시대 시작은 전날 방송일 +1440분", db[0].broadcast_date === "2026-11-11" && db[0].start_minute === 66 + 1440 && db[0].end_minute === 110 + 1440);
check("02시 이후 시작은 그날 방송일", db[1].broadcast_date === "2026-11-12" && db[1].start_minute === 155);
check("바닥값은 rating 비우고 below_floor", db[2].rating === null && db[2].below_floor === true);
check("자정 넘김 구간 끝 +1440", db[3].start_minute === 1420 && db[3].end_minute === 64 + 1440);
check("[재] 없으면 <본>, 있으면 <재>", db[0].program_name === "엘리전스 시즌2 <본>" && db[3].program_name === "내 아이의 사생활 <재>");

// 검증
check("정상 줄은 오류 없음", validateStbRows(rows).errors.length === 0, validateStbRows(rows).errors.join("/"));
check("빈 목록은 오류", validateStbRows([]).errors.length > 0);
check("시청률 없고 바닥값도 아니면 오류", validateStbRows([row("10:00", "11:00", "가", null)]).errors.length > 0);
check("시청률 범위 초과는 오류", validateStbRows([row("10:00", "11:00", "가", 120)]).errors.length > 0);
check("시작 시각 역전은 오류", validateStbRows([row("10:00", "11:00", "가", 0.1), row("09:00", "09:30", "나", 0.1)]).errors.length > 0);
check("중간 줄의 끝이 시작보다 이르면 오류", validateStbRows([row("10:00", "09:00", "가", 0.1), row("11:00", "12:00", "나", 0.1)]).errors.length > 0);
check("앞 줄과 비면 경고(오류 아님)", (() => { const v = validateStbRows([row("06:00", "06:09", "가", 0.1), row("07:10", "08:00", "나", 0.1)]); return v.errors.length === 0 && v.warnings.length === 1; })());

// 날짜 추정: 시작 시각이 닐슨 편성과 가장 많이 맞는 날
const sched = new Map<string, number[]>([
  ["2026-11-11", [66 + 1440, 155, 202]],
  ["2026-11-12", [155, 202]],
]);
const sg = suggestCalendarDate(rows.slice(0, 3), ["2026-11-13", "2026-11-12", "2026-11-11"], sched);
check("11/12 로 추정(01시 구간은 전날 방송일 24시대와 대조)", sg?.date === "2026-11-12" && sg.matched === 3, JSON.stringify(sg));
check("맞는 날이 없으면 null", suggestCalendarDate(rows, ["2026-11-01"], new Map()) === null);

// 비전 모델 응답 해석(가짜 fetch — 네트워크 없이): 바닥값은 rating 비우고, 이름 끝 배지 글자는 걷어 낸다
async function mockExtract() {
  const realFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "test-key";
  let sentBody = "";
  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    sentBody = String(init?.body ?? "");
    const content = JSON.stringify({ rows: [
      { start: "03:22", end: "04:13", name: "금의야행 [재]", rating: 0, below_floor: true, is_rerun: true },
      { start: "05:02", end: "06:09", name: "엑스 더 리그", rating: 0.0002, below_floor: false, is_rerun: false },
    ] });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  }) as typeof fetch;
  try {
    const got = await extractStbRowsFromImage(Buffer.from("x"), "image/png");
    check("응답 해석: 바닥값은 rating null", got[0].rating === null && got[0].belowFloor === true);
    check("응답 해석: 이름 끝 배지 제거·재 표시 유지", got[0].name === "금의야행" && got[0].isRerun === true && got[1].isRerun === false);
    check("요청에 이미지(data URL)·strict 스키마 포함", sentBody.includes("data:image/png;base64,") && sentBody.includes("json_schema"));
  } finally {
    globalThis.fetch = realFetch;
  }
}

// 실제 그림 대조(선택)
async function live() {
await mockExtract();
const liveIdx = process.argv.indexOf("--live");
if (liveIdx >= 0) {
  const [imgPath, truthPath] = [process.argv[liveIdx + 1], process.argv[liveIdx + 2]];
  const got = await extractStbRowsFromImage(fs.readFileSync(imgPath), imageMimeOf(imgPath, "") ?? "image/png");
  const truth = (JSON.parse(fs.readFileSync(truthPath, "utf8")) as { rows: { start: string; end: string; name: string; rating?: number; belowFloor?: boolean }[] }).rows;
  check(`그림 인식 줄 수 일치(${got.length}/${truth.length})`, got.length === truth.length);
  let bad = 0;
  truth.forEach((t, i) => {
    const g = got[i];
    const tag = /<([본재])>/.exec(t.name)?.[1];
    const ok = g && g.start === t.start && g.end === t.end && g.name === stripBroadcastTag(t.name) && (t.belowFloor ? g.belowFloor : g.rating === t.rating) && g.isRerun === (tag === "재");
    if (!ok) {
      bad++;
      console.log("  불일치", i + 1, JSON.stringify(t), "←→", JSON.stringify(g));
    }
  });
  check(`그림 인식 값이 사람이 옮긴 값과 전부 일치(불일치 ${bad}줄)`, bad === 0);
}

}

live().then(() => {
if (failed > 0) {
  console.error(`\n${failed}개 실패`);
  process.exit(1);
}
console.log("\n모두 통과");
});
