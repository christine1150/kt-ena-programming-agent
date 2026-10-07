// MPP 포트폴리오 의사결정(단계 09) 테스트 — 테스트 프레임워크 없이 tsx로 실행. 운영 DB·네트워크에 접근하지 않는다.
// 실행: npm run test:portfolio
import fs from "node:fs";
import path from "node:path";

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  console.log(`${cond ? "✅" : "❌"} ${name}${!cond && detail ? ` — ${detail}` : ""}`);
}
const ROOT = path.resolve(__dirname, "..");

async function main() {
  const D = await import("../src/lib/audienceReport/portfolioDecisions");
  const PO = await import("../src/lib/audienceReport/portfolioPolicy");
  const FL = await import("../src/lib/audienceReport/portfolioFlatten");
    type Doc = import("../src/lib/audienceReport/portfolioModel").PortfolioReportDocument;
  type Item = import("../src/lib/audienceReport/portfolioModel").ChannelActionItem;
  type Acts = import("../src/lib/audienceReport/portfolioModel").ChannelActions;

  const period = { dateFrom: "2026-09-28", dateTo: "2026-10-04", label: "2026-09-28 ~ 2026-10-04" };
  const item = (code: string, kind: NonNullable<Item["kind"]>, subject: string | null, urgent: boolean): Item => ({
    channelCode: code, channelName: code, kind, subject, urgent, basis: `${subject ?? "채널"} 근거 문장`, suggestion: "제안 문장", verification: "다음 기간 추이 확인",
  });
  const acts = (code: string, items: Item[]): Acts => ({ channelCode: code, channelName: code, items, priorityScore: items.filter((i) => i.urgent).length });
  const actions: Acts[] = [
    acts("ENA", [item("ENA", "program_up", "예능A", false)]),
    acts("ENA_DRAMA", [item("ENA_DRAMA", "program_down", "드라마B", true), item("ENA_DRAMA", "daypart_weak", "20~23시", true)]),
    acts("ENA_PLAY", [item("ENA_PLAY", "daypart_weak", "14~17시", true)]),
    acts("OLIFE", [item("OLIFE", "program_down", "다큐C", true)]),
    acts("ONCE", [item("ONCE", "program_down", "예능D", true)]),
    acts("ENA_STORY", []),
  ];

  // ── 임원 핵심 결정 ──
  {
    const d = D.buildExecutiveDecisions(actions, { period });
    check("임원 결정은 최대 3건", d.length === 3);
    check("priorityScore가 큰 채널부터(ENA Drama 2건 > 나머지 1건), 같으면 원래 채널 순서", d.map((x) => x.channelCode).join() === "ENA_DRAMA,ENA_PLAY,OLIFE");
    check("입력 순서와 무관하게 priorityScore 내림차순이 먼저다(2026-09-18 사용자 지시)", D.buildExecutiveDecisions([...actions].reverse(), { period })[0].channelCode === "ENA_DRAMA");
    check("긴급 신호가 없는 채널(ENA 상승만, ENA Story 없음)은 올리지 않는다", !d.some((x) => x.channelCode === "ENA" || x.channelCode === "ENA_STORY"));
    check("채널마다 결정은 하나(첫 긴급 신호)이고 ENA Drama는 프로그램 하락이 먼저", d[0].content === "드라마B" && d[0].slot === null && d[1].slot === "14~17시");
    const x = d[0];
    check("결정이 어느 채널·콘텐츠·슬롯·언제·왜·대안·영향·확인 조건·제약을 담는다", !!(x.channelName && x.content && x.when.includes("2026-10-18") && x.why && x.alternatives.length >= 1 && x.impact && x.confirm && x.constraints.length >= 1));
    check("영향 크기를 지어내지 않고 편성안 화면의 모델상 기대로 확인하도록 안내", x.impact.includes("추정하지 않습니다") && x.impact.includes("검증 전"));
    check("제약에 Avail 미확인과 운영정책 미입력을 숨기지 않는다", x.constraints.some((c) => c.includes("Avail(권리) 미확인")) && x.constraints.some((c) => c.includes("운영정책 미입력")));
    check("각 결정이 채널 상세·편성안으로 이동하는 링크를 가진다", x.links.channel.startsWith("/channel/ENA_DRAMA?preset=custom&dateFrom=2026-09-28&dateTo=2026-10-04") && x.links.schedule.startsWith("/ideal-schedule?channel=ENA_DRAMA") && x.links.channel.includes(`from=${encodeURIComponent(x.actionId)}`));
    check("action_id는 portfolio: 접두 + 같은 입력이면 같은 값", /^portfolio:ENA_DRAMA:program_down:[0-9a-f]{8}$/.test(x.actionId) && D.buildExecutiveDecisions(actions, { period })[0].actionId === x.actionId);
    const text = JSON.stringify(d);
    check("평균 순위 하락만으로 역할 재편·교체를 권하지 않는다(역할 재편 문구 없음)", !/역할\s*재편|역할을 바꾸|채널 역할/.test(text));
    check("인과를 단정하지 않는다('때문에' 없음)", !text.includes("때문에"));
    check("긴급 신호가 하나도 없으면 결정을 만들지 않는다", D.buildExecutiveDecisions([acts("ENA", [item("ENA", "program_up", "A", false)])], { period }).length === 0);
    check("max 인자로 건수를 줄일 수 있다", D.buildExecutiveDecisions(actions, { period, max: 1 }).length === 1);
  }

  // ── 그룹 지표 ──
  {
    const peer = (name: string, trend: number | null) => ({ channelCode: name, channelName: name, level: 0.1, formattedLevel: "0.100", trend, reach: 1.2, targetRating: null, hourlyPattern: [], trendSeries: [] });
    const m = D.computeGroupMetric("A", [peer("ENA", 10), peer("ENA_PLAY", -4), peer("ENA_DRAMA", null)] as never);
    check("그룹 지표는 채널 추세의 단순평균이고 비교 기준 없는 채널을 빼며 이를 밝힌다", m.avgTrendPct === 3 && m.excludedChannels.join() === "ENA_DRAMA" && m.includedChannels.length === 2 && m.method.includes("단순평균") && m.method.includes("가중 없음"));
    check("그룹 지표에 Reach·시청률 합계 필드가 없다(도달 합산 금지)", !Object.keys(m).some((k) => /reach|sum|total/i.test(k)) && m.method.includes("합산하지 않음"));
    check("전 채널이 비교 기준이 없으면 평균을 만들지 않는다", D.computeGroupMetric("B", [peer("A", null)] as never).avgTrendPct === null);
  }

  // ── 파이프라인 ──
  {
    const edge = { canonicalName: "작품", relation: "rerun" as const, fromChannelCode: "ENA", fromChannelName: "ENA", fromRating: 0.4, toChannelCode: "ENA_PLAY", toChannelName: "ENA Play", toRating: 0.1, retentionPct: 25 };
    const v = D.pipelineView(edge);
    check("원 채널 대비 재방 시청률 비율로 부르고 시청자 유지율이 아님을 밝힌다", v.ratioLabel === "원 채널 대비 재방 시청률 비율" && v.caveats[0].includes("유지율이 아닙니다") && v.ratioText === "25.0%");
    check("중복 시청자 자료가 없으므로 유입·자기잠식은 가설이다", v.hypothesisOnly && v.caveats.some((c) => c.includes("가설")));
    check("비교 한계(회차·본재방·경과일·타깃 미정합)를 알린다", v.caveats.some((c) => c.includes("회차") && c.includes("정합")));
    check("비율이 없으면 —", D.pipelineView({ ...edge, retentionPct: null }).ratioText === "—");
  }

  // ── 슬롯 중복 ──
  {
    const rows = [
      { dow: 6, dowLabel: "토", hour: 21, canonicalName: "신병4", channelCodes: ["ENA", "ENA_PLAY"] },
      { dow: 1, dowLabel: "월", hour: 22, canonicalName: "다른작품", channelCodes: ["ENA", "ENA_DRAMA"] },
    ];
    const pipe = [{ canonicalName: "신병4", relation: "simulcast" as const, fromChannelCode: "ENA", fromChannelName: "ENA", fromRating: 0.2, toChannelCode: "ENA_PLAY", toChannelName: "ENA Play", toRating: 0.1, retentionPct: 50 }];
    const c = D.classifySlotOverlap(rows, pipe);
    check("등록된 동시방송 편성은 의도된 편성으로 구분", c[0].intent === "registered" && c[0].intentLabel.includes("의도된"));
    check("등록되지 않은 겹침은 오류로 단정하지 않고 확인 필요로(자동 제거 없음)", c[1].intent === "needs_check" && c[1].intentLabel.includes("자동으로 오류 처리하지 않음") && c.length === 2);
    check("작품 이름 표기 차이(공백)가 있어도 같은 작품으로 본다", D.classifySlotOverlap([{ ...rows[0], canonicalName: "신병 4" }], pipe)[0].intent === "registered");
  }

  // ── 집중도 ──
  {
    const r = D.computeConcentration("ENA", "ENA", [
      { canonicalName: "A", periodAvgRating: 0.4, periodAirCount: 5 },
      { canonicalName: "B", periodAvgRating: 0.2, periodAirCount: 5 },
      { canonicalName: "C", periodAvgRating: 0.1, periodAirCount: 5 },
      { canonicalName: "D", periodAvgRating: 0.1, periodAirCount: 5 },
      { canonicalName: "결측", periodAvgRating: null, periodAirCount: 3 },
    ]);
    check("집중도: 1위·상위3 비중(시청률×횟수 기준), 결측 프로그램은 제외", r?.programCount === 4 && r.top1Name === "A" && r.top1SharePct === 50 && r.top3SharePct === 87.5);
    check("프로그램 자료가 없으면(skyUHD 등) 만들지 않는다", D.computeConcentration("SKYUHD", "skyUHD", []) === null);
    check("집중도 방식이 방송 시간 가중이 아님을 밝힌다", D.CONCENTRATION_METHOD.includes("방송 시간 가중이 아님") && D.CONCENTRATION_METHOD.includes("위험 판정이 아닙니다"));
  }

  // ── skyUHD 커버리지 ──
  {
    const trend = Array.from({ length: 7 }, (_, i) => ({ date: `2026-09-${28 + i > 30 ? "0" + (28 + i - 30) : 28 + i}`, avgRating: 0.0017 })).map((t, i) => (i < 3 ? t : { ...t, date: `2026-10-0${i - 2}` }));
    const cov = D.buildSkyUhdCoverage({ trend, granularity: "daily", dateFrom: "2026-09-28", dateTo: "2026-10-04", programDays: 2, totalDays: 7 });
    check("skyUHD: 채널 집계 일수와 프로그램 상세·시간대 일수를 따로 센다", cov.channelDays?.total === 7 && cov.channelDays.present === 7 && cov.programDays.present === 2 && cov.programDays.total === 7);
    const withNull = D.buildSkyUhdCoverage({ trend: [{ date: "2026-10-01", avgRating: null }, { date: "2026-10-02", avgRating: 0 }], granularity: "daily", dateFrom: "2026-10-01", dateTo: "2026-10-02", programDays: 0, totalDays: 2 });
    check("결측은 수신 일수에 세지 않고 0은 값으로 센다", withNull.channelDays?.present === 1);
    check("일별 추이가 아니면 채널 집계 일수를 지어내지 않는다", D.buildSkyUhdCoverage({ trend, granularity: "weekly", dateFrom: "2026-09-28", dateTo: "2026-10-04", programDays: 2, totalDays: 7 }).channelDays === null);
  }

  // ── 채널 정책(유효기간) ──
  {
    const names = { ENA: "ENA" };
    const none = PO.buildChannelPolicyViews("2026-10-04", names);
    check("정책은 7채널 모두에 나오고 기본은 미설정이며 핵심 타깃은 그룹 정의에서 온다", none.length === 7 && none.every((p) => p.state === "unset" && p.role === null && p.validText.includes("미설정")) && none.find((p) => p.channelCode === "ENA")!.coreTarget === "수도권 2049" && none.find((p) => p.channelCode === "OLIFE")!.coreTarget === "전국 유료가구");
    const entries = [
      { channelCode: "ENA", role: "메인 브랜드", goal: "목표 문장", direction: "방향 문장", validFrom: "2026-10-01", validTo: "2026-12-31", source: "운영회의 10/1" },
      { channelCode: "ENA_PLAY", role: "예전 역할", validTo: "2026-09-30" },
      { channelCode: "ENA_DRAMA", role: "내년 역할", validFrom: "2027-01-01" },
    ];
    const v = PO.buildChannelPolicyViews("2026-10-04", names, entries);
    const by = (c: string) => v.find((p) => p.channelCode === c)!;
    check("유효기간 안의 정책은 내용을 쓴다", by("ENA").state === "active" && by("ENA").role === "메인 브랜드" && by("ENA").source === "운영회의 10/1");
    check("만료된 정책은 내용을 현재 판단에 쓰지 않고 만료로 알린다", by("ENA_PLAY").state === "expired" && by("ENA_PLAY").role === null && by("ENA_PLAY").validText.includes("만료"));
    check("시작 전 정책도 쓰지 않는다", by("ENA_DRAMA").state === "upcoming" && by("ENA_DRAMA").role === null);
    const two = PO.activePolicy([{ channelCode: "ENA", role: "옛", validFrom: "2026-01-01" }, { channelCode: "ENA", role: "새", validFrom: "2026-09-01" }], "ENA", "2026-10-04");
    check("유효한 정책이 둘이면 가장 최근에 시작한 것", two.entry?.role === "새");
  }

  // ── 문서(Word·PPT 공통 원본) ──
  {
    const peer = (code: string) => ({ channelCode: code, channelName: code, level: 0.1, formattedLevel: "0.100", trend: 5, reach: 1, targetRating: null, hourlyPattern: [], trendSeries: [] });
    const edge = { canonicalName: "작품", relation: "rerun" as const, fromChannelCode: "ENA", fromChannelName: "ENA", fromRating: 0.4, toChannelCode: "ENA_PLAY", toChannelName: "ENA Play", toRating: 0.1, retentionPct: 25 };
    const decisions = D.buildExecutiveDecisions(actions, { period });
    const doc = {
      period: { ...period, mode: "A", priorDateFrom: "", priorDateTo: "", comparisonLabel: null },
      deepCompare: { primeLabel: "평일 19~23시", holidays: [], rows: [], observations: [] },
      groupA: { code: "A", label: "수도권 2049", oneLiner: "A 한 줄", peers: [peer("ENA")], commonPattern: { direction: null, channelCodes: [], label: "" }, opportunities: [], pipeline: [edge] },
      groupB: { code: "B", label: "전국 유료가구", oneLiner: "B 한 줄", peers: [peer("ONCE")], commonPattern: { direction: null, channelCodes: [], label: "" }, opportunities: [], skyUhd: { genrePerformance: [], genreHourCrossing: [], programContribution: [], coverage: { totalDays: 7, daysWithProgramData: 2, coveragePct: 28.6 } } },
      slotOverlap: D.classifySlotOverlap([{ dow: 1, dowLabel: "월", hour: 22, canonicalName: "다른작품", channelCodes: ["ENA", "ENA_DRAMA"] }], [edge]),
      actionsByChannel: actions,
      isolationOk: true,
      aiSummary: null,
      executiveDecisions: decisions,
      channelPolicies: PO.buildChannelPolicyViews("2026-10-04", { ENA: "ENA" }),
      rights: null,
      concentration: [{ channelCode: "ENA", channelName: "ENA", programCount: 4, top1Name: "A", top1SharePct: 50, top3SharePct: 87.5 }],
      skyUhdCoverage: { channelDays: { present: 7, total: 7 }, programDays: { present: 2, total: 7 } },
    } as unknown as Doc;
    const flat = FL.flattenPortfolioReport(doc);
    const titles = flat.sections.map((s) => s.title);
    const all = JSON.stringify(flat);
    check("문서에 임원 핵심 결정이 가장 앞에 있다(제목이 ' — 요약'이라 PPT 앞머리 고정)", titles[0] === "임원 핵심 결정 — 요약" && /— 요약$/.test(titles[0]));
    // 단계 14: 슬라이드 계획은 reportSnapshot/deckPlan.ts — 표지 바로 뒤 첫 본문 장이 결정 요청이다(앞머리 고정 중복 없음)
    const SNAP = await import("../src/lib/reportSnapshot/build");
    const TPL = await import("../src/lib/reportSnapshot/template");
    const DECK = await import("../src/lib/reportSnapshot/deckPlan");
    const model = TPL.buildReportModel(SNAP.buildPortfolioSnapshot(doc, { generatedAt: "2026-10-07T00:00:00.000Z" }));
    const plan = DECK.planPortfolioDeck(model, doc).slides;
    check("PPT에서 표지 바로 뒤 첫 본문 장이 임원 결정 요청이다", plan[1].kind === "content" && (plan[1] as { title: string }).title.includes("결정 요청 3건"));
    check("파이프라인 표는 '유지율'이 아니라 '원 채널 대비 재방 시청률 비율'로 표기하고 한계를 덧붙인다", all.includes("원 채널 대비 재방 시청률 비율") && !/"유지율"/.test(all) && (all.includes("유지율이 아닙니다") || all.includes("유지율이 아님")));
    check("그룹 지표 정의와 가중 없음이 문서에 있다", all.includes("단순평균") && all.includes("합산하지 않음"));
    check("채널 정책(미설정)·집중도·권리 읽기 실패가 문서에 정직하게 나온다", all.includes("미설정(운영정책 입력 전)") && all.includes("집중도") && all.includes("확인하지 못함"));
    check("슬롯 중복 표에 구분 열이 있고 오류로 제거하지 않는다는 안내가 있다", all.includes("확인 필요") && (all.includes("오류로 제거하지 않으며") || all.includes("오류로 제거하지 않고") || all.includes("오류로 제거하지 않음")));
    check("skyUHD는 채널 집계와 프로그램 상세 일수를 따로 쓴다", all.includes("채널 집계 7/7일") && all.includes("프로그램 상세·시간대(수기 자료) 2/7일"));
    check("TOP 3 ACTIONS는 기존 priorityScore 정렬을 그대로 유지한다(ENA Drama가 첫 채널)", (() => { const sec = flat.sections.find((s) => s.title.startsWith("09"))!; const first = (sec.blocks.find((b) => b.kind === "bullets") as { items: string[] }).items[0]; return first.startsWith("[ENA_DRAMA]"); })());
    check("Group A와 B는 같은 표에 섞이지 않는다(02a/02b 분리 유지)", titles.includes("02a Peer 비교 — Group A") && titles.includes("02b Peer 비교 — Group B"));
  }

  // ── 정적 연결 검사 ──
  {
    const route = fs.readFileSync(path.join(ROOT, "src/app/api/actions/review/route.ts"), "utf8");
    check("검토 기록 API가 portfolio: 액션 ID를 받는다", route.includes("portfolio"));
    const builder = fs.readFileSync(path.join(ROOT, "src/lib/audienceReport/portfolioBuilder.ts"), "utf8");
    check("포트폴리오 빌더가 임원 결정·정책·권리·집중도·커버리지·지표 컨텍스트를 문서에 싣는다", ["executiveDecisions", "channelPolicies", "rights", "concentration", "skyUhdCoverage", "groupMetrics", "metricContext", "dataSnapshotId"].every((k) => builder.includes(k)));
    check("권리 읽기 실패가 보고서 생성을 막지 않는다(try/catch)", /try \{[\s\S]{0,200}loadAvailState[\s\S]{0,300}\} catch/.test(builder));
    check("그룹 합산·MPP 순도달 계산 코드가 없다", !/MPP\s*순도달|groupReach|sumReach/.test(builder));
  }

  console.log(`\n${passed}건 통과, ${failures.length}건 실패`);
  if (failures.length) {
    console.log("실패 목록:\n" + failures.map((f) => ` - ${f}`).join("\n"));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
