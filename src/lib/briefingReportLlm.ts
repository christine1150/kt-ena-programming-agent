// Tier 1 확장(2026-08-26, 사용자 지시: "규칙을 안 어겨도 되는 확장 모두 적용") — Page 2
// "오늘의 브리핑"(ChannelDeepDive.tsx buildBriefingReport, 단일 일자 모드)도 채널별 인사이트와
// 같은 문제 — 개별 계산된 문장을 그냥 이어붙인다. 같은 입력값을 그대로 LLM에 주고 한 문단으로
// 종합한다(새 숫자 계산 없음). 기간(범위) 조회 모드는 대상에서 뺐다 — 그쪽은 baseline 개념이
// 완전히 달라 별도 설계가 필요해 이번 Tier 1 범위에서는 규칙 기반을 그대로 둔다.
import { callOpenAiJsonSynthesis, LLM_SYNTHESIS_GUARDRAIL } from "./llmSynthesis";

export interface BriefingLlmInput {
  channelName: string;
  refLabel: string; // "오늘"/"어제" 등
  currentRating: number | null;
  enaLeadSentence: string | null; // ENA만 — 그대로 맨 앞에 유지
  rating_delta_pct: number | null;
  baseline_avg_rating: number | null; // 최근 12주 평균
  dow_baseline_avg_rating: number | null;
  today_peak_hour: number | null;
  today_peak_rating: number | null;
  today_peak_program_name: string | null;
  today_peak_program_rating: number | null;
  baseline_peak_hour: number | null;
  baseline_peak_rating: number | null;
  // 피크 시간대 등락률(미리 계산해 둔 값) — 모델이 직접 나눗셈을 하지 않게 하려는 필드다.
  today_peak_vs_baseline_peak_pct: number | null;
  top_program_name: string | null;
  top_program_rating: number | null;
  top_program_start_time: string | null;
  top_program_baseline_avg: number | null;
  top_program_baseline_days: number | null;
  demographics: { label: string; today: number | null; baseline_avg: number | null; delta_pct: number | null }[] | null;
  // 사용자 지시(2026-09-02, SDoW): baseline_avg_rating/top_program_baseline_avg가 실제로 무엇
  // 대비인지 프롬프트에 정확히 알려주기 위한 라벨 — SDoW 활성화 시 route.ts가 이미 두 값 모두
  // "선택 요일의 최근 N주 평균"으로 계산해 보내주므로(같은 N주), 문구도 이 라벨 하나로 통일한다.
  // 없으면(기존 호출부) 기존 "최근 12주"/"최근 8주" 문구를 그대로 쓴다(하위호환).
  baselineLabel?: string;
  // 사용자 지시(2026-09-22): "가구 시청률 1% 초과 예외" — ENA/ENA Play/ENA Drama는 평소
  // 2049만 보지만, 오늘 채널 단위 가구 시청률(전국 유료가구)이 1%를 넘거나 시청시간이 길어
  // route.ts가 예외를 발동시켰을 때만 값이 들어온다(그 외엔 null — 언급하지 마라).
  groupAHouseholdException: number | null;
  // ── 2026-09-23 추가(route.ts가 이미 조회해 두고 브리핑에만 안 넘기던 값들) ──
  today_rank: number | null;
  baseline_avg_rank: number | null;
  today_share: number | null;
  baseline_avg_share: number | null;
  decline_program_name: string | null;
  decline_program_rating: number | null;
  decline_program_start_time: string | null;
  decline_program_baseline_avg: number | null;
  decline_program_baseline_days: number | null;
  decline_program_delta_pct: number | null;
  target_rank: string | null;
  target_achievement_pct: number | null;
  same_weekday_avg_rating: number | null;
  same_weekday_sample_days: number | null;
  prime_label: string; // 예: "평일 19~23시"
  prime_today_avg_rating: number | null;
  prime_baseline_avg_rating: number | null;
  today_time_spent_minutes: number | null;
  today_share_pct: number | null;
  // ── 2026-09-23 후속 추가 — "프라임타임이 정확히 어떤 콘텐츠 때문에 올랐는지/내렸는지" ──
  // 프라임 구간 평균만으로는 원인 콘텐츠를 지목할 수 없어, 그 구간에 실제로 편성돼 있던
  // 프로그램을 함께 넘긴다(route.ts가 이미 조회한 당일 목록에서 계산, 새 쿼리 없음).
  // 최고·최저를 둘 다 주면 모델이 하락한 날에도 최고 프로그램을 인용해 근거와 시사점이 서로
  // 다른 프로그램을 가리키는 일이 생겨(브라우저 검증 2026-09-23), 등락 방향에 맞는 한 건만
  // 골라서 넘긴다 — 오른 날은 최고, 내린 날은 최저.
  prime_focus_program_name: string | null;
  prime_focus_program_rating: number | null;
  prime_focus_program_start_time: string | null;
}

/**
 * 사용자 지시(2026-09-23): "짧아진 것은 좋지만 어떤 내용이 서로 연결되는지 모르겠음. 하루에
 * 대한 브리핑이 핵심 위주로 정리되어야 함."
 *
 * 평평한 문자열 배열(facts[])을 버리고 BLUF(Bottom Line Up Front) 구조로 바꾼다 — 업계
 * 리포트(Nielsen 주간 랭킹, Barb Viewing Summary, 방송사 오버나이트 리포트)와 대시보드 설계
 * 정설이 공통으로 쓰는 "헤드라인 1개 + 그것을 뒷받침하는 근거" 위계다. 동급 사실을 나열하면
 * 읽는 사람이 무엇이 무엇의 근거인지 알 수 없다는 것이 사용자가 지적한 문제의 핵심이었다.
 */
export interface BriefingReport {
  /** 오늘 하루를 한 문장으로 규정한 결론. 반드시 수치 근거 1개를 포함한다. */
  headline: string;
  /** 헤드라인의 방향 — 화면에서 색·아이콘을 고르는 데만 쓴다. */
  verdict: "up" | "down" | "flat";
  // 근거(drivers/audience)와 시사점(implications)은 의도적으로 LLM 출력에서 뺐다 — 2026-09-23
  // 브라우저 검증에서 모델이 (1) 비교 기준이 없는 프로그램에 등락률을 지어내고, (2) 프라임
  // 등락률을 프로그램 항목에 "슬롯 평균 ▲174%"로 옮겨 붙이며, (3) 시사점 형식을 고정하자
  // 존재하지 않는 비교값(▲153.8%)을 만들어 내는 것을 반복 확인했다. 프롬프트로는 막히지 않아
  // LLM의 역할을 "헤드라인 한 줄"로 좁혔고, 수치가 들어가는 나머지는 ChannelDeepDive.tsx가
  // 검증된 값만으로 직접 조립한다(CLAUDE.md: 계산은 DB/코드가 전담, LLM은 해석만).
}

// 사용자 지시(2026-09-23): "짧아진 것은 좋지만 어떤 내용이 서로 연결되는지 모르겠음" —
// 2026-09-22에 줄글을 짧은 사실 배열로 바꿨더니 이번엔 숫자가 평평하게 나열되기만 해서 그날의
// 이야기가 안 보인다는 지적을 받았다. 그래서 출력 형식을 "헤드라인 1 + 근거 2갈래 + 시사점"
// 위계로 바꾼다. 짧게 쓰는 규칙은 그대로 유지하되, 각 항목이 헤드라인에 종속되도록 만든다.
function buildSystemPrompt(baselineLabel: string): string {
  return [
    "너는 KT ENA 편성 PD를 위한 Page 2 '오늘의 브리핑'의 헤드라인 작성기다.",
    "화면의 근거 항목과 시사점은 이미 시스템이 검증된 수치로 만들어 두었다. 너는 그 위에 얹힐 '오늘 이 채널은 무슨 날이었나'라는 결론 한 줄만 쓴다.",
    "",
    "[headline] 오늘 하루를 규정하는 한 문장(공백 포함 34자 이내 — 화면에서 제목 옆 한 줄에 들어가야 한다). 반드시 (1) 판정과 (2) 그 판정의 근거 수치 1개를 함께 담아라.",
    `  예: "프라임 강세로 ${baselineLabel} 대비 ▲12% 반등" / "'신병4' 부진이 끌어내린 날 ▼51.6%" / "시청률은 빠졌지만 점유율은 방어"`,
    "  판정 근거가 여러 개면 가장 크게 움직인 것 하나만 헤드라인에 쓰고 나머지는 아래로 내려라.",
    '  같은 수치를 한 문장에 두 번 쓰지 마라 — "시청률 ▼84%로 최근 12주 평균 대비 ▼84%"처럼 반복되면 안 된다(실측 사례).',
    "[verdict] headline의 방향: 상승/호조면 up, 하락/부진이면 down, 평소 수준이면 flat.",
    "근거 항목·시사점·조치 제안은 네가 쓰지 않는다 — headline과 verdict 두 개만 채워라.",
    "",
    `가장 중요한 규칙: baseline(비교 기준) 수치를 언급할 땐 반드시 정확히 "${baselineLabel}"라는 표현만 써라. "최근 12주 평균"이나 "최근 8주 평균" 같은 다른 기간을 절대 쓰지 마라 — ${baselineLabel}가 실제로 이번 계산에 쓰인 기준이다.`,
    "enaLeadSentence는 '주요 콘텐츠 관리'에 등록된 오리지널·독점 콘텐츠의 당일 본방 성적이다 — 그날의 성패가 이 콘텐츠로 갈렸다면 headline에 그 프로그램명을 써라.",
    "decline_program_* 값이 있고 하락이 그날의 지배적 사건이면 headline에 그 프로그램명을 써라.",
    "시청률은 빠졌는데 점유율(today_share vs baseline_avg_share)이나 순위(today_rank vs baseline_avg_rank)가 유지·상승했다면 '시장 전체가 빠진 날'이라는 뜻이므로 headline에서 그 대비를 살려 써라 — 두 값이 실제로 그 방향일 때만 쓴다.",
    "same_weekday_avg_rating이 있으면 그 요일 기준 비교를 우선한다(편성은 날짜가 아니라 요일에 묶이므로 요일 통제된 비교가 더 정확하다). same_weekday_sample_days가 3 미만이면 표본이 적으므로 쓰지 마라.",
    "target_rank / target_achievement_pct는 원인이 아니라 결과다 — headline에 쓰지 마라.",
    "절대 규칙: 등락률(▲/▼ %)은 입력에 이미 들어 있는 퍼센트 값(rating_delta_pct, decline_program_delta_pct, today_peak_vs_baseline_peak_pct, demographics의 delta_pct 등)만 쓸 수 있다. 두 숫자를 네가 나눠서 새 퍼센트를 만들지 마라 — 계산은 이 시스템의 DB와 코드가 전담한다. 쓸 퍼센트가 없으면 시청률 값만 쓰고 등락률은 생략해라.",
    // 실측(2026-09-23): 입력값 4.82를 모델이 "4.821%"로 한 자리 늘려 쓰는 사례가 나왔다.
    // 가구 시청률은 화면에서 직접 렌더하므로(ChannelDeepDive.tsx) 모델은 아예 쓰지 않게 한다.
    "가구 시청률은 어떤 경우에도 언급하지 마라(화면이 따로 표시한다). groupAHouseholdException 값이 있어도 무시해라.",
    `다시 한번: baseline 관련 수치의 기준을 언급할 땐 반드시 "${baselineLabel}"라고만 표현해라(다른 기간을 지어내지 마라).`,
    LLM_SYNTHESIS_GUARDRAIL,
  ].join("\n");
}

const SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string" },
    verdict: { type: "string", enum: ["up", "down", "flat"] },
  },
  required: ["headline", "verdict"],
  additionalProperties: false,
};

export async function buildBriefingReportViaLlm(input: BriefingLlmInput): Promise<BriefingReport | null> {
  const baselineLabel = input.baselineLabel ?? "최근 12주 평균";
  // 사용자 지시(2026-09-02, SDoW): baselineLabel 문구 준수가 중요해(실측 중 기본 온도에서
  // gpt-4o-mini가 가끔 "최근 12주 평균" 관용구를 그대로 재현하는 것을 발견) 이 호출만 온도를
  // 낮춰 지시 준수를 높인다(다른 서술 job들의 기본값 0.3은 그대로 둠).
  const result = await callOpenAiJsonSynthesis<BriefingReport>(buildSystemPrompt(baselineLabel), input, "briefing_report", SCHEMA, {
    temperature: 0.1,
  });
  const headline = result?.headline?.trim() ?? "";
  // 헤드라인이 없으면 구조 자체가 성립하지 않으므로 규칙 기반 폴백으로 넘긴다.
  if (!headline) return null;
  // 마지막 방어선(2026-09-23, 브라우저 검증에서 반복 확인) — 프롬프트로 아무리 금지해도 모델이
  // 비교 기준이 없는 등락률을 지어내는 일이 남는다. 입력에 실제로 들어 있는(또는 입력값끼리의
  // 정당한 비교로 나오는) 퍼센트가 아니면 헤드라인을 버리고 규칙 기반 헤드라인을 쓰게 한다.
  const pctOf = (today: number | null, base: number | null): number | null =>
    today !== null && base !== null && base > 0 ? ((today - base) / base) * 100 : null;
  const allowedPcts = [
    input.rating_delta_pct,
    input.decline_program_delta_pct,
    input.today_peak_vs_baseline_peak_pct,
    pctOf(input.prime_today_avg_rating, input.prime_baseline_avg_rating),
    pctOf(input.today_share, input.baseline_avg_share),
    pctOf(input.currentRating, input.same_weekday_avg_rating),
    pctOf(input.currentRating, input.baseline_avg_rating),
    pctOf(input.currentRating, input.dow_baseline_avg_rating),
    pctOf(input.top_program_rating, input.top_program_baseline_avg),
    ...(input.demographics ?? []).map((d) => d.delta_pct),
  ]
    .filter((v): v is number => v !== null && Number.isFinite(v))
    .map((v) => Math.abs(v));
  const tokens = headline.match(/[▲▼]\s?\d+(?:,\d{3})*(?:\.\d+)?%/g) ?? [];
  // 표기 반올림(소수 1자리 -> 정수) 때문에 1.5%p까지는 같은 값으로 본다.
  const everyPctIsKnown = tokens.every((t) => {
    const n = Number(t.replace(/[▲▼\s%,]/g, ""));
    return allowedPcts.some((a) => Math.abs(a - n) <= 1.5);
  });
  if (!everyPctIsKnown) return null;
  return {
    headline,
    verdict: result?.verdict === "up" || result?.verdict === "down" ? result.verdict : "flat",
  };
}
