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
  /** 편성·콘텐츠 근거(좌단, 최대 3개) — 화면에 라벨은 붙이지 않는다. */
  drivers: string[];
  /** 시청자 근거(우단, 최대 2개) — 화면에 라벨은 붙이지 않는다. */
  audience: string[];
  /**
   * 시사점 — 사용자 지시(2026-09-23 후속): "시사점이라기보다는 그냥 성과를 나열했다".
   * 성과 재진술이 아니라 (1) 원인 해석과 (2) 편성 관점의 다음 조치가 함께 들어가야 하며,
   * 그럴 근거가 없으면 null로 두고 화면에서 그 줄을 통째로 생략한다.
   */
  implication: string | null;
}

// 사용자 지시(2026-09-23): "짧아진 것은 좋지만 어떤 내용이 서로 연결되는지 모르겠음" —
// 2026-09-22에 줄글을 짧은 사실 배열로 바꿨더니 이번엔 숫자가 평평하게 나열되기만 해서 그날의
// 이야기가 안 보인다는 지적을 받았다. 그래서 출력 형식을 "헤드라인 1 + 근거 2갈래 + 시사점"
// 위계로 바꾼다. 짧게 쓰는 규칙은 그대로 유지하되, 각 항목이 헤드라인에 종속되도록 만든다.
function buildSystemPrompt(baselineLabel: string): string {
  return [
    "너는 KT ENA 편성 PD를 위한 Page 2 '오늘의 브리핑' 작성기다.",
    "가장 중요한 원칙: 사실을 평평하게 나열하지 마라. '오늘 이 채널은 무슨 날이었나'라는 결론(headline) 하나를 먼저 정하고, 나머지 항목은 전부 그 결론을 뒷받침하는 근거로만 써라.",
    "",
    "[headline] 오늘 하루를 규정하는 한 문장(공백 포함 34자 이내 — 화면에서 제목 옆 한 줄에 들어가야 한다). 반드시 (1) 판정과 (2) 그 판정의 근거 수치 1개를 함께 담아라.",
    `  예: "프라임 강세로 ${baselineLabel} 대비 ▲12% 반등" / "'신병4' 부진이 끌어내린 날 ▼51.6%" / "시청률은 빠졌지만 점유율은 방어"`,
    "  판정 근거가 여러 개면 가장 크게 움직인 것 하나만 헤드라인에 쓰고 나머지는 아래로 내려라.",
    "[verdict] headline의 방향: 상승/호조면 up, 하락/부진이면 down, 평소 수준이면 flat.",
    "[drivers] 편성·콘텐츠 근거 최대 3개(3개를 넘기지 마라 — 화면이 길어진다). 각 항목에 프로그램명이나 편성 시각이 반드시 들어가야 한다.",
    "[audience] 시청자 근거 최대 2개(2개를 넘기지 마라) — 연령대 이동·점유율·시청시간·가구 시청률만.",
    "[implication] 시사점 한 줄(공백 포함 50자 이내).",
    "  성과를 다시 말하는 문장은 시사점이 아니다 — '목표 대비 13.1%로 저조한 성과', '전반적으로 부진했다' 같은 문장은 절대 쓰지 마라.",
    "  반드시 (1) 위 근거에서 읽어낸 원인·구조 해석과 (2) 편성 담당자가 다음에 확인하거나 조정할 것을 한 문장에 담아라.",
    '  좋은 예: "피크가 새벽 02시에 몰려 프라임 편성 경쟁력 점검 필요" / "간판 드라마 본방 부진 — 동일 슬롯 경쟁 편성 확인 필요" / "시청률 하락에도 점유율 유지 — 시장 전체 위축으로 보임"',
    "  반드시 구체적인 대상이 들어가야 한다 — 프로그램명, 편성 시각·슬롯, 연령대 중 최소 하나.",
    "  '콘텐츠 강화 필요', '지속적인 관리 필요', '모니터링 필요', '전반적인 점검 필요'처럼 무엇을 할지 말하지 않는 상투어는 프로그램명을 붙이더라도 금지한다. 대신 편성으로 실행 가능한 것을 써라 — 슬롯 유지·이동·교체, 동일 시간대 경쟁 편성 확인, 특정 연령대 이탈 점검 등.",
    "  이 두 가지를 근거 있게 쓸 수 없으면 null로 비워라(억지 문장보다 빈 칸이 낫다).",
    "",
    "drivers·audience의 각 항목은 숫자나 프로그램명으로 시작하고 20자 안팎으로 끊는다. 서술어(~습니다, ~했습니다, ~보였습니다)를 쓰지 마라. headline과 implication만 자연스러운 한 문장으로 쓴다.",
    '항목 예시: "\'황금어장라디오스타\' 0.071 (14시, 슬롯 평균 ▲45%)" / "프라임 19~23시 0.012 (평소 0.031 대비 ▼61%)" / "여20대 ▼89.5% · 남40대 ▼80.2%" / "점유율 0.42% (평소 0.51%)"',
    "",
    `가장 중요한 규칙: baseline(비교 기준) 수치를 언급할 땐 반드시 정확히 "${baselineLabel}"라는 표현만 써라. "최근 12주 평균"이나 "최근 8주 평균" 같은 다른 기간을 절대 쓰지 마라 — ${baselineLabel}가 실제로 이번 계산에 쓰인 기준이다.`,
    "enaLeadSentence는 '주요 콘텐츠 관리'에 등록된 오리지널·독점 콘텐츠의 당일 본방 성적(필요하면 재방 유지율·동시방송 포함)이다 — 채널 성과를 좌우하는 콘텐츠이므로 값이 있으면 문장을 줄이지 말고 그대로 drivers의 첫 항목으로 넣어라(null이면 생략).",
    `피크 시간대 프로그램명(today_peak_program_name)이 top_program_name과 같으면 한 항목으로 합쳐라(예: "피크 15시 · '걸어서 세계속으로' 0.0141 (▲490.3%, ${baselineLabel} 대비)"). 둘이 다르면 각각 별도 항목으로 나눠라.`,
    "decline_program_* 값이 있으면 그것이 '왜 빠졌나'에 대한 가장 직접적인 근거다 — drivers에 반드시 포함하고, 하락이 그날의 지배적 사건이면 headline에도 그 프로그램명을 써라.",
    "prime_today_avg_rating과 prime_baseline_avg_rating이 둘 다 있고 차이가 15% 이상이면 prime_label을 붙여 drivers에 한 항목으로 넣어라(프라임타임은 편성 PD의 핵심 관심 구간이다).",
    '그 프라임 항목에는 반드시 prime_focus_program_name을 함께 써라 — 이 값은 프라임 등락 방향에 맞게 이미 골라 둔 프로그램이다(오른 날은 최고, 내린 날은 최저). 다른 프로그램으로 바꾸지 마라(예: "프라임 19~23시 0.011 (평소 0.043 ▼74%) · \'나혼자산다\' 0.008"). 값이 null이면 프로그램명 없이 쓴다. "프라임이 빠졌다"까지만 말하고 무엇 때문인지 안 쓰면 안 된다.',
    "today_share / baseline_avg_share가 둘 다 있으면 audience에 넣어라. 시청률은 빠졌는데 점유율이나 순위(today_rank vs baseline_avg_rank)가 유지·상승했다면 그것은 '시장 전체가 빠진 날'이라는 뜻이므로 headline에서 그 대비를 살려 써라 — 이 해석은 두 값이 실제로 그 방향일 때만 쓴다.",
    "same_weekday_avg_rating이 있으면 그 요일 기준 비교를 우선한다(편성은 날짜가 아니라 요일에 묶이므로 요일 통제된 비교가 더 정확하다). same_weekday_sample_days가 3 미만이면 표본이 적으므로 쓰지 마라.",
    "target_rank / target_achievement_pct는 원인이 아니라 결과다 — drivers에 절대 쓰지 마라. implication에서도 목표 달성률만 말하는 문장은 금지이며, 원인 해석과 다음 조치에 덧붙이는 보조 수치로만 허용한다.",
    "값이 null이거나 변화폭이 미미한 지표는 항목으로 만들지 마라 — 대략 10~25% 안팎 이상 변화 정도를 뚜렷한 신호로 본다. 채울 항목이 없으면 배열을 비워라(억지로 채우지 마라).",
    "연령대(demographics) 변화가 여러 개면 한 항목에 가운뎃점(·)으로 묶어라, 항목 수를 늘리지 마라.",
    // 실측(2026-09-23): 입력값 4.82를 모델이 "4.821%"로 한 자리 늘려 쓰는 사례가 나왔다.
    // 가구 시청률은 화면에서 직접 렌더하므로(ChannelDeepDive.tsx) 모델은 아예 쓰지 않게 한다.
    "가구 시청률은 어떤 경우에도 언급하지 마라(화면이 따로 표시한다). groupAHouseholdException 값이 있어도 무시해라.",
    "drivers와 audience의 역할을 절대 섞지 마라. 연령대(demographics)·점유율·시청시간·순위·가구 시청률은 무조건 audience다 — 그 값이 아무리 크게 움직였어도 drivers에 넣지 마라. drivers에는 프로그램명·편성 시각·프라임타임·피크 시간대만 들어간다.",
    `다시 한번: baseline 관련 수치의 기준을 언급할 땐 반드시 "${baselineLabel}"라고만 표현해라(다른 기간을 지어내지 마라).`,
    LLM_SYNTHESIS_GUARDRAIL,
  ].join("\n");
}

const SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string" },
    verdict: { type: "string", enum: ["up", "down", "flat"] },
    drivers: { type: "array", items: { type: "string" } },
    audience: { type: "array", items: { type: "string" } },
    implication: { type: ["string", "null"] },
  },
  required: ["headline", "verdict", "drivers", "audience", "implication"],
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
  const clean = (arr: string[] | undefined) => (arr ?? []).map((f) => f.trim()).filter((f) => f.length > 0);
  const implication = result?.implication?.trim() ?? "";
  // 사용자 지시(2026-09-23 후속): "시사점 칸은 긴데 실제로 내용이 없고, 시사점이라기보다는 그냥
  // 성과를 나열했다" — 프롬프트로 금지했더라도 모델이 "목표 대비 13.1%로 저조한 성과"처럼 성과만
  // 재진술하는 문장을 돌려주는 경우가 있어 코드에서도 막는다. 해석·조치를 가리키는 표현이 하나도
  // 없으면 시사점이 아니라고 보고 버린다(화면에서는 그 줄이 통째로 생략된다).
  const hasInsightVerb = /필요|검토|확인|점검|조정|주의|가능|보임|이어|대비해|살펴|유지할|교체/.test(implication);
  const isPerformanceRestatement = /목표\s*대비/.test(implication) && !hasInsightVerb;
  // 지시 대상이 없는 시사점("지속적인 콘텐츠 강화 필요" 등)도 버린다 — 실측(2026-09-23)에서
  // 모델이 이런 문장을 계속 만들어 냈다. 프로그램명(따옴표)·시각·수치 중 하나라도 있어야
  // 편성 담당자가 무엇을 볼지 알 수 있다. 버리면 화면이 규칙 기반 시사점으로 대체한다.
  // "지속적인 관리/강화", "전반적인 점검", "모니터링" 같은 상투어는 프로그램명을 붙여도 실제로
  // 무엇을 할지 말하지 않으므로 같이 걸러낸다(실측에서 반복 관찰).
  const isVague = !/['’"]|\d/.test(implication) || /지속적인|전반적인|모니터링|강화 필요/.test(implication);
  return {
    headline,
    verdict: result?.verdict === "up" || result?.verdict === "down" ? result.verdict : "flat",
    // 화면이 길어지지 않도록 항목 수 상한을 코드에서도 강제한다(프롬프트만으로는 가끔 넘친다).
    drivers: clean(result?.drivers).slice(0, 3),
    audience: clean(result?.audience).slice(0, 2),
    implication: implication.length > 0 && !isPerformanceRestatement && !isVague ? implication : null,
  };
}
