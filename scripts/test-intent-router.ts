// Intent Router 자동 테스트(스펙 13~15번). 원안은 "300개 이상"이었지만, 이번 슬라이스는
// 9개 Intent만 등록되어 있어 그에 맞는 규모(~50개, 같은 의미의 여러 표현 포함)로 시작한다
// (CLAUDE.md "최소부터 시작" 원칙 — Intent가 늘어나면 이 목록도 함께 늘린다).
// 실행: npm run test:intent (DB 조회 필요 — .env의 Supabase 값을 그대로 씀)
import { routeQuestion } from "../src/lib/intent/intentRouter";

interface TestCase {
  question: string;
  expectedIntentId: string | "UNSUPPORTED";
  expectedParams?: { channelCode?: string | null; targetLabel?: string | null; rankingLimit?: number | null };
}

const CASES: TestCase[] = [
  // PORTFOLIO_RANKING — 시간 표현/동의어 다양화
  { question: "어제 채널 중 가장 잘한 채널은?", expectedIntentId: "PORTFOLIO_RANKING" },
  { question: "전일 대비 가장 많이 상승한 채널은?", expectedIntentId: "PORTFOLIO_RANKING" },
  { question: "어제보다 가장 많이 오른 채널은?", expectedIntentId: "PORTFOLIO_RANKING" },
  { question: "전주 대비 가장 많이 상승한 채널은?", expectedIntentId: "PORTFOLIO_RANKING" },
  { question: "지난주보다 많이 하락한 채널은?", expectedIntentId: "PORTFOLIO_RANKING" },
  { question: "최근 4주 평균이 가장 높은 채널은?", expectedIntentId: "PORTFOLIO_RANKING" },
  { question: "오늘 채널 중 가장 부진한 채널은?", expectedIntentId: "PORTFOLIO_RANKING" },
  { question: "최근 12주 동안 가장 안정적인 채널은?", expectedIntentId: "PORTFOLIO_RANKING" },
  // PORTFOLIO_KPI_GAP
  { question: "각 채널 KPI 달성률을 보여줘.", expectedIntentId: "PORTFOLIO_KPI_GAP" },
  { question: "KPI 대비 가장 크게 부족한 채널은?", expectedIntentId: "PORTFOLIO_KPI_GAP" },
  { question: "목표 달성률이 가장 낮은 채널은?", expectedIntentId: "PORTFOLIO_KPI_GAP" },
  // PORTFOLIO_ALERT
  { question: "현재 우리 포트폴리오에서 가장 위험한 채널은?", expectedIntentId: "PORTFOLIO_ALERT" },
  { question: "즉시 편성 검토가 필요한 채널은?", expectedIntentId: "PORTFOLIO_ALERT" },
  { question: "가장 큰 Opportunity가 있는 채널은?", expectedIntentId: "PORTFOLIO_ALERT" },
  // CHANNEL_PERFORMANCE — 채널명 표기 다양화
  { question: "어제 ENA DRAMA는 어땠어?", expectedIntentId: "CHANNEL_PERFORMANCE", expectedParams: { channelCode: "ENA_DRAMA" } },
  { question: "어제 ENA Drama는 어땠어?", expectedIntentId: "CHANNEL_PERFORMANCE", expectedParams: { channelCode: "ENA_DRAMA" } },
  { question: "어제 ENA 드라마는 어땠어?", expectedIntentId: "CHANNEL_PERFORMANCE", expectedParams: { channelCode: "ENA_DRAMA" } },
  { question: "최근 7일 ENA PLAY 추이는?", expectedIntentId: "CHANNEL_PERFORMANCE", expectedParams: { channelCode: "ENA_PLAY" } },
  { question: "최근 4주 ENA Play 성과를 요약해줘.", expectedIntentId: "CHANNEL_PERFORMANCE", expectedParams: { channelCode: "ENA_PLAY" } },
  { question: "지난달 대비 OLIFE는 좋아졌나?", expectedIntentId: "CHANNEL_PERFORMANCE", expectedParams: { channelCode: "OLIFE" } },
  { question: "이번 주 ONCE 성과는?", expectedIntentId: "CHANNEL_PERFORMANCE", expectedParams: { channelCode: "ONCE" } },
  { question: "YTD 기준 ENA STORY 성과는?", expectedIntentId: "CHANNEL_PERFORMANCE", expectedParams: { channelCode: "ENA_STORY" } },
  // CHANNEL_DAYPART
  { question: "ENA DRAMA에서 가장 강한 시간대는?", expectedIntentId: "CHANNEL_DAYPART", expectedParams: { channelCode: "ENA_DRAMA" } },
  { question: "ONCE의 Golden Slot은?", expectedIntentId: "CHANNEL_DAYPART", expectedParams: { channelCode: "ONCE" } },
  { question: "OLIFE의 약세 시간대는?", expectedIntentId: "CHANNEL_DAYPART", expectedParams: { channelCode: "OLIFE" } },
  { question: "ENA PLAY 최약 시간대는?", expectedIntentId: "CHANNEL_DAYPART", expectedParams: { channelCode: "ENA_PLAY" } },
  // PROGRAM_TOP
  { question: "ENA DRAMA 프로그램 TOP 10?", expectedIntentId: "PROGRAM_TOP", expectedParams: { channelCode: "ENA_DRAMA", rankingLimit: 10 } },
  { question: "ONCE 상위 프로그램 알려줘", expectedIntentId: "PROGRAM_TOP", expectedParams: { channelCode: "ONCE" } },
  { question: "ENA 프로그램 TOP 5?", expectedIntentId: "PROGRAM_TOP", expectedParams: { channelCode: "ENA", rankingLimit: 5 } },
  // TARGET_AFFINITY — 타깃 표현 다양화
  { question: "ENA PLAY에서 가장 강한 연령대는?", expectedIntentId: "TARGET_AFFINITY", expectedParams: { channelCode: "ENA_PLAY" } },
  { question: "ENA의 2049 Affinity는?", expectedIntentId: "TARGET_AFFINITY", expectedParams: { channelCode: "ENA", targetLabel: "수도권 2049" } },
  { question: "ENA STORY의 여3049 친화도는?", expectedIntentId: "TARGET_AFFINITY", expectedParams: { channelCode: "ENA_STORY" } },
  { question: "ONCE의 5064 Affinity는?", expectedIntentId: "TARGET_AFFINITY", expectedParams: { channelCode: "ONCE", targetLabel: "전국 5064" } },
  // COMPETITIVE_POSITION
  { question: "어제 ENA PLAY와 경쟁채널 비교?", expectedIntentId: "COMPETITIVE_POSITION", expectedParams: { channelCode: "ENA_PLAY" } },
  { question: "경쟁채널 대비 ENA 순위는?", expectedIntentId: "COMPETITIVE_POSITION", expectedParams: { channelCode: "ENA" } },
  { question: "ONCE의 경쟁구도는?", expectedIntentId: "COMPETITIVE_POSITION", expectedParams: { channelCode: "ONCE" } },
  // COMPETITIVE_HEAD_TO_HEAD
  { question: "ENA DRAMA 동시간대 경쟁 프로그램은?", expectedIntentId: "COMPETITIVE_HEAD_TO_HEAD", expectedParams: { channelCode: "ENA_DRAMA" } },
  { question: "ONCE와 겹치는 경쟁 프로그램은?", expectedIntentId: "COMPETITIVE_HEAD_TO_HEAD", expectedParams: { channelCode: "ONCE" } },
  // SLOT_IMPROVEMENT_RECOMMENDATION(2026-08-26 추가) — CHANNEL_DAYPART(단순 조회)와 혼동하지
  // 않는지가 핵심이라, "개선/추천"이 들어간 문장이 CHANNEL_DAYPART로 새지 않는지도 함께 확인한다.
  { question: "ENA PLAY가 이번주 개선할 시간대는 어디야? 추천 프로그램은?", expectedIntentId: "SLOT_IMPROVEMENT_RECOMMENDATION", expectedParams: { channelCode: "ENA_PLAY" } },
  { question: "OLIFE 편성 중에 교체하면 좋을 시간대는?", expectedIntentId: "SLOT_IMPROVEMENT_RECOMMENDATION", expectedParams: { channelCode: "OLIFE" } },
  { question: "ENA DRAMA 약세 구간에 어떤 프로그램을 편성하면 좋을까?", expectedIntentId: "SLOT_IMPROVEMENT_RECOMMENDATION", expectedParams: { channelCode: "ENA_DRAMA" } },
  // UNSUPPORTED — 현재 등록 안 된 Macro(예: Audience Flow, Fatigue/Rerun, ROI 등)
  { question: "이 프로그램 뒤에 편성했을 때 성과가 좋은 프로그램은?", expectedIntentId: "UNSUPPORTED" },
  { question: "이 프로그램의 광고 ROI는 얼마야?", expectedIntentId: "UNSUPPORTED" },
  { question: "재방송 피로도가 가장 높은 프로그램은?", expectedIntentId: "UNSUPPORTED" },
  // 필수 파라미터 누락 → missing_required_parameter로 처리되어야 함(현재는 UNSUPPORTED로 통합 응답)
  { question: "가장 강한 시간대는?", expectedIntentId: "UNSUPPORTED" }, // 채널 미지정
];

async function main() {
  const referenceDate = "2026-08-19"; // 실데이터 백필 범위 안의 고정 기준일(재현 가능한 테스트를 위해)
  let pass = 0;
  const failures: string[] = [];

  for (const tc of CASES) {
    const result = await routeQuestion(tc.question, referenceDate);
    const actualIntentId = result.ok ? result.intent_id : "UNSUPPORTED";
    let ok = actualIntentId === tc.expectedIntentId;
    if (ok && result.ok && tc.expectedParams) {
      for (const [key, expected] of Object.entries(tc.expectedParams)) {
        const actual = (result.parameters as unknown as Record<string, unknown>)[key];
        if (actual !== expected) {
          ok = false;
          break;
        }
      }
    }
    if (ok) {
      pass++;
    } else {
      const gotParams = result.ok ? JSON.stringify(result.parameters) : JSON.stringify(result);
      failures.push(`✗ "${tc.question}" → expected ${tc.expectedIntentId}${tc.expectedParams ? ` ${JSON.stringify(tc.expectedParams)}` : ""}, got ${actualIntentId} ${gotParams}`);
    }
  }

  console.log(`\n${pass}/${CASES.length} 통과`);
  if (failures.length > 0) {
    console.log("\n실패 목록:");
    failures.forEach((f) => console.log(f));
    process.exitCode = 1;
  }
}

main();
