// 경쟁 채널 편성 자료(엑셀) 파서 테스트 — 합성 엑셀만 쓴다. 운영 DB·네트워크에 접근하지 않는다.
// 실행: npm run test:competitor-airings
import * as XLSX from "xlsx";
import { parseCompetitorAiringXlsx, standardTemplateBuffer, targetKey } from "../src/lib/competitorAirings/parse";
import { isCompetitorAiringChannel } from "../src/lib/competitorAirings/scope";

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`${cond ? "✅" : "❌"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}

const CTX = { registeredCompetitors: ["MBC every1", "tvN", "JTBC"], primaryTarget: "수도권 개인2049" };
const HEAD = ["경쟁채널", "방송일", "시작", "종료", "프로그램명", "회차", "구분", "시청률(%)", "타깃"];

function book(aoa: unknown[][], mutate?: (ws: XLSX.WorkSheet) => void): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  mutate?.(ws);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "편성");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
function ok(buf: Buffer) {
  const r = parseCompetitorAiringXlsx(buf, CTX);
  if (!r.ok) throw new Error(r.message);
  return r;
}

// ── 1. 표준 양식 ─────────────────────────────────────────
{
  const r = ok(standardTemplateBuffer(CTX.primaryTarget));
  check("표준 양식을 그대로 올리면 예시 줄 2개는 무시되고 반영 대상은 0건이다", r.rows.length === 0 && r.skippedExamples === 2 && r.rejected.length === 0);
}

// ── 2. 정상 행·시각·표기 통일 ─────────────────────────────
{
  const r = ok(
    book([
      HEAD,
      ["mbc every1", "2026-10-13", "21:30", "23:00", "라디오스타 <재>", 12, "", 1.23, "수도권 개인2049"],
      ["tvN", "2026/10/14", "00:30", "02:00", "유 퀴즈 온 더 블럭", "13회", "본방", "", "수도권 2049"],
      ["JTBC", "20261015", 2130, 2300, "냉장고를 부탁해", "", "재", "0.8", "수도권 남녀 2049"],
      ["MBC every1", "2026-10-16", "9시 5분", "", "아침 프로그램", "", "", "", ""],
    ])
  );
  check("4줄 모두 반영 대상이다", r.rows.length === 4 && r.rejected.length === 0, JSON.stringify(r.rejected));
  check("등록된 경쟁채널은 등록 표기로 통일된다(mbc every1 → MBC every1)", r.rows[0].competitorName === "MBC every1" && r.rows[0].registered);
  check("21:30~23:00 → 1290~1380분", r.rows[0].startMinute === 1290 && r.rows[0].endMinute === 1380);
  check("00:30 → 24:30(1470분), 종료 02:00 → 26:00(1560분)", r.rows[1].startMinute === 1470 && r.rows[1].endMinute === 1560);
  check("숫자로 적은 2130 → 1290분", r.rows[2].startMinute === 1290 && r.rows[2].endMinute === 1380);
  check("'9시 5분' → 545분, 종료 없음", r.rows[3].startMinute === 545 && r.rows[3].endMinute === null);
  check("8자리 날짜·슬래시 날짜를 읽는다", r.rows[2].broadcastDate === "2026-10-15" && r.rows[1].broadcastDate === "2026-10-14");
  check("<재> 태그로 재방 판정, 구분 열이 있으면 열이 우선", r.rows[0].isRerun === true && r.rows[1].isRerun === false && r.rows[2].isRerun === true && r.rows[3].isRerun === null);
  check("회차: 숫자·'13회' 모두 읽고 없으면 null", r.rows[0].episodeNo === 12 && r.rows[1].episodeNo === 13 && r.rows[2].episodeNo === null);
  check("시청률 빈 칸은 null(미래 편성/미집계)", r.rows[1].rating === null && r.rows[2].rating === 0.8);
  check("프로그램 키는 <재>·공백이 제거된다", r.rows[0].programKey === "라디오스타" && r.rows[1].programKey === "유퀴즈온더블럭", r.rows.map((x) => x.programKey).join(","));
  check("타깃 표기 차이(개인2049/2049/남녀 2049)는 같은 타깃으로 본다", r.rows.slice(0, 3).every((x) => x.targetLabel !== null) && r.targetAssumed === false);
}

// ── 3. % 서식 칸 ────────────────────────────────────────
{
  const r = ok(
    book([HEAD, ["tvN", "2026-10-13", "21:30", "", "프로그램", "", "", 0.0123, ""]], (ws) => {
      ws["H2"].z = "0.00%";
    })
  );
  check("엑셀 % 서식 칸(0.0123)은 1.23으로 읽는다", r.rows.length === 1 && r.rows[0].rating === 1.23, String(r.rows[0]?.rating));
}

// ── 4. 거부 사유 ─────────────────────────────────────────
{
  const r = ok(
    book([
      HEAD,
      ["tvN", "2026-13-40", "21:30", "", "날짜오류", "", "", "", ""],
      ["tvN", "2026-10-13", "31:00", "", "시각오류", "", "", "", ""],
      ["tvN", "2026-10-13", "21:30", "21:00", "종료오류", "", "", "", ""],
      ["tvN", "2026-10-13", "21:30", "", "시청률오류", "", "", 120, ""],
      ["tvN", "2026-10-13", "21:30", "", "타깃오류", "", "", "", "전국 2049"],
      ["tvN", "2026-10-13", "21:30", "", "구분오류", "", "다시보기", "", ""],
      ["tvN", "2026-10-13", "20:00", "", "중복", "", "", "", ""],
      ["tvN", "2026-10-13", "20:00", "", "중복 ", "", "", "", ""],
      ["", "2026-10-13", "20:00", "", "채널없음", "", "", "", ""],
    ])
  );
  check("잘못된 행은 사유와 함께 거부되고 나머지는 계속 처리된다", r.rows.length === 1 && r.rejected.length === 8, `rows=${r.rows.length} rejected=${r.rejected.length}`);
  const why = (n: number) => r.rejected.find((x) => x.rowNo === n)?.reason ?? "";
  check("날짜 오류 사유", why(2).includes("방송일"));
  check("시각 오류 사유", why(3).includes("시작 시각"));
  check("종료가 시작보다 빠른 경우 사유", why(4).includes("종료 시각"));
  check("시청률 범위 사유", why(5).includes("0~100"));
  check("지역이 다른 타깃(전국 2049)은 거부", why(6).includes("기준 타깃"));
  check("알 수 없는 구분 값은 거부", why(7).includes("본방/재방"));
  check("파일 안 중복은 먼저 나온 줄만 반영", why(9).includes("중복") && r.rows[0].programName === "중복");
  check("경쟁채널 빈 칸은 거부", why(10).includes("경쟁채널"));
}

// ── 5. 미등록 채널·헤더 오류 ─────────────────────────────
{
  const r = ok(book([HEAD, ["새채널", "2026-10-13", "21:30", "", "프로그램", "", "", "", ""]]));
  check("등록되지 않은 경쟁채널은 반영 대상에 오되 registered=false 로 구분된다", r.rows.length === 1 && r.rows[0].registered === false);
  const bad = parseCompetitorAiringXlsx(book([["이름", "값"], ["a", "b"]]), CTX);
  check("필수 열이 없으면 파일 전체를 거부하고 필요한 열을 알려 준다", !bad.ok && bad.message.includes("방송일"));
  const nocol = ok(book([["경쟁채널", "방송일", "시작", "프로그램명"], ["tvN", "2026-10-13", "21:30", "프로그램"]]));
  check("타깃 열이 없으면 기준 타깃으로 간주했다고 표시한다", nocol.targetAssumed && nocol.missingOptional.includes("타깃"));
  const shifted = ok(book([["경쟁 채널 편성 자료"], [], HEAD, ["tvN", "2026-10-13", "21:30", "", "프로그램", "", "", "", ""]]));
  check("제목 줄이 위에 있어도 열 이름 줄을 찾는다", shifted.rows.length === 1);
}

// ── 6. 보조 함수 ────────────────────────────────────────
check("타깃 키: 수도권 개인2049 = 수도권 남녀 2049 ≠ 전국 2049 ≠ 수도권 가구", targetKey("수도권 개인2049") === targetKey("수도권 남녀 2049") && targetKey("수도권 개인2049") !== targetKey("전국 2049") && targetKey("수도권 개인2049") !== targetKey("수도권 가구"));
check("채널 허용 목록: ENA_PLAY 만 켜져 있다", isCompetitorAiringChannel("ena_play") && !isCompetitorAiringChannel("ENA_DRAMA"));

console.log(`\n${failures.length === 0 ? "✅ 모두 통과" : "❌ 실패 있음"} — 통과 ${passed}건${failures.length ? `, 실패 ${failures.length}건` : ""}`);
if (failures.length) {
  for (const f of failures) console.log(` - ${f}`);
  process.exit(1);
}
