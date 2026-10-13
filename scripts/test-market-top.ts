// 1페이지 상위 프로그램 TOP 21 테스트 — 순수 함수만(DB·네트워크 없음). 실행: npm run test:markettop
import fs from "node:fs";
import path from "node:path";

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`${cond ? "✅" : "❌"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}

async function main() {
  const M = await import("../src/lib/dashboard/marketTopPrograms");
  type S = import("../src/lib/dashboard/marketTopPrograms").ProgramSample;
  const mk = (ch: string, rank: number, prog: string, start: string, target: S["target"], rating: number | null, own = false): S => ({ channelName: ch, own, channelRank: rank, programName: prog, startTime: start, target, rating });

  // 타깃 라벨 구분
  check("수도권 2049·개인2049·2049를 2049로", ["개인2049", "수도권 2049", "수도권 개인2049", "2049"].every((l) => M.classifyTargetLabel(l) === "p2049"));
  check("가구 라벨 구분", ["유료방송가구", "전국 유료가구", "National 유료방송가입가구"].every((l) => M.classifyTargetLabel(l) === "household"));
  check("2039·여자3049 등은 other", ["개인2039", "수도권 여3049", "전국 5064", "", null, undefined].every((l) => M.classifyTargetLabel(l as string) === "other"));

  // 이름·시각
  check("본/재 표시를 걷어낸다", M.cleanProgramName("<본> 놀라운 토요일 <재>") === "놀라운 토요일" && M.cleanProgramName("나  혼자   산다") === "나 혼자 산다");
  check("새벽 0·1시대는 24·25시로 표기", M.displayStartTime("00:35:00") === "24:35" && M.displayStartTime("01:05") === "25:05" && M.displayStartTime("21:10:00") === "21:10" && M.displayStartTime("02:00:00") === "02:00");
  check("잘못된 시각은 빈 문자열", M.displayStartTime("") === "" && M.displayStartTime(null) === "" && M.displayStartTime("abc") === "");

  // 선택·정렬
  const samples: S[] = [];
  const names = ["가", "나", "다", "라", "마", "바", "사", "아", "자", "차", "카", "타", "파", "하", "거", "너", "더", "러", "머", "버", "서", "어", "저", "처"];
  names.forEach((n, i) => {
    samples.push(mk("채널" + n, Math.min(i + 1, 20), "프로그램" + n, "21:00:00", "p2049", 1 - i * 0.05));
    samples.push(mk("채널" + n, Math.min(i + 1, 20), "프로그램" + n, "21:00:00", "household", 2 - i * 0.05));
  });
  const top = M.pickTopPrograms(samples);
  check("정확히 21개를 2049 시청률 내림차순으로", top.length === 21 && top.every((r, i) => i === 0 || top[i - 1].rating >= r.rating) && top[0].rank === 1 && top[20].rank === 21);
  check("프로그램명 앞의 채널명 중복을 걷고 괄호를 -로", M.displayProgramName("KBS1", "KBS1일일드라마(엄마가미쳤어요)") === "일일드라마-엄마가미쳤어요" && M.displayProgramName("MBC", "MBC일일드라마(가족관계증명서)") === "일일드라마-가족관계증명서");
  check("영문 채널명의 한글 표기도 중복으로 본다(닫는 괄호 없는 값 포함)", M.displayProgramName("TV CHOSUN", "TV조선스포츠축구(하나은행초청국가대표팀친선경기한국:우즈베키스탄") === "스포츠축구-하나은행초청국가대표팀친선경기한국:우즈베키스탄");
  check("겹치지 않는 이름은 그대로", M.displayProgramName("SBS", "틈만나면") === "틈만나면" && M.displayProgramName("tvN", "축구국가대표팀친선경기") === "축구국가대표팀친선경기" && M.displayProgramName("MBC", "MBC") === "MBC");
  check("괄호 속 가구 시청률이 같은 프로그램의 값이다", top[0].householdRating === 2 && top[3].householdRating === 2 - 3 * 0.05);
  check("1~20위 밖 채널은 제외", M.pickTopPrograms([mk("밖", 21, "높은 프로그램", "21:00", "p2049", 9), mk("안", 20, "낮은 프로그램", "21:00", "p2049", 0.1)]).map((r) => r.programName).join() === "낮은 프로그램");
  check("경계: 20위는 포함, 1위 미만(0)은 제외", M.pickTopPrograms([mk("a", 20, "x", "21:00", "p2049", 1)]).length === 1 && M.pickTopPrograms([mk("a", 0, "x", "21:00", "p2049", 1)]).length === 0);
  check("뉴스 프로그램은 순위 계산에서 빠지고 다음 프로그램이 채운다", (() => {
    const r = M.pickTopPrograms([mk("MBC", 3, "MBC뉴스데스크", "19:42", "p2049", 1.14), mk("SBS", 5, "SBS8뉴스", "19:48", "p2049", 0.84), mk("KBS1", 6, "KBS9시뉴스", "21:00", "p2049", 0.7), mk("JTBC", 4, "JTBC뉴스룸", "20:00", "p2049", 0.9), mk("SBS", 2, "틈만나면", "21:02", "p2049", 1.31)]);
    return r.length === 1 && r[0].programName === "틈만나면" && M.isNewsProgram("MBC뉴스데스크") && !M.isNewsProgram("PD수첩") && !M.isNewsProgram("틈만나면");
  })());
  check("2049 시청률이 없으면 가구만 있어도 제외", M.pickTopPrograms([mk("a", 3, "x", "21:00", "household", 5)]).length === 0 && M.pickTopPrograms([mk("a", 3, "x", "21:00", "p2049", null)]).length === 0);
  check("가구 값이 없으면 null(표시는 —)", M.pickTopPrograms([mk("a", 3, "x", "21:00", "p2049", 1)])[0].householdRating === null && M.formatRating(null) === "—");
  check("다른 타깃(other) 값은 섞이지 않는다", M.pickTopPrograms([mk("a", 3, "x", "21:00", "other", 9), mk("a", 3, "x", "21:00", "p2049", 1)])[0].rating === 1);
  const tie = M.pickTopPrograms([mk("뒤", 9, "프로그램", "21:00", "p2049", 1), mk("앞", 2, "프로그램", "21:00", "p2049", 1)]);
  check("같은 시청률이면 채널 순위가 높은 쪽이 먼저", tie[0].channelName === "앞");
  const dup = M.pickTopPrograms([mk("a", 3, "<본>x", "21:00:00", "p2049", 1), mk("a", 3, "x", "21:00", "p2049", 1)]);
  check("본/재 표시만 다른 같은 편성은 한 줄", dup.length === 1);
  check("같은 프로그램이 다른 시각에 두 번이면 두 줄", M.pickTopPrograms([mk("a", 3, "x", "10:00", "p2049", 1), mk("a", 3, "x", "21:00", "p2049", 0.9)]).length === 2);
  check("시청률 0도 후보(0은 실측값)", M.pickTopPrograms([mk("a", 3, "x", "21:00", "p2049", 0)]).length === 1);
  check("자사 표시를 유지한다", M.pickTopPrograms([mk("ENA", 2, "x", "21:00", "p2049", 1, true)])[0].own === true);
  check("limit 조정과 빈 입력", M.pickTopPrograms(samples, 3).length === 3 && M.pickTopPrograms([]).length === 0 && M.pickTopPrograms(samples, 0).length === 0);
  check("시청률 표기 소수 셋째 자리", M.formatRating(0.8321) === "0.832" && M.formatRating(12) === "12.000");

  // 소스 정적 검사
  const ROOT = path.resolve(__dirname, "..");
  const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8").replace(/\r\n/g, "\n");
  const route = read("src/app/api/dashboard/top-programs/route.ts");
  check("API: 로그인 필요·날짜 검증·원문 오류 비노출", route.includes("getCurrentSession") && route.includes("401") && route.includes("YYYY-MM-DD") && route.includes("상위 프로그램을 불러오지 못했습니다.") && !route.includes("message: e.message"));
  check("API: 개인2049 순위 1~20위 채널만(자사·경쟁채널 모두)", route.includes(".lte(\"rank\", CHANNEL_RANK_LIMIT)") && (route.match(/lte\("rank", CHANNEL_RANK_LIMIT\)/g) ?? []).length === 2 && route.includes("competitor_ratings") && route.includes("competitor_program_target_ratings"));
  const comp = read("src/components/home/MarketTopPrograms.tsx");
  check("화면: 3단 그리드와 괄호 가구 표기", comp.includes("md:grid-cols-3") && comp.includes("({formatRating(r.householdRating)}"));
  check("화면: 로딩·오류·빈 상태·이전 날짜 흐림이 모두 있다", comp.includes("Skeleton") && comp.includes('role="alert"') && comp.includes("순위 1~20위 채널 중") && comp.includes("!f.isCurrent"));
  check("화면: 자료 범위(몇 개 채널 기준)와 가구 기준을 밝힌다", comp.includes("프로그램 단위 시청률 자료가 있는 채널") && comp.includes("KBS1·MBC·SBS만 수도권"));
  const dash = read("src/app/Dashboard.tsx");
  check("홈: 오늘의 시청률 카드 안쪽 맨 아래에 이어 붙는다", dash.includes("footer={<MarketTopPrograms") && dash.includes("{footer && <div"));
  check("프로그램명은 잘리지 않고 한 줄에 맞춰 글씨만 줄어든다(말줄임·줄 수 제한 없음)", comp.includes("<FitOneLine text={`${displayProgramName(") && comp.includes("scale(") && comp.includes("whitespace-nowrap") && !/truncate|line-clamp|text-ellipsis/.test(comp));
  check("별도 제목 없이 정보만(제목 문구 없음)", !comp.includes("오늘의 상위 프로그램") && !comp.includes("<h2"));
  check("낮은 높이: 한 줄 행(py 4~7px)과 3단", /py-\[[4-7]px\]/.test(comp) && comp.includes("md:grid-cols-3"));
  // (순위 막대는 간소화로 제거했다)

  // ── 가구 값의 지역 예외(단계 16 H1): 닐슨 A3 "KBS1, MBC, SBS는 수도권 기준"을 보존·표시 ──
  const R = await import("../src/lib/competitorRegion");
  const A3_ENA = "■ 개인2049(수도권) / 개인2039(수도권) / 유료방송가입가구(National)-KBS1, MBC, SBS는 수도권 기준";
  check("A3 문구에서 수도권 기준 채널을 읽는다(KBS1·MBC·SBS)", JSON.stringify(R.parseRegionExceptions(A3_ENA)) === JSON.stringify(["KBS1", "MBC", "SBS"]));
  check("예외가 없는 시트 문구는 빈 목록", R.parseRegionExceptions("■ 개인2049(수도권) / 여자3049(수도권) / 유료방송가입가구(National)").length === 0 && R.parseRegionExceptions("").length === 0 && R.parseRegionExceptions(undefined as unknown as string).length === 0);
  check("regionNoteFor: 예외가 있을 때만 원문과 함께 돌려준다", R.regionNoteFor("ENA경쟁채널시청률", A3_ENA)?.note === A3_ENA && R.regionNoteFor("ENA경쟁채널시청률", A3_ENA)?.regionalChannels.length === 3 && R.regionNoteFor("ENA PLAY경쟁채널시청률", "■ 개인2049(수도권)") === null);
  check("파일에서 읽은 목록이 마지막 확인 목록보다 우선한다", R.isRegionalHousehold("KBS2", ["KBS2"]) && !R.isRegionalHousehold("KBS1", ["KBS2"]) && R.isRegionalHousehold("kbs1") && R.isRegionalHousehold("MBC") && !R.isRegionalHousehold("MBC every1") && !R.isRegionalHousehold("tvN") && !R.isRegionalHousehold("KBS2"));
  const regional = M.pickTopPrograms([
    mk("SBS", 1, "정글", "21:00", "p2049", 1.2), mk("SBS", 1, "정글", "21:00", "household", 3.1),
    mk("tvN", 2, "응답", "20:00", "p2049", 1.1), mk("tvN", 2, "응답", "20:00", "household", 2.9),
    mk("ENA", 3, "자체", "22:00", "p2049", 0.9, true), mk("ENA", 3, "자체", "22:00", "household", 1.5, true),
    mk("MBC", 4, "가구없음", "19:00", "p2049", 0.8),
  ]);
  const flag = (n: string) => regional.find((r) => r.channelName === n)?.householdRegional;
  check("상위 프로그램: 수도권 기준 채널의 가구 값에만 표시(SBS), 전국 채널·자사·가구 값 없는 행은 아님", flag("SBS") === true && flag("tvN") === false && flag("ENA") === false && flag("MBC") === false);
  const dashSrc = read("src/app/Dashboard.tsx");
  check("홈 AI 대체 편성: 채널마다 따로 요청해(한 요청에 7개를 몰지 않음) 서버 제한 60초를 넘겨 전부 '계산하지 못했습니다'가 되지 않는다", dashSrc.includes("channels=${encodeURIComponent(code)}") && !dashSrc.includes("channels=${encodeURIComponent(cs)}") && dashSrc.includes("for (const code of cs.split(\",\"))"));
  const purchasePage = read("src/app/ideal-schedule/purchase/page.tsx");
  check("구매 검토: 같은 시간대 경쟁 목록도 가구 타깃일 때 수도권 기준 채널에 별표·주의 문구(예측값은 채널 내 지수라 영향 없음)", purchasePage.includes("t.target === \"HH\" && isRegionalHousehold(c.ch)") && purchasePage.includes("수도권 기준 가구 시청률 — 다른 채널은 전국") && purchasePage.includes("competitorRegion"));
  check("화면: 수도권 기준 가구 값에 별표와 고정 주의 문구, 문구의 근거는 파서가 보존한 A3", comp.includes("householdRegional") && comp.includes("REGIONAL_HOUSEHOLD_CAUTION") && R.REGIONAL_HOUSEHOLD_CAUTION.includes("수도권 기준") && read("src/lib/nielsenDaily.ts").includes("regionNoteFor(sheetName, rows[2]?.[0])") && read("src/lib/nielsenDaily.ts").includes("competitorRegionNotes"));

  console.log(`\n통과 ${passed} / 실패 ${failures.length}`);
  if (failures.length) {
    console.error("\n실패 목록:\n" + failures.map((f) => ` - ${f}`).join("\n"));
    process.exit(1);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
